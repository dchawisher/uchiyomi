import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DSN = process.env.TEST_DATABASE_URL;
const skip = DSN ? false : 'set TEST_DATABASE_URL to run';
let root = '';
if (DSN) {
  root = mkdtempSync(join(tmpdir(), 'uchi-short-check-'));
  Object.assign(process.env, {
    DATABASE_URL: DSN, JWT_SECRET: 'short-check-test-secret-16-chars', CONFIG_DIR: join(root, 'config'),
    LIBRARY_ROOT: join(root, 'lib'), DL_ROOT: join(root, 'dl'), CACHE_DIR: join(root, 'cache'),
    LIBRARY_BACKEND: 'owned', UCHIYOMI_PING_URL: '',
  });
}
const A = 'short-check-a', B = 'short-check-b';
let app: any, q: any, pool: any, migrate: any, shortChapters: any;
let admin: Record<string, string>, reader: Record<string, string>;
const route = (id: string) => `/api/admin/series/${id}/short-chapter-check`;
const report = () => app.inject({ method: 'GET', url: '/api/admin/health/short-chapters', headers: admin });
const set = (id: string, enabled: boolean) => app.inject({ method: 'POST', url: route(id), headers: admin, payload: { enabled } });

before(async () => {
  if (!DSN) return;
  ({ q, pool } = await import('../src/lib/db'));
  ({ migrate } = await import('../src/lib/migrate'));
  ({ shortChapters } = await import('../src/lib/health'));
  await migrate();
  await q('DELETE FROM lib_series WHERE id = ANY($1)', [[A, B]]);
  await q(`INSERT INTO lib_series (id, source, title, folder) VALUES ($1, 'test', 'Short A', $1), ($2, 'test', 'Short B', $2)`, [A, B]);
  // More than the main report's fifty-row preview: the second series must still be configurable.
  for (const sid of [A, B]) await q(`INSERT INTO lib_books (id, series_id, source, file, title, number, pages, page_dims)
    SELECT $1 || '-' || n, $1, 'test', $1 || '/' || n || '.cbz', 'Chapter ' || n, n, 2,
      '[{"width":800,"height":1200},{"width":800,"height":1200}]'::jsonb FROM generate_series(1, 55) n`, [sid]);
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('@fastify/jwt')).default, { secret: process.env.JWT_SECRET! });
  await app.register((await import('@fastify/rate-limit')).default, { global: false });
  await app.register((await import('../src/routes/admin')).default);
  await app.ready();
  await q(`DELETE FROM users WHERE username IN ('short-check-admin','short-check-reader')`);
  for (const role of ['admin', 'user']) {
    const name = role === 'admin' ? 'short-check-admin' : 'short-check-reader';
    const [{ id }] = await q(`INSERT INTO users (username, display_name, password_hash, role, auth_kind)
      VALUES ($1, $1, 'x', $2, 'password') RETURNING id`, [name, role]);
    const headers = { authorization: `Bearer ${app.jwt.sign({ sub: id, role })}` };
    if (role === 'admin') admin = headers; else reader = headers;
  }
});

after(async () => {
  if (!DSN) return;
  await app?.close();
  await q('DELETE FROM lib_series WHERE id = ANY($1)', [[A, B]]);
  await q(`DELETE FROM users WHERE username IN ('short-check-admin','short-check-reader')`);
  await pool.end();
  rmSync(root, { recursive: true, force: true });
});

test('short-chapter detail includes every series and chapter beyond the preview', { skip }, async () => {
  const response = await report();
  assert.equal(response.statusCode, 200, response.body);
  const data = response.json();
  for (const sid of [A, B]) assert.equal(data.items.filter((i: any) => i.seriesId === sid).length, 55);
  assert.equal(data.disabledSeries.length, 0);
  assert.equal((await shortChapters()).items.length, 50);
});

test('disabling survives migration reruns and excludes future chapters until re-enabled', { skip }, async () => {
  assert.equal((await set(A, false)).statusCode, 200);
  await q(`INSERT INTO lib_books (id, series_id, source, file, title, number, pages)
    VALUES ('short-check-new', $1, 'test', 'short-check-new.cbz', 'New chapter', 56, 1)`, [A]);
  await migrate();
  let data = (await report()).json();
  assert.equal(data.items.some((i: any) => i.seriesId === A), false);
  assert.equal(data.items.filter((i: any) => i.seriesId === B).length, 55);
  assert.deepEqual(data.disabledSeries, [{ seriesId: A, title: 'Short A' }]);
  assert.equal((await shortChapters()).items.some((i: any) => i.seriesId === A), false);
  assert.equal((await set(A, true)).statusCode, 200);
  data = (await report()).json();
  assert.equal(data.items.filter((i: any) => i.seriesId === A).length, 56);
  assert.deepEqual(data.disabledSeries, []);
});

test('only admins may inspect or change series exclusions; invalid writes leave settings unchanged', { skip }, async () => {
  for (const headers of [{}, reader]) {
    const result = await app.inject({ method: 'POST', url: route(A), headers, payload: { enabled: false } });
    assert.ok([401, 403].includes(result.statusCode), result.body);
    const get = await app.inject({ method: 'GET', url: '/api/admin/health/short-chapters', headers });
    assert.ok([401, 403].includes(get.statusCode), get.body);
  }
  for (const payload of [{}, { enabled: 'false' }, { enabled: false, other: true }]) {
    assert.equal((await app.inject({ method: 'POST', url: route(A), headers: admin, payload })).statusCode, 400);
  }
  assert.equal((await set('missing-series', false)).statusCode, 404);
  assert.equal((await q('SELECT check_short_chapters FROM lib_series WHERE id = $1', [A]))[0].check_short_chapters, true);
});
