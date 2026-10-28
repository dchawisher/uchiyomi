/** Shared by catalogue reads, download coverage and the chapter manager. No persisted automatic decisions. */
export const chapterGroupingSchema = `
ALTER TABLE lib_series ADD COLUMN IF NOT EXISTS part_detection text NOT NULL DEFAULT 'careful'
  CHECK (part_detection IN ('careful', 'balanced', 'aggressive'));
ALTER TABLE lib_series ALTER COLUMN full_chapters SET DEFAULT true;
-- Previous numbering-only decisions must not keep parts suppressed after the rule changes.
UPDATE series_listing SET status=part_base_status,unblocked_status=part_base_unblocked,
  part_base_status=NULL,part_base_unblocked=NULL WHERE part_base_status IS NOT NULL;
UPDATE series_listing SET status=CASE WHEN status='covered' THEN 'available' ELSE status END,
  unblocked_status=CASE WHEN unblocked_status='covered' THEN 'available' ELSE unblocked_status END
  WHERE status='covered' OR unblocked_status='covered';
CREATE TABLE IF NOT EXISTS series_chapter_overrides (
  series_id text NOT NULL REFERENCES lib_series(id) ON DELETE CASCADE,
  number real NOT NULL CHECK (number >= 0 AND number <= 1000000),
  role text NOT NULL CHECK (role IN ('extra','part','first','complete')),
  parent_number real,
  PRIMARY KEY(series_id, number),
  CHECK ((role IN ('extra','complete') AND parent_number IS NULL)
    OR (role = 'part' AND parent_number >= 0 AND parent_number = floor(parent_number) AND number <> parent_number)
    OR (role = 'first' AND parent_number = number AND number = floor(number)))
);
CREATE TABLE IF NOT EXISTS chapter_page_counts (
  source text NOT NULL, chapter_id text NOT NULL, pages integer CHECK (pages > 0),
  checked_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(source, chapter_id)
);
CREATE OR REPLACE FUNCTION chapter_grouping(sid text, incoming jsonb DEFAULT '[]'::jsonb, family real DEFAULT NULL)
RETURNS TABLE(number real, parent_number real, role text, manual boolean, required_pages integer, parent_is_first boolean, complete_forced boolean)
LANGUAGE sql STABLE AS $grouping$
WITH policy AS (
  SELECT full_chapters AND numbering IS DISTINCT FROM 'posting_order'
    AND numbering_pending IS NULL AND renumber_plan IS NULL AS enabled, part_detection
  FROM lib_series WHERE id = sid
), overrides AS (
  SELECT number, role, parent_number FROM series_chapter_overrides WHERE series_id = sid
  UNION ALL
  SELECT e.number, 'extra', NULL::real FROM series_part_extras e WHERE e.series_id = sid
    AND NOT EXISTS (SELECT 1 FROM series_chapter_overrides o WHERE o.series_id=sid AND o.number=e.number)
), families_needed AS (
  SELECT family AS whole UNION SELECT parent_number FROM overrides WHERE floor(number)=family AND parent_number IS NOT NULL
), entries AS (
  SELECT COALESCE(o.number,b.number)::real AS number,
    CASE WHEN b.pruned_at IS NULL AND b.missing_pages IS NULL THEN nullif(b.pages,0) END AS pages
  FROM lib_books b LEFT JOIN book_overrides o ON o.book_id=b.id
  WHERE b.series_id=sid AND o.volume_number IS NULL AND COALESCE(o.number_end,b.number_end) IS NULL
  UNION ALL
  SELECT l.number, COALESCE(nullif((c->>'pages')::integer,0),pc.pages)
  FROM series_listing l LEFT JOIN LATERAL jsonb_array_elements(l.copies) c ON true
    LEFT JOIN chapter_page_counts pc ON pc.source=c->>'source' AND pc.chapter_id=c->>'sourceId'
  WHERE l.series_id=sid
  UNION ALL
  SELECT (v->>'number')::real, nullif((v->>'pages')::integer,0) FROM jsonb_array_elements(incoming) v
), counts AS (
  SELECT number,max(pages)::integer AS pages FROM entries WHERE number >= 0 AND (family IS NULL
    OR floor(number) IN (SELECT whole FROM families_needed)
    OR number IN (SELECT o.number FROM overrides o WHERE o.parent_number IN (SELECT whole FROM families_needed))) GROUP BY number
), families AS (
  SELECT floor(c.number)::real AS whole, count(*) FILTER (WHERE c.number<>floor(c.number) AND COALESCE(o.role,'')<>'extra') AS fractions
  FROM counts c LEFT JOIN overrides o USING(number) GROUP BY floor(c.number)
), classified AS (
  SELECT c.*, o.role AS override_role,
    CASE WHEN o.role='part' THEN o.parent_number
      WHEN o.role='first' THEN c.number
      WHEN o.role IS NOT NULL THEN NULL
      WHEN NOT p.enabled OR c.number=floor(c.number) THEN NULL
      WHEN f.fractions=1 AND (p.part_detection='careful' OR (p.part_detection='balanced' AND c.number-floor(c.number)=0.5)) THEN NULL
      ELSE floor(c.number)::real END AS parent,
    CASE WHEN o.role='part' THEN 'part' WHEN o.role='first' THEN 'first' WHEN o.role='extra' THEN 'extra'
      WHEN c.number=floor(c.number) OR o.role='complete' THEN 'chapter'
      WHEN NOT p.enabled THEN 'extra'
      WHEN f.fractions=1 AND (p.part_detection='careful' OR (p.part_detection='balanced' AND c.number-floor(c.number)=0.5)) THEN 'extra'
      ELSE 'part' END AS kind
  FROM counts c JOIN families f ON f.whole=floor(c.number) CROSS JOIN policy p LEFT JOIN overrides o USING(number)
), groups AS (
  SELECT parent,
    count(*) FILTER (WHERE kind='part') AS parts,
    bool_or(number=(parent+0.1)::real) AS has_first,
    CASE WHEN count(*) FILTER (WHERE kind='part' AND pages IS NULL)>0 THEN NULL
      ELSE greatest(1, sum(pages) FILTER (WHERE kind='part') - 4*count(*) FILTER (WHERE kind='part'))::integer END AS required
  FROM classified WHERE kind IN ('part','first') GROUP BY parent
), resolved AS (
  SELECT c.*, CASE WHEN c.override_role='first' THEN true
    WHEN c.override_role IS NOT NULL THEN false
    ELSE c.kind='chapter' AND p.enabled AND g.parts>=2 AND NOT g.has_first END AS first
  FROM classified c CROSS JOIN policy p LEFT JOIN groups g ON g.parent=c.number
)
SELECT r.number, CASE WHEN r.first THEN r.number ELSE r.parent END,
  CASE WHEN r.first THEN 'first' ELSE r.kind END, r.override_role IS NOT NULL,
  g.required, COALESCE(parent.first,false), COALESCE(parent.override_role='complete',false)
FROM resolved r LEFT JOIN groups g ON g.parent=r.parent
LEFT JOIN resolved parent ON parent.number=r.parent
$grouping$;
`;
