import { q } from './db';
import { noticeBook } from './noticeChapters';
import { numKey } from './postingOrder';

type Query = typeof q;
const effectiveNumber = (b: string) => `COALESCE((SELECT number FROM book_overrides WHERE book_id = ${b}.id), ${b}.number)`;
const enabled = (s: string) => `${s}.full_chapters AND ${s}.numbering IS DISTINCT FROM 'posting_order'
  AND ${s}.numbering_pending IS NULL AND ${s}.renumber_plan IS NULL`;

/** A lone .5 conventionally names a bonus; .4 is the evidence that it continues a split release. */
export function isPartNumber(number: number, known: ReadonlySet<number>): boolean {
  const n = numKey(number);
  return n >= 0 && !Number.isInteger(n)
    && (numKey(n - Math.floor(n)) !== 0.5 || known.has(numKey(Math.floor(n) + 0.4)));
}

function partNumberSql(series: string, n: string): string {
  return `(${n} <> floor(${n}) AND ${n} >= 0 AND (${n} <> floor(${n}) + 0.5
    OR EXISTS (SELECT 1 FROM series_listing fp_four WHERE fp_four.series_id = ${series} AND fp_four.number = (floor(${n}) + 0.4)::real)
    OR EXISTS (SELECT 1 FROM lib_books fp_four_book WHERE fp_four_book.series_id = ${series}
      AND ${effectiveNumber('fp_four_book')} = (floor(${n}) + 0.4)::real)))`;
}

/** A usable mapped volume or full chapter suppresses duplicate reading entries, never their files. */
export function alternateOf(b: string): string {
  const n = effectiveNumber(b);
  return `(CASE WHEN ${b}.number_end IS NOT NULL OR EXISTS (SELECT 1 FROM book_overrides fp_own
    WHERE fp_own.book_id = ${b}.id AND (fp_own.volume_number IS NOT NULL OR fp_own.number_end IS NOT NULL))
    THEN NULL ELSE COALESCE(${volumeFor(b, n)}, ${fullChapterFor(`${b}.series_id`, n)}) END)`;
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

export function fullChapterFor(series: string, n: string): string {
  return `(SELECT fp_whole.id FROM lib_series fp_series JOIN lib_books fp_whole ON fp_whole.series_id = fp_series.id
    LEFT JOIN book_overrides fp_override ON fp_override.book_id = fp_whole.id
    WHERE fp_series.id = ${series} AND ${enabled('fp_series')}
      AND ${partNumberSql(series, n)}
      AND NOT EXISTS (SELECT 1 FROM series_part_extras fp_extra WHERE fp_extra.series_id = ${series} AND fp_extra.number = ${n})
      AND COALESCE(fp_override.number, fp_whole.number) = floor(${n})
      AND fp_override.volume_number IS NULL AND COALESCE(fp_override.number_end, fp_whole.number_end) IS NULL
      AND fp_whole.pruned_at IS NULL AND fp_whole.missing_pages IS NULL
      AND NOT ${noticeBook('fp_whole.id')}
    ORDER BY fp_whole.file, fp_whole.id LIMIT 1)`;
}

export const alternateBook = (id: string) => `EXISTS (SELECT 1 FROM lib_books fp_part WHERE fp_part.id = ${id} AND ${alternateOf('fp_part')} IS NOT NULL)`;

/** Coverage for automatic downloads: an eligible complete release, or a complete file already held. */
export async function coveredParts(seriesId: string, available: Iterable<number>, qq: Query = q, knownNumbers: Iterable<number> = []): Promise<Set<number>> {
  const policy = await qq<{ on: boolean }>(`SELECT ${enabled('s')} AS on FROM lib_series s WHERE s.id = $1`, [seriesId]);
  if (!policy[0]?.on) return new Set();
  const [extras, held, listed] = await Promise.all([
    qq<{ number: number }>('SELECT number FROM series_part_extras WHERE series_id = $1', [seriesId]),
    qq<{ number: number }>(`SELECT COALESCE(o.number, b.number) AS number FROM lib_books b
      LEFT JOIN book_overrides o ON o.book_id = b.id WHERE b.series_id = $1 AND b.pruned_at IS NULL
      AND b.missing_pages IS NULL AND o.volume_number IS NULL AND COALESCE(o.number_end, b.number_end) IS NULL
      AND NOT ${noticeBook('b.id')}`, [seriesId]),
    qq<{ number: number }>(`SELECT number FROM series_listing WHERE series_id = $1
      UNION SELECT COALESCE(o.number, b.number) FROM lib_books b LEFT JOIN book_overrides o ON o.book_id = b.id WHERE b.series_id = $1`, [seriesId]),
  ]);
  const numbers = [...available].map(numKey);
  const wholes = new Set([...numbers, ...held.map(b => numKey(Number(b.number)))].filter(Number.isInteger));
  const separate = new Set(extras.map(e => numKey(Number(e.number))));
  const known = new Set([...numbers, ...knownNumbers, ...listed.map(r => Number(r.number))].map(numKey));
  return new Set(numbers.filter(n => isPartNumber(n, known) && !separate.has(n) && wholes.has(Math.floor(n))));
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
