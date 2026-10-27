import test from 'node:test';
import assert from 'node:assert/strict';

const dsn = process.env.TEST_DATABASE_URL;
if (dsn) {
  process.env.DATABASE_URL = dsn;
  process.env.JWT_SECRET = 'household-test-secret-at-least-16-chars';
  process.env.CONFIG_DIR = '/tmp/uchiyomi-household-test';
  process.env.LIBRARY_BACKEND = 'owned';
}

test('household permissions, half-stars and extension language defaults', { skip: !dsn }, async (t) => {
  const { migrate } = await import('../src/lib/migrate');
  const { q } = await import('../src/lib/db');
  const { invalidateAdultFilter } = await import('../src/lib/visibility');
  const langs = await import('../src/lib/sources/suwayomi/langs');
  await migrate();
  const Fastify = (await import('fastify')).default;
  const app = Fastify();
  await app.register((await import('@fastify/jwt')).default, { secret: process.env.JWT_SECRET! });
  await app.register((await import('../src/routes/catalog')).default);
  await app.register((await import('../src/routes/personal')).default);
  await app.ready();
  const ids: string[] = [];
  const sid = 'household-test-series';
  const sources = [
    { id: 'household-fr', name: 'French', lang: 'fr' },
    { id: 'household-en', name: 'English', lang: 'en' },
    { id: 'household-es', name: 'Spanish', lang: 'es' },
  ];
  const settings = (await q('SELECT adult_genres, adult_sources, hidden_langs, enabled_langs FROM server_settings WHERE id = 1'))[0];
  try {
    await q(`UPDATE server_settings SET adult_genres = '[]', adult_sources = '[]', hidden_langs = '[]', enabled_langs = '[]' WHERE id = 1`);
    invalidateAdultFilter();
    for (const cap of [null, 13, 18]) {
      const user = (await q<{ id: string }>(`INSERT INTO users (display_name, role, password_hash, max_age_rating)
        VALUES ('Household test', 'user', 'unused', $1) RETURNING id`, [cap]))[0];
      ids.push(user.id);
    }
    const headers = (id: string) => ({ authorization: `Bearer ${app.jwt.sign({ sub: id, role: 'user' })}` });
    await t.test('empty tags still offer Show 18+ to permitted profiles only', async () => {
      for (const [i, allowed] of [true, false, true].entries()) {
        const r = await app.inject({ method: 'GET', url: '/api/adult-filter', headers: headers(ids[i]) });
        assert.equal(r.statusCode, 200, r.body);
        assert.deepEqual(r.json(), { configured: false, canShowAdult: allowed });
      }
    });
    await q(`INSERT INTO lib_series (id, source, title, folder) VALUES ($1, 'test', 'Household test', $1)`, [sid]);
    await t.test('half-star API values round-trip as numbers and survive another migration', async () => {
      for (let stars = 0.5; stars <= 5; stars += 0.5) {
        const r = await app.inject({ method: 'PUT', url: `/api/ratings/${sid}`, headers: headers(ids[0]), payload: { stars } });
        assert.equal(r.statusCode, 200, r.body);
        assert.equal((await q('SELECT stars FROM ratings WHERE user_id = $1 AND series_id = $2', [ids[0], sid]))[0].stars, stars);
      }
      for (const stars of [0, 0.25, 3.7, 5.5, '4.5']) {
        const r = await app.inject({ method: 'PUT', url: `/api/ratings/${sid}`, headers: headers(ids[0]), payload: { stars } });
        assert.ok(r.statusCode >= 400, `accepted ${stars}`);
      }
      await q('UPDATE ratings SET stars = 4.5 WHERE user_id = $1 AND series_id = $2', [ids[0], sid]);
      await migrate();
      assert.equal((await q('SELECT stars FROM ratings WHERE user_id = $1 AND series_id = $2', [ids[0], sid]))[0].stars, 4.5);
      await assert.rejects(q('UPDATE ratings SET stars = 4.25 WHERE user_id = $1 AND series_id = $2', [ids[0], sid]));
    });
    await t.test('language preferences, individual overrides, and updates preserve their distinct scope', async () => {
      assert.deepEqual(await langs.adoptExtensionSources(sources, true), { on: 1, hidden: 2 });
      await langs.setSourcesEnabled({ ids: ['household-fr'], enabled: true });
      assert.deepEqual((await q('SELECT enabled_langs FROM server_settings WHERE id = 1'))[0].enabled_langs, []);
      assert.deepEqual(await langs.adoptExtensionSources(sources, true, true), { on: 2, hidden: 1 });
      await langs.setSourcesEnabled({ langs: ['es'], enabled: true });
      assert.deepEqual(await langs.adoptExtensionSources(sources, true), { on: 2, hidden: 1 });
      await langs.setSourcesEnabled({ langs: ['es'], enabled: false });
      assert.deepEqual(await langs.adoptExtensionSources(sources, true), { on: 1, hidden: 2 });
    });
  } finally {
    await app.close();
    await q('DELETE FROM ratings WHERE series_id = $1', [sid]);
    await q('DELETE FROM lib_series WHERE id = $1', [sid]);
    await q('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]);
    await q('DELETE FROM suwayomi_sources WHERE source_id = ANY($1::text[])', [sources.map((s) => s.id)]);
    await q('UPDATE server_settings SET adult_genres = $1, adult_sources = $2, hidden_langs = $3, enabled_langs = $4 WHERE id = 1',
      [settings.adult_genres, settings.adult_sources, settings.hidden_langs, settings.enabled_langs].map((v) => JSON.stringify(v)));
    invalidateAdultFilter();
  }
});
