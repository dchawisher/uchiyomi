import { q } from './db';
import { getSource, withTimeout } from './sources';
import { automaticCopiesFor, seriesFollowsSource, type ListingCopy } from './seriesListing';
import { applyPartListing } from './chapterParts';
import { blockedNow, isDisabled } from './sourceHealth';

/** Count URL lists, never fetch image URLs. Cache unsuccessful lookups too, to avoid repeatedly asking a broken source. */
export async function checkGroupingPages(seriesId: string, limit = 4): Promise<{ checked: number; failed: number; remaining: number }> {
  const rows = await q<{number:number; copies:ListingCopy[]}>(`SELECT number,copies FROM series_listing
    WHERE series_id=$1 AND floor(number) IN (SELECT floor(number) FROM series_listing WHERE series_id=$1 AND number<>floor(number))
    ORDER BY number`,[seriesId]);
  const pending: ListingCopy[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const copy of await automaticCopiesFor(seriesId,row.copies)) {
      if (copy.pages && copy.pages>0) continue;
      const key = `${copy.source}:${copy.sourceId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const cached = await q(`SELECT 1 FROM chapter_page_counts WHERE source=$1 AND chapter_id=$2
        AND checked_at > now() - CASE WHEN pages IS NULL THEN interval '1 hour' ELSE interval '7 days' END`,[copy.source,copy.sourceId]);
      if (!cached.length) pending.push(copy);
    }
  }
  let checked=0,failed=0;
  for (const copy of pending.slice(0,limit)) {
    const source=getSource(copy.source);
    if (!source || await isDisabled(copy.source) || await blockedNow(copy.source) || !(await seriesFollowsSource(seriesId,copy.source))) { failed++; continue; }
    let pages:number|null=null;
    try { pages=(await withTimeout(source.getPageUrls(copy.sourceId),12000)).length || null; }
    catch { /* An unavailable page list is not a zero-length chapter. */ }
    await q(`INSERT INTO chapter_page_counts(source,chapter_id,pages) VALUES ($1,$2,$3)
      ON CONFLICT(source,chapter_id) DO UPDATE SET pages=EXCLUDED.pages,checked_at=now()`,[copy.source,copy.sourceId,pages]);
    if (pages===null) failed++; else checked++;
  }
  await applyPartListing(q,seriesId);
  return {checked,failed,remaining:Math.max(0,pending.length-limit)};
}
