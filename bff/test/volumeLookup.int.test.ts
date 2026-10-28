import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
const DSN = process.env.TEST_DATABASE_URL;
const skip = DSN ? false : 'set TEST_DATABASE_URL to run';
if (DSN) Object.assign(process.env, { DATABASE_URL: DSN, JWT_SECRET: 'volume-test-secret-at-least-16-chars',
  CONFIG_DIR: '/tmp/uchi-volume-test', LIBRARY_BACKEND: 'owned', UCHIYOMI_PING_URL: '' });
const S = 'volume-test', MD = 'baa95345-24fb-47a9-83e9-434ff671f968';
let q: any, pool: any, app: any, admin: any, reader: any, adminId: string;
let failLookup = false;
const request = (method: string, path: string, payload?: unknown, headers = admin) => app.inject({ method, url: `/api/admin/series/${S}/${path}`, payload, headers });
const mappings = [ { bookId: 'volume-a', volume: 1, first: 1, last: 8 }, { bookId: 'volume-b', volume: 2, first: 9, last: 16 } ];
before(async () => {
  if (!DSN) return;
  globalThis.fetch = (async (url: string) => {
    if (failLookup) return new Response('', { status: 503 });
    return Response.json(url.includes('/aggregate') ? { volumes: { '1': { chapters: { '1': {}, '2': {}, '2.5': {} } } } }
      : { data: [{ id: MD, attributes: { title: { en: 'Volume Test' }, year: 2020 } }] });
  }) as typeof fetch;
  ({ q, pool } = await import('../src/lib/db'));
  await (await import('../src/lib/migrate')).migrate();
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('@fastify/jwt')).default, { secret: process.env.JWT_SECRET! });
  await app.register((await import('@fastify/rate-limit')).default, { global: false });
  await app.register((await import('../src/routes/admin')).default);
  await app.ready();
  await q("DELETE FROM users WHERE username LIKE 'volume-test-%'");
  for (const role of ['admin', 'user']) {
    const [{ id }] = await q(`INSERT INTO users (username,display_name,password_hash,role,auth_kind)
      VALUES ($1,$1,'x',$2,'password') RETURNING id`, [`volume-test-${role}`, role]);
    const headers = { authorization: `Bearer ${app.jwt.sign({ sub: id, role })}` };
    if (role === 'admin') { admin = headers; adminId = id; } else reader = headers;
  }
});
beforeEach(async () => {
  if (!DSN) return;
  failLookup = false;
  await q('DELETE FROM read_progress WHERE series_id=$1', [S]);
  await q('DELETE FROM lib_series WHERE id=$1', [S]);
  await q(`INSERT INTO lib_series (id,source,title,folder,source_id,source_series_id,books_count)
    VALUES ($1,'test','Volume Test',$1,'mangadex',$2,2)`, [S, MD]);
  for (const [index, id] of ['volume-a', 'volume-b'].entries()) await q(`INSERT INTO lib_books (id,series_id,source,file,title,number,pages)
    VALUES ($1,$2,'test',$1,$3,$4,10)`, [id, S, `Vol ${index + 1}`, index + 1]);
});
after(async () => {
  if (!DSN) return;
  await app?.close();
  await q('DELETE FROM read_progress WHERE series_id=$1', [S]);
  await q('DELETE FROM lib_series WHERE id=$1', [S]);
  await q("DELETE FROM users WHERE username LIKE 'volume-test-%'");
  await pool.end();
});
test('looks up the linked manga; title search presents choices without writing anything', { skip }, async () => {
  const linked = await request('GET', 'volume-lookup');
  assert.equal(linked.statusCode, 200, linked.body);
  assert.equal(linked.json().mangaId, MD);
  assert.deepEqual(linked.json().volumes[0].chapters, [1, 2, 2.5]);
  assert.equal(linked.json().books.length, 2);
  const search = await request('GET', 'volume-lookup?query=Volume');
  assert.equal(search.json().mangaId, null);
  assert.equal(search.json().candidates[0].id, MD);
  assert.equal((await q("SELECT * FROM book_overrides WHERE book_id LIKE 'volume-%'")).length, 0);
});
test('saves a batch, preserves titles, and completed volumes report their last chapter', { skip }, async () => {
  await q("INSERT INTO book_overrides(book_id,title) VALUES ('volume-a','My title')");
  await q("INSERT INTO read_progress(user_id,book_id,series_id,completed,page) VALUES ($1,'volume-b',$2,true,10)", [adminId, S]);
  const response = await request('POST', 'volume-ranges', { mappings });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().saved, 2);
  assert.equal((await q("SELECT title FROM book_overrides WHERE book_id='volume-a'"))[0].title, 'My title');
  const { seriesProgressFor } = await import('../src/lib/trackers');
  assert.equal((await seriesProgressFor(adminId, S)).chapters, 16);
  const { owned } = await import('../src/lib/ownedCatalog');
  const books = (await owned.seriesBooks({ userId: adminId, libraryIds: null, maxAgeRating: null }, S, 0, 50)).content;
  assert.equal(books.find((b: any) => b.id === 'volume-a').numberEnd, 8);
});
test('a mapping saved since preview rejects the whole batch without overwriting it', { skip }, async () => {
  await q("INSERT INTO book_overrides(book_id,number,volume_number,number_end) VALUES ('volume-b',20,2,30)");
  const response = await request('POST', 'volume-ranges', { mappings });
  assert.equal(response.statusCode, 409, response.body);
  const rows = await q("SELECT book_id,number FROM book_overrides WHERE book_id LIKE 'volume-%'");
  assert.deepEqual(rows, [{ book_id: 'volume-b', number: 20 }]);
});
test('refuses foreign files, duplicate files, invalid ranges and non-admin requests', { skip }, async () => {
  assert.equal((await request('POST', 'volume-ranges', { mappings: [mappings[0], { ...mappings[1], bookId: 'foreign' }] })).statusCode, 409);
  assert.equal((await request('POST', 'volume-ranges', { mappings: [mappings[0], mappings[0]] })).statusCode, 400);
  assert.equal((await request('POST', 'volume-ranges', { mappings: [{ ...mappings[0], last: 0 }] })).statusCode, 400);
  assert.equal((await request('GET', 'volume-lookup', undefined, reader)).statusCode, 403);
  assert.equal((await request('POST', 'volume-ranges', { mappings }, reader)).statusCode, 403);
  assert.equal((await request('GET', 'volume-lookup', undefined, {})).statusCode, 401);
});
test('upstream failure is actionable and leaves all mappings alone', { skip }, async () => {
  failLookup = true;
  const response = await request('GET', 'volume-lookup');
  assert.equal(response.statusCode, 502, response.body);
  assert.match(response.json().error, /MangaDex lookup failed/);
  assert.equal((await q("SELECT * FROM book_overrides WHERE book_id LIKE 'volume-%'")).length, 0);
});

test('omnibus spans survive lookup, catalog reads and ordinary metadata edits', { skip }, async () => {
  const response = await request('POST', 'volume-ranges', { mappings: [{ ...mappings[0], volumeEnd: 2, last: 4.1 }] });
  assert.equal(response.statusCode, 200, response.body);
  const lookup = await request('GET', 'volume-lookup');
  assert.equal(lookup.json().books.find((b: any) => b.id === 'volume-a').volumeNumberEnd, 2);
  assert.equal(lookup.json().books.find((b: any) => b.id === 'volume-a').numberEnd, 4.1);
  const edit = (payload: unknown) => app.inject({ method: 'PUT', url: '/api/admin/books/volume-a/meta', headers: admin, payload });
  assert.equal((await edit({ title: 'Omnibus' })).statusCode, 200);
  assert.equal((await q("SELECT volume_number_end FROM book_overrides WHERE book_id='volume-a'"))[0].volume_number_end, 2);
  assert.equal((await edit({ volumeNumberEnd: 0.5 })).statusCode, 400);
  const { owned } = await import('../src/lib/ownedCatalog');
  const books = (await owned.seriesBooks({ userId: adminId, libraryIds: null, maxAgeRating: null }, S, 0, 50)).content;
  assert.equal(books.find((b: any) => b.id === 'volume-a').volumeNumberEnd, 2);
  assert.equal((await edit({ number: null, title: null, volumeNumber: null, numberEnd: null, volumeNumberEnd: null })).statusCode, 200);
});
