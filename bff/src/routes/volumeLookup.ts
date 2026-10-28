import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, q, tx } from '../lib/db';
import { mdGet } from '../lib/sources/mangadex';
import { volumeSuggestions } from '../lib/volumeLookup';
import { logAudit } from '../lib/audit';
import { userIdOf } from '../lib/auth';

const API = (process.env.MANGADEX_API_URL || 'https://api.mangadex.org').replace(/\/+$/, '');
const uuid = z.string().uuid();

/** Registered inside the admin plugin, after its authentication and administrator hooks. */
export function volumeLookupRoutes(app: FastifyInstance): void {
  app.get('/api/admin/series/:id/volume-lookup', async (req, reply) => {
    const { id } = req.params as { id: string };
    const input = z.object({ mangaId: uuid.optional(), query: z.string().trim().min(1).max(300).optional() }).safeParse(req.query);
    if (!input.success) return reply.code(400).send({ error: 'bad_request' });
    const series = await one<{ title: string }>('SELECT title FROM lib_series WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!series) return reply.code(404).send({ error: 'not_found' });
    const books = await q(`SELECT b.id, b.title AS name, COALESCE(ov.number, b.number) AS number,
      ov.volume_number AS "volumeNumber", ov.volume_number_end AS "volumeNumberEnd", ov.number_end AS "numberEnd"
      FROM lib_books b LEFT JOIN book_overrides ov ON ov.book_id = b.id
      WHERE b.series_id = $1 AND b.pruned_at IS NULL ORDER BY b.number, b.id`, [id]);
    let mangaId = input.data.mangaId;
    if (!mangaId && !input.data.query) {
      const linked = await q<{ source_series_id: string }>(`SELECT source_series_id FROM lib_series
        WHERE id = $1 AND (source_id = 'mangadex' OR source_id LIKE 'mangadex-%')
        UNION SELECT source_series_id FROM series_sources WHERE series_id = $1
        AND (source_id = 'mangadex' OR source_id LIKE 'mangadex-%')`, [id]);
      const ids = linked.map(r => r.source_series_id).filter(v => uuid.safeParse(v).success);
      if (ids.length === 1) mangaId = ids[0];
    }
    try {
      if (!mangaId) {
        const params = new URLSearchParams({ title: input.data.query ?? series.title, limit: '10' });
        for (const rating of ['safe', 'suggestive', 'erotica', 'pornographic']) params.append('contentRating[]', rating);
        const result = await mdGet(`${API}/manga?${params}`);
        const candidates = (result.data ?? []).map((m: any) => ({ id: m.id,
          title: m.attributes?.title?.en || m.attributes?.title?.['ja-ro'] || Object.values(m.attributes?.title ?? {})[0] || m.id,
          year: m.attributes?.year ?? null,
        }));
        return { books, candidates, volumes: [], unassigned: false, mangaId: null };
      }
      const result = await mdGet(`${API}/manga/${mangaId}/aggregate`);
      return { books, candidates: [], mangaId, ...volumeSuggestions(result) };
    } catch (error) {
      const { status, selfTimeout } = error as { status?: number; selfTimeout?: boolean };
      return reply.code(status === 429 || selfTimeout ? 429 : 502).send({ error: 'MangaDex lookup failed. Try again or choose another title.' });
    }
  });

  app.post('/api/admin/series/:id/volume-ranges', async (req, reply) => {
    const { id } = req.params as { id: string };
    const input = z.object({ mappings: z.array(z.object({
      bookId: z.string().min(1).max(300), volume: z.number().positive().max(100000),
      volumeEnd: z.number().positive().max(100000).optional(),
      first: z.number().min(0).max(100000), last: z.number().min(0).max(100000),
    }).refine(r => r.last >= r.first && r.last - r.first <= 1000 && (r.volumeEnd == null || r.volumeEnd >= r.volume))).min(1).max(500) }).safeParse(req.body);
    if (!input.success) return reply.code(400).send({ error: 'bad_request' });
    const mappings = input.data.mappings;
    if (new Set(mappings.map(r => r.bookId)).size !== mappings.length
      || new Set(mappings.map(r => r.volume)).size !== mappings.length) {
      return reply.code(400).send({ error: 'Choose a different file for each volume.' });
    }
    try {
      await tx(async qq => {
        // Lock in a stable order. The conditional upsert also protects against concurrent manual edits.
        const files = await qq(`SELECT b.id FROM lib_books b JOIN lib_series s ON s.id = b.series_id
          WHERE b.series_id = $1 AND b.id = ANY($2::text[]) AND b.pruned_at IS NULL AND s.deleted_at IS NULL
          ORDER BY b.id FOR UPDATE OF b`, [id, mappings.map(r => r.bookId)]);
        if (files.length !== mappings.length) throw new Error('Files changed. Close the lookup and try again.');
        for (const row of mappings) {
          const saved = await qq(`INSERT INTO book_overrides (book_id, number, volume_number, number_end, volume_number_end, updated_at)
            VALUES ($1,$2,$3,$4,$5,now()) ON CONFLICT (book_id) DO UPDATE
            SET number = EXCLUDED.number, volume_number = EXCLUDED.volume_number,
                number_end = EXCLUDED.number_end, volume_number_end = EXCLUDED.volume_number_end, updated_at = now()
            WHERE book_overrides.volume_number IS NULL RETURNING book_id`, [row.bookId, row.first, row.volume, row.last, row.volumeEnd ?? null]);
          if (!saved.length) throw new Error('A file already has a volume mapping. Close the lookup and try again.');
        }
      });
    } catch (error) {
      if (error instanceof Error && /^(Files changed|A file already)/.test(error.message)) {
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    }
    await logAudit('series.volume_ranges', { userId: userIdOf(req), detail: { id, mappings }, req });
    return { saved: mappings.length };
  });
}
