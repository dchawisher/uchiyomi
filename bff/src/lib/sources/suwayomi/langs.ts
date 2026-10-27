// One default source per extension; explicit language choices apply to future installs.
// Per-source choices do not change the language defaults, and extension updates retain existing switches.
import { q, tx } from '../../db';
import { visibleToAll } from '../../visibility';
import { defaultExtensionSources } from './defaultSources';

async function preferredLanguages(): Promise<string[]> {
  const rows = await q<{ enabled_langs: string[] }>('SELECT enabled_langs FROM server_settings WHERE id = 1');
  return rows[0]?.enabled_langs ?? [];
}

type Run = <R = any>(text: string, params?: any[]) => Promise<R[]>;

async function readHidden(run: Run, forUpdate = false): Promise<string[]> {
  // Inside setSourcesEnabled the row is locked for the read-modify-write: two languages hidden at once from
  // the panel (the busy state only covers the button that was pressed, and the first call sits in a reload
  // round-trip) each read the list, and the last writer would silently forget the other's language -- its
  // sources off, but the next install switching them back on.
  const rows = await run<{ hidden_langs: unknown }>(`SELECT hidden_langs FROM server_settings WHERE id = 1${forUpdate ? ' FOR UPDATE' : ''}`);
  const v = rows[0]?.hidden_langs;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** The codes the operator has hidden, as the engine reports them (en, ru, zh-Hans). */
export const getHiddenLangs = (): Promise<string[]> => readHidden(q);

export interface BulkArgs {
  ids?: string[];
  langs?: string[];
  enabled: boolean;
}

/**
 * Switch sources on or off, by id or by language, in one statement.
 *
 * `changed` counts rows that actually flipped: the `enabled <> $1` guard keeps a second press from reporting
 * thirty changes for nothing. A row whose lang is NULL (an extension that declares none) is reachable only
 * by id, because ANY() never matches NULL -- and "hide ru" must not touch a source that never said what
 * it was.
 *
 * Only a language selector records the standing preference. Toggling one source by id is an exception to
 * it, not a change of it: switching one Russian source back on to read a single series does not mean
 * Russian is wanted from the next extension.
 */
export async function setSourcesEnabled({ ids = [], langs = [], enabled }: BulkArgs): Promise<{ changed: number; hiddenLangs: string[] }> {
  return tx(async (qq) => {
    const flipped = await qq<{ source_id: string }>(
      `UPDATE suwayomi_sources SET enabled = $1
        WHERE (source_id = ANY($2::text[]) OR lang = ANY($3::text[])) AND enabled <> $1
        RETURNING source_id`,
      [enabled, ids, langs],
    );
    let hidden = await readHidden(qq, langs.length > 0);
    if (langs.length) {
      hidden = enabled ? hidden.filter((l) => !langs.includes(l)) : [...new Set([...hidden, ...langs])];
      await qq('UPDATE server_settings SET hidden_langs = $1::jsonb WHERE id = 1', [JSON.stringify(hidden)]);
      const rows = await qq<{ enabled_langs: string[] }>('SELECT enabled_langs FROM server_settings WHERE id = 1');
      const previous = rows[0]?.enabled_langs ?? [];
      const preferred = enabled ? [...new Set([...previous, ...langs])] : previous.filter((l) => !langs.includes(l));
      await qq('UPDATE server_settings SET enabled_langs = $1::jsonb WHERE id = 1', [JSON.stringify(preferred)]);
    }
    return { changed: flipped.length, hiddenLangs: hidden };
  });
}

/**
 * Record an extension's sources using the one-source default plus explicitly preferred languages.
 * Updates preserve existing switches; uninstall switches everything off.
 */
export async function adoptExtensionSources(
  provided: Array<{ id: string; name: string; lang: string | null; nsfw?: boolean }>,
  enable: boolean,
  preserveExisting = false,
): Promise<{ on: number; hidden: number }> {
  const hidden = new Set(enable ? await getHiddenLangs() : []);
  const preferred = enable ? await preferredLanguages() : [];
  const selected = defaultExtensionSources(provided, hidden, preferred);
  let on = 0;
  let left = 0;
  for (const s of provided) {
    const want = enable && selected.has(s.id);
    const rows = await q<{ enabled: boolean }>(
      `INSERT INTO suwayomi_sources (source_id, name, lang, nsfw, enabled) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (source_id) DO UPDATE SET enabled = CASE WHEN $6 THEN suwayomi_sources.enabled ELSE EXCLUDED.enabled END, name = EXCLUDED.name,
         lang = EXCLUDED.lang, nsfw = EXCLUDED.nsfw RETURNING enabled`,
      [s.id, s.name, s.lang, !!s.nsfw, want, enable && preserveExisting],
    );
    if (rows[0]?.enabled) on++;
    else if (enable) left++;
  }
  return { on, hidden: left };
}

/**
 * "Turn on its sources": enable the default source and explicitly preferred languages, except hidden languages.
 * -- the install's own rule, for an extension installed without it: in the engine's own page, which left it showing
 * as installed with every source off, and Remove then Add again the only way to switch them on (discussion #121).
 * Unlike adoptExtensionSources it never switches one OFF: a source in a hidden language that someone turned on by
 * hand stays on. `on` counts the sources on afterwards, `hidden` those left off for their language.
 */
export async function turnOnExtensionSources(
  provided: Array<{ id: string; name: string; lang: string | null; nsfw?: boolean }>,
): Promise<{ on: number; hidden: number }> {
  const hidden = new Set(await getHiddenLangs());
  const selected = defaultExtensionSources(provided, hidden, await preferredLanguages());
  let on = 0;
  let left = 0;
  for (const s of provided) {
    const want = selected.has(s.id);
    const rows = await q<{ enabled: boolean }>(
      `INSERT INTO suwayomi_sources (source_id, name, lang, nsfw, enabled) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (source_id) DO UPDATE SET enabled = suwayomi_sources.enabled OR EXCLUDED.enabled,
         name = EXCLUDED.name, lang = EXCLUDED.lang, nsfw = EXCLUDED.nsfw
       RETURNING enabled`,
      [s.id, s.name, s.lang, !!s.nsfw, want],
    );
    if (rows[0]?.enabled) on++;
    else left++;
  }
  return { on, hidden: left };
}

export interface LangRow {
  lang: string | null;
  sources: number;
  enabled: number;
  /** series in the library that were added through a source of this language */
  used: number;
  hidden: boolean;
}

/** One row per language the engine has ever offered, with what hiding it would cost. */
export async function langOverview(): Promise<LangRow[]> {
  const hidden = new Set(await getHiddenLangs());
  const rows = await q<{ lang: string | null; sources: number; enabled: number; used: number }>(
    // `lib_series.source_id` holds the adapter id, which for an extension source is 'sw:' + the engine's
    // id (the same join routes/sources.ts counts usage by). `source_id` is the primary key, so a series
    // joins at most one row and count(ls.id) is a count of series, not of pairs.
    // NULLIF: an extension that declares no language is stored as '' by some paths and NULL by others; both
    // mean the same thing, and a Hide button on a blank row would post a code the route rejects.
    `SELECT NULLIF(ss.lang, '') AS lang,
            count(DISTINCT ss.source_id)::int AS sources,
            count(DISTINCT ss.source_id) FILTER (WHERE ss.enabled)::int AS enabled,
            count(ls.id)::int AS used
       FROM suwayomi_sources ss
       LEFT JOIN lib_series ls ON ls.source_id = 'sw:' || ss.source_id AND ${visibleToAll('ls')}
      GROUP BY NULLIF(ss.lang, '')
      ORDER BY 3 DESC, 2 DESC, 1 NULLS LAST`,
  );
  return rows.map((r) => ({ ...r, hidden: r.lang != null && hidden.has(r.lang) }));
}
