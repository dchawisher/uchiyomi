import { q } from './db';
import { noticeBook } from './noticeChapters';
import { numKey } from './postingOrder';

type Query = typeof q;
const effectiveNumber = (b: string) => `COALESCE((SELECT number FROM book_overrides WHERE book_id = ${b}.id), ${b}.number)`;
/** A usable mapped volume or full chapter suppresses duplicate reading entries, never their files. */
export function alternateOf(b: string, grouping?: string): string {
  const n = effectiveNumber(b);
  return `(CASE WHEN ${b}.number_end IS NOT NULL OR EXISTS (SELECT 1 FROM book_overrides fp_own
    WHERE fp_own.book_id = ${b}.id AND (fp_own.volume_number IS NOT NULL OR fp_own.number_end IS NOT NULL))
    THEN NULL ELSE COALESCE(${volumeFor(b, n)}, ${fullChapterFor(`${b}.series_id`, n, undefined, grouping)}) END)`;
}

// Explicit chapter coverage is independent of the optional split-chapter convention. Only a complete,
// available volume can replace a chapter in the reading order; removing its mapping restores the chapter.
function volumeFor(b: string, n: string): string {
  return `(SELECT vc_book.id FROM lib_books vc_book
    JOIN book_overrides vc_map ON vc_map.book_id = vc_book.id
    WHERE vc_book.series_id = ${b}.series_id AND vc_book.id <> ${b}.id
      AND vc_map.volume_number IS NOT NULL AND vc_map.number_end >= vc_map.number
      AND ${n} BETWEEN vc_map.number AND vc_map.number_end
      AND vc_book.pruned_at IS NULL AND vc_book.missing_pages IS NULL
      AND NOT ${noticeBook('vc_book.id')}
    ORDER BY vc_map.number, vc_book.file, vc_book.id LIMIT 1)`;
}

export function fullChapterFor(series: string, n: string, incoming = "'[]'::jsonb", grouping?: string): string {
  const g = grouping ?? 'fp_group';
  return `(SELECT fp_whole.id FROM ${grouping ? '' : `chapter_grouping(${series}, ${incoming}, floor(${n})::real) fp_group CROSS JOIN `}lib_books fp_whole
    LEFT JOIN book_overrides fp_override ON fp_override.book_id = fp_whole.id
    WHERE fp_whole.series_id = ${series} AND ${g}.number = ${n} AND ${g}.role = 'part' AND NOT ${g}.parent_is_first
      AND COALESCE(fp_override.number, fp_whole.number) = ${g}.parent_number
      AND (${g}.complete_forced OR fp_whole.pages >= ${g}.required_pages)
      AND NOT EXISTS (SELECT 1 FROM series_chapter_overrides co WHERE co.series_id=${series}
        AND co.number=${g}.parent_number AND co.role IN ('first','extra'))
      AND fp_override.volume_number IS NULL AND COALESCE(fp_override.number_end, fp_whole.number_end) IS NULL
      AND fp_whole.pruned_at IS NULL AND fp_whole.missing_pages IS NULL
      AND NOT ${noticeBook('fp_whole.id')}
    ORDER BY fp_whole.file, fp_whole.id LIMIT 1)`;
}

export const alternateBook = (id: string) => `EXISTS (SELECT 1 FROM lib_books fp_part WHERE fp_part.id = ${id} AND ${alternateOf('fp_part')} IS NOT NULL)`;

/** Coverage for automatic downloads: an eligible complete release, or a complete file already held. */
export async function coveredParts(seriesId: string, available: Iterable<number>, qq: Query = q, knownNumbers: Iterable<number> = [], incoming: Array<{number: number; pages?: number | null}> = []): Promise<Set<number>> {
  const numbers = [...available].map(numKey);
  const data = [...incoming, ...[...knownNumbers, ...numbers].map(number => ({ number }))];
  const groups = await qq<{number: number; parent_number: number; required_pages: number | null; complete_forced: boolean; held: string | null}>(
    `SELECT g.*, ${fullChapterFor('$1', 'g.number', '$2::jsonb', 'g')} AS held FROM chapter_grouping($1,$2::jsonb) g
      WHERE g.role='part' AND NOT g.parent_is_first`, [seriesId, JSON.stringify(data)]);
  const ready = new Set(numbers);
  const pages = new Map(incoming.map(c => [numKey(c.number), c.pages]));
  if (!incoming.length) {
    const rows = await qq<{number: number; pages: number | null}>(`SELECT l.number,
      COALESCE(nullif((l.chosen->>'pages')::int,0),pc.pages) AS pages FROM series_listing l
      LEFT JOIN chapter_page_counts pc ON pc.source=l.chosen->>'source' AND pc.chapter_id=l.chosen->>'sourceId'
      WHERE l.series_id=$1 AND l.status IN ('available','covered')`, [seriesId]);
    rows.forEach(r => pages.set(numKey(Number(r.number)), r.pages));
  }
  return new Set(groups.filter(g => ready.has(numKey(Number(g.number))) && (g.held ||
    (ready.has(numKey(Number(g.parent_number))) && (g.complete_forced ||
      (g.required_pages !== null && (pages.get(numKey(Number(g.parent_number))) ?? 0) >= g.required_pages)))))
    .map(g => numKey(Number(g.number))));
}
/** Restore only the coverage this policy added; keep source-alias and group-policy decisions intact. */
export async function restorePartListing(qq: Query, id: string): Promise<void> {
  await qq(`UPDATE series_listing SET status = part_base_status, unblocked_status = part_base_unblocked,
    part_base_status = NULL, part_base_unblocked = NULL WHERE series_id = $1 AND part_base_status IS NOT NULL`, [id]);
}

export async function applyPartListing(qq: Query, id: string): Promise<void> {
  await restorePartListing(qq, id);
  const rows = await qq<{ number: number }>(`SELECT number FROM series_listing WHERE series_id = $1 AND status = 'available'`, [id]);
  const covered = await coveredParts(id, rows.map(r => Number(r.number)), qq);
  if (covered.size) await qq(`UPDATE series_listing SET part_base_status = status,
    part_base_unblocked = unblocked_status, status = 'covered', unblocked_status = 'covered'
    WHERE series_id = $1 AND number = ANY($2::real[])`, [id, [...covered]]);
}
