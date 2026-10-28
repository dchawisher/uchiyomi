import { q } from './db';
import { getSource, withTimeout } from './sources';
import { automaticCopiesFor, seriesFollowsSource, type ListingCopy } from './seriesListing';
import { applyPartListing } from './chapterParts';
import { blockedNow, isDisabled } from './sourceHealth';

/** Count URL lists, never fetch image URLs. Cache unsuccessful lookups too, to avoid repeatedly asking a broken source. */
export async function checkGroupingPages(seriesId: string, limit = 4): Promise<{ checked: number; failed: number; remaining: number }> {
  const rows = await q<{number:number; copies:ListingCopy[]}>(`SELECT l.number,l.copies FROM series_listing l
    WHERE l.series_id=$1 AND NOT EXISTS (SELECT 1 FROM lib_books b LEFT JOIN book_overrides o ON o.book_id=b.id
      WHERE b.series_id=l.series_id AND COALESCE(o.number,b.number)=l.number AND o.volume_number IS NULL
        AND COALESCE(o.number_end,b.number_end) IS NULL AND b.pages>0 AND b.pruned_at IS NULL AND b.missing_pages IS NULL)
    ORDER BY l.number`,[seriesId]);
  const cached = await q<{source:string;chapter_id:string}>(`SELECT DISTINCT pc.source,pc.chapter_id
    FROM series_listing l CROSS JOIN LATERAL jsonb_array_elements(l.copies) c JOIN chapter_page_counts pc
      ON pc.source=c->>'source' AND pc.chapter_id=c->>'sourceId'
    WHERE l.series_id=$1 AND (pc.pages IS NOT NULL OR pc.checked_at>now()-interval '1 hour')`,[seriesId]);
  const keyOf=(source:string,id:string)=>JSON.stringify([source,id]);
  const cachedKeys=new Set(cached.map(c=>keyOf(c.source,c.chapter_id)));
  const pending: ListingCopy[] = [];
  const seen = new Set<string>();
    for (const copy of await automaticCopiesFor(seriesId,rows.flatMap(r=>r.copies))) {
      if (copy.pages && copy.pages>0) continue;
      const key = keyOf(copy.source,copy.sourceId);
      if (seen.has(key)) continue;
      seen.add(key);
      if (!cachedKeys.has(key)) pending.push(copy);
    }
  let checked=0,failed=0;
  for (const copy of pending.slice(0,limit)) {
    const source=getSource(copy.source);
    let pages:number|null=null;
    try {
      if (source && !await isDisabled(copy.source) && !await blockedNow(copy.source) && await seriesFollowsSource(seriesId,copy.source))
        pages=(await withTimeout(source.getPageUrls(copy.sourceId),12000)).length || null;
    }
    catch { /* An unavailable page list is not a zero-length chapter. */ }
    await q(`INSERT INTO chapter_page_counts(source,chapter_id,pages) VALUES ($1,$2,$3)
      ON CONFLICT(source,chapter_id) DO UPDATE SET pages=EXCLUDED.pages,checked_at=now()`,[copy.source,copy.sourceId,pages]);
    if (pages===null) failed++; else checked++;
  }
  await applyPartListing(q,seriesId);
  return {checked,failed,remaining:Math.max(0,pending.length-limit)};
}
