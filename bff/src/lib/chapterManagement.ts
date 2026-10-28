import { q } from './db';
import { coveredParts } from './chapterParts';
import { noticeBook } from './noticeChapters';

/** Include every source listing, including covered/held rows omitted from the reading list. */
export async function managedSourceChapters(seriesId: string) {
  const rows = await q<{
    number: number; title: string; status: string; pages: number | null;
    role: 'chapter' | 'part' | 'first' | 'extra'; parent_number: number | null;
    manual: boolean; required_pages: number | null; parent_is_first: boolean;
    volume: number | null; volume_end: number | null;
  }>(`WITH groups AS MATERIALIZED (SELECT * FROM chapter_grouping($1))
    SELECT l.number,l.title,l.status,g.role,g.parent_number,g.manual,g.required_pages,g.parent_is_first,
      (SELECT max(COALESCE(nullif((c->>'pages')::int,0),pc.pages))
        FROM jsonb_array_elements(l.copies) c LEFT JOIN chapter_page_counts pc
          ON pc.source=c->>'source' AND pc.chapter_id=c->>'sourceId') AS pages,
      v.volume_number AS volume,v.volume_number_end AS volume_end
    FROM series_listing l LEFT JOIN groups g ON g.number=l.number
    LEFT JOIN LATERAL (
      SELECT o.volume_number,o.volume_number_end FROM lib_books b JOIN book_overrides o ON o.book_id=b.id
      WHERE b.series_id=l.series_id AND o.volume_number IS NOT NULL
        AND l.number BETWEEN o.number AND o.number_end
        AND b.pruned_at IS NULL AND b.missing_pages IS NULL AND NOT ${noticeBook('b.id')}
      ORDER BY o.number,b.file,b.id LIMIT 1
    ) v ON true WHERE l.series_id=$1 ORDER BY l.number`, [seriesId]);
  const covered = await coveredParts(seriesId, rows.filter(r => ['available','covered'].includes(r.status)).map(r => r.number));
  return rows.map(r => ({
    id: `listed:${r.number}`, number: r.number, name: r.title || '', pagesCount: r.pages,
    status: r.status,
    grouping: r.role ? { role:r.role, parentNumber:r.parent_number, manual:r.manual,
      requiredPages:r.required_pages, parentIsFirst:r.parent_is_first } : null,
    coveredBy: r.volume != null ? {kind:'volume' as const,number:r.volume,end:r.volume_end}
      : covered.has(Number(Number(r.number).toFixed(3))) && r.parent_number != null
        ? {kind:'chapter' as const,number:r.parent_number} : null,
  }));
}
