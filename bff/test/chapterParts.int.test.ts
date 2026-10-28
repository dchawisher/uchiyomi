import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DSN = process.env.TEST_DATABASE_URL;
const skip = DSN ? false : 'set TEST_DATABASE_URL to run';
const root = DSN ? mkdtempSync(join(tmpdir(), 'uchi-parts-')) : '';
if (DSN) Object.assign(process.env, {
  DATABASE_URL: DSN, JWT_SECRET: 'parts-test-secret-at-least-16-chars', CONFIG_DIR: join(root, 'config'),
  LIBRARY_ROOT: join(root, 'lib'), DL_ROOT: join(root, 'dl'), CACHE_DIR: join(root, 'cache'),
  LIBRARY_BACKEND: 'owned', UCHIYOMI_PING_URL: '', MIN_FREE_GB: '0',
});
const S = 'parts-test', SRC = 'parts-source';
let q: any, pool: any, app: any, policy: any, listing: any;
let admin: Record<string, string>, reader: Record<string, string>, adminId: string;
const bid = (n: number) => `parts-${n}`;
const request = (method: string, url: string, payload?: unknown, headers = admin) => app.inject({ method, url, payload, headers });
async function ok(method: string, url: string, payload?: unknown, headers = admin) {
  const r = await request(method, url, payload, headers);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
const set = (fullChapters: boolean) => ok('PATCH', `/api/admin/series/${S}`, { fullChapters });
const books = async (headers = admin) => (await ok('GET', `/api/series/${S}/books?size=100`, undefined, headers)).content;
const separate = (number: number, keepSeparate: boolean) => ok('PUT', `/api/admin/series/${S}/part-exception`, { number, keepSeparate });
const numbers = [20, 20.1, 20.2, 20.5, 21.1, 21.2, 22, 22.1, 23, 23.1];
const chapters = (ns: number[]) => ns.map(number => ({ number, source: SRC, sourceId: `ch-${number}`, title: `Chapter ${number}`, order: number, publishedAt: '2020-01-01T00:00:00Z', lang: 'en' }));
async function writeListing(ns: number[]) {
  const cs = chapters(ns);
  await listing.replaceListing(S, listing.listingRows(cs, cs, new Set(), SRC));
}
async function addBook(n: number) {
  await q(`INSERT INTO lib_books (id, series_id, source, file, title, number, pages) VALUES ($1,$2,'test',$1,$1,$3,10)`, [bid(n), S, n]);
}
before(async () => {
  if (!DSN) return;
  globalThis.fetch = (async () => new Response('', { status: 404 })) as typeof fetch;
  ({ q, pool } = await import('../src/lib/db'));
  await (await import('../src/lib/migrate')).migrate();
  policy = await import('../src/lib/chapterParts');
  listing = await import('../src/lib/seriesListing');
  (await import('../src/lib/sources')).registerAdapter({
    id: SRC, name: 'Parts test', lang: 'en', async search() { return []; },
    async getSeries() { return { source: SRC, sourceId: 'test', title: 'Parts test' }; },
    async listChapters() { return chapters([20, 20.1, 20.2, 20.5, 21.1, 21.2, 24, 24.1]); },
    async getPageUrls() { throw new Error('A listing-only sweep must not download'); },
    async latest() { return []; },
  } as any);
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('@fastify/jwt')).default, { secret: process.env.JWT_SECRET! });
  await app.register((await import('@fastify/rate-limit')).default, { global: false });
  for (const route of ['admin', 'catalog']) await app.register((await import(`../src/routes/${route}`)).default);
  await app.ready();
  await q(`DELETE FROM users WHERE username LIKE 'parts-test-%'`);
  for (const role of ['admin', 'user']) {
    const [{ id }] = await q(`INSERT INTO users (username,display_name,password_hash,role,auth_kind) VALUES ($1,$1,'x',$2,'password') RETURNING id`, [`parts-test-${role}`, role]);
    const headers = { authorization: `Bearer ${app.jwt.sign({ sub: id, role })}` };
    if (role === 'admin') { admin = headers; adminId = id; } else reader = headers;
  }
});
beforeEach(async () => {
  if (!DSN) return;
  await q('DELETE FROM lib_series WHERE id=$1', [S]);
  await q(`INSERT INTO lib_series (id,source,title,folder,source_id,source_series_id,books_count) VALUES ($1,'test','Parts test',$2,$3,'test',10)`, [S, join(root, 'dl', 'Parts test'), SRC]);
  for (const n of numbers) await addBook(n);
});
after(async () => {
  if (!DSN) return;
  await app?.close();
  await q('DELETE FROM lib_series WHERE id=$1', [S]);
  await q(`DELETE FROM users WHERE username LIKE 'parts-test-%'`);
  await pool.end();
  rmSync(root, { recursive: true, force: true });
});

test('opt-in keeps all files accessible, collapses parts only with a usable whole, and skips them in navigation', { skip }, async () => {
  assert.ok((await books()).every((b: any) => !b.alternateOf));
  await set(true);
  let bs = await books();
  assert.equal(bs.length, 10);
  assert.equal(bs.find((b: any) => b.number === 20.1).alternateOf, bid(20));
  assert.equal(bs.find((b: any) => b.number === 21.1).alternateOf, null);
  assert.equal((await ok('GET', `/api/books/${bid(20)}/next`)).id, bid(20.5));
  for (const field of ["pruned_at = now()", "pruned_at = NULL, missing_pages = ARRAY[2]"]) {
    await q(`UPDATE lib_books SET ${field} WHERE id=$1`, [bid(20)]);
    assert.equal((await books()).find((b: any) => b.number === 20.1).alternateOf, null);
  }
  await q('UPDATE lib_books SET missing_pages=NULL WHERE id=$1', [bid(20)]);
  await separate(20.1, true);
  assert.equal((await books()).find((b: any) => b.number === 20.1).alternateOf, null);
  await separate(20.1, false);
  assert.equal((await books()).find((b: any) => b.number === 20.1).alternateOf, bid(20));
  await set(false);
  assert.ok((await books()).every((b: any) => !b.alternateOf));
});

test('.5 stays a bonus without .4; .4 can be listed or downloaded; explicit extra wins', { skip }, async () => {
  await set(true);
  assert.equal(policy.isPartNumber(20.5, new Set([20, 20.1, 20.2])), false);
  assert.equal(policy.isPartNumber(20.5, new Set([20.4])), true);
  assert.equal((await books()).find((b: any) => b.number === 20.5).alternateOf, null);
  assert.deepEqual([...await policy.coveredParts(S, [20, 20.1, 20.5])], [20.1]);
  await writeListing([20, 20.4, 20.5]);
  assert.equal((await books()).find((b: any) => b.number === 20.5).alternateOf, bid(20));
  await q('DELETE FROM series_listing WHERE series_id=$1', [S]);
  await addBook(20.4);
  assert.equal((await books()).find((b: any) => b.number === 20.5).alternateOf, bid(20));
  await separate(20.5, true);
  assert.equal((await books()).find((b: any) => b.number === 20.5).alternateOf, null);
  assert.ok(!(await policy.coveredParts(S, [20, 20.4, 20.5])).has(20.5));
});

test('completion covers parts only for that reader, without inventing stored progress', { skip }, async () => {
  await set(true);
  await q(`INSERT INTO read_progress (user_id,book_id,series_id,page,completed) VALUES ($1,$2,$3,10,true)`, [adminId, bid(20), S]);
  const a = (await books()).find((b: any) => b.number === 20.1);
  const r = (await books(reader)).find((b: any) => b.number === 20.1);
  assert.equal(a.readProgress.completed, true);
  assert.ok(!r.readProgress?.completed);
  assert.equal((await q('SELECT * FROM read_progress WHERE book_id=$1', [bid(20.1)])).length, 0);
  await set(false);
  assert.ok(!(await books()).find((b: any) => b.number === 20.1).readProgress?.completed);
});

test('listing coverage is reversible and survives a preference reapplication', { skip }, async () => {
  await writeListing([20, 20.1, 20.5, 21.1, 24, 24.1]);
  await set(true);
  const status = async (n: number) => (await q('SELECT status FROM series_listing WHERE series_id=$1 AND number=$2::real', [S,n]))[0].status;
  assert.equal(await status(20.1), 'covered');
  assert.equal(await status(24.1), 'covered');
  assert.equal(await status(20.5), 'available');
  assert.equal(await status(21.1), 'available');
  await (await import('../src/lib/db')).tx(qq => listing.reapplyBlocklistInTransaction(qq, [S]));
  assert.equal(await status(20.1), 'covered');
  await separate(20.1, true);
  assert.equal(await status(20.1), 'available');
  await set(false);
  assert.equal(await status(24.1), 'available');
});

test('mapped volumes replace covered chapter entries, counts and navigation without enabling split conventions', { skip }, async () => {
  await addBook(1);
  await q('UPDATE lib_series SET books_count=11 WHERE id=$1', [S]);
  await ok('PUT', `/api/admin/books/${bid(1)}/meta`, { number: 20, numberEnd: 21.1, volumeNumber: 1, volumeNumberEnd: 2 });
  await separate(20.5, true); // An explicit volume range includes bonuses too.
  const before = await books();
  assert.equal(before.length, 11); // Kept accessible by id and in other versions.
  for (const n of [20, 20.1, 20.2, 20.5, 21.1]) {
    assert.equal(before.find((b: any) => b.id === bid(n)).alternateOf, bid(1));
    assert.equal((await ok('GET', `/api/books/${bid(n)}`)).id, bid(n));
  }
  assert.equal(before.find((b: any) => b.id === bid(21.2)).alternateOf, null);
  assert.equal(before.find((b: any) => b.id === bid(1)).alternateOf, null);
  assert.equal((await ok('GET', `/api/series/${S}`)).booksCount, 6);
  assert.equal((await ok('GET', `/api/books/${bid(1)}/next`)).id, bid(21.2));
  const { owned } = await import('../src/lib/ownedCatalog');
  const { SYSTEM_CTX } = await import('../src/lib/visibility');
  assert.equal((await owned.bookPrevious(SYSTEM_CTX, bid(21.2))).id, bid(1));
  await q(`INSERT INTO read_progress (user_id,book_id,series_id,page,completed) VALUES ($1,$2,$3,3,false)`, [adminId, bid(20.1), S]);
  await q(`INSERT INTO read_progress (user_id,book_id,series_id,page,completed) VALUES ($1,$2,$3,10,true)`, [adminId, bid(1), S]);
  assert.equal((await books()).find((b: any) => b.id === bid(20.1)).readProgress.completed, true);
  assert.ok(!(await books(reader)).find((b: any) => b.id === bid(20.1)).readProgress?.completed);
  assert.deepEqual((await q('SELECT page,completed FROM read_progress WHERE book_id=$1', [bid(20.1)]))[0], { page: 3, completed: false });
  await ok('PUT', `/api/admin/books/${bid(1)}/meta`, { number: null, numberEnd: null, volumeNumber: null, volumeNumberEnd: null });
  assert.ok((await books()).every((b: any) => !b.alternateOf));
  assert.equal((await ok('GET', `/api/series/${S}`)).booksCount, 11);
  assert.equal((await books()).find((b: any) => b.id === bid(20.1)).readProgress.page, 3);
});

test('unusable volumes and unmapped ranges do not hide chapters; volumes never hide one another', { skip }, async () => {
  await q(`INSERT INTO book_overrides (book_id,number,number_end,volume_number) VALUES ($1,20,22.1,1)`, [bid(20)]);
  assert.equal((await books()).find((b: any) => b.id === bid(22.1)).alternateOf, bid(20));
  for (const field of ["pruned_at = now()", "pruned_at = NULL, missing_pages = ARRAY[2]"]) {
    await q(`UPDATE lib_books SET ${field} WHERE id=$1`, [bid(20)]);
    assert.ok((await books()).every((b: any) => !b.alternateOf));
  }
  // Zero is the scanner's initial, uninspected page count, not evidence of an empty archive.
  await q('UPDATE lib_books SET missing_pages=NULL, pages=0 WHERE id=$1', [bid(20)]);
  assert.equal((await books()).find((b: any) => b.id === bid(22.1)).alternateOf, bid(20));
  await q(`INSERT INTO book_overrides (book_id,number,number_end,volume_number) VALUES ($1,21,21.2,2)`, [bid(21.1)]);
  assert.equal((await books()).find((b: any) => b.id === bid(21.1)).alternateOf, null);
  await q('DELETE FROM book_overrides WHERE book_id=ANY($1::text[])', [[bid(20),bid(21.1)]]);
  await q('UPDATE lib_books SET number_end=22.1 WHERE id=$1', [bid(20)]);
  assert.ok((await books()).every((b: any) => !b.alternateOf));
});

test('listing-only updater keeps lone .5 and uncovered parts, and prefers available full releases', { skip }, async () => {
  await set(true);
  await (await import('../src/lib/updater')).updateSeries(S, 0);
  const rows = await q('SELECT number,status FROM series_listing WHERE series_id=$1 ORDER BY number', [S]);
  assert.equal(rows.find((r: any) => r.number === 24.1)?.status, 'covered');
  assert.equal(rows.find((r: any) => r.number === 20.5)?.status, 'available');
  assert.equal(rows.find((r: any) => r.number === 21.1)?.status, 'available');
});

test('only admins can change the convention; malformed exceptions and incompatible numbering are refused', { skip }, async () => {
  assert.equal((await request('PATCH', `/api/admin/series/${S}`, { fullChapters: true }, reader)).statusCode, 403);
  assert.equal((await request('PUT', `/api/admin/series/${S}/part-exception`, { number: 20, keepSeparate: true })).statusCode, 400);
  await q("UPDATE lib_series SET numbering='posting_order' WHERE id=$1", [S]);
  assert.equal((await request('PATCH', `/api/admin/series/${S}`, { fullChapters: true })).statusCode, 409);
});
