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
const pageRequests: string[] = [];
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
const chapters = (ns: number[]) => ns.map(number => ({ number, source: SRC, sourceId: `ch-${number}`, title: `Chapter ${number}`, order: number, pages: Number.isInteger(number) ? 40 : 10, publishedAt: '2020-01-01T00:00:00Z', lang: 'en' }));
async function writeListing(ns: number[]) {
  const cs = chapters(ns);
  await listing.replaceListing(S, listing.listingRows(cs, cs, new Set(), SRC));
}
async function addBook(n: number) {
  await q(`INSERT INTO lib_books (id, series_id, source, file, title, number, pages) VALUES ($1,$2,'test',$1,$1,$3,CASE WHEN $3::real=floor($3::real) THEN 40 ELSE 10 END)`, [bid(n), S, n]);
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
    async getPageUrls(id:string) {
      pageRequests.push(id);
      if (id.startsWith('ch-50')) return Array.from({length:id==='ch-50'?12:10},(_,i)=>`https://invalid.test/image-${i}.jpg`);
      throw new Error('No page list');
    },
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
  await q(`INSERT INTO lib_series (id,source,title,folder,source_id,source_series_id,books_count,full_chapters) VALUES ($1,'test','Parts test',$2,$3,'test',10,false)`, [S, join(root, 'dl', 'Parts test'), SRC]);
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

const mode = (partDetection: string) => ok('PATCH', `/api/admin/series/${S}`, { partDetection });
const manual = (number: number, role: string, parentNumber?: number) => ok('PUT', `/api/admin/series/${S}/chapter-grouping`, { number, role, ...(parentNumber === undefined ? {} : {parentNumber}) });
const get = async (n: number) => (await books()).find((b:any) => b.number===n);

test('page threshold is sum minus four per identified part, including equality; unknown counts retain parts', { skip }, async () => {
  await mode('careful');
  // 20.1, 20.2, 20.5: three 10-page parts need an 18-page complete chapter.
  await q('UPDATE lib_books SET pages=17 WHERE id=$1',[bid(20)]);
  assert.equal((await get(20.1)).alternateOf,null);
  await q('UPDATE lib_books SET pages=18 WHERE id=$1',[bid(20)]);
  assert.equal((await get(20.1)).alternateOf,bid(20));
  assert.equal((await get(20.1)).grouping.requiredPages,18);
  await q('UPDATE lib_books SET pages=0 WHERE id=$1',[bid(20.2)]);
  assert.equal((await get(20.1)).alternateOf,null);
  assert.equal((await get(20.1)).grouping.requiredPages,null);
});

test('levels distinguish a lone non-.5 and a lone .5; Off leaves manual choices intact', { skip }, async () => {
  await addBook(30);await addBook(30.5);
  await mode('careful');
  assert.equal((await get(22.1)).grouping.role,'extra');
  assert.equal((await get(30.5)).grouping.role,'extra');
  await mode('balanced');
  assert.equal((await get(22.1)).alternateOf,bid(22));
  assert.equal((await get(30.5)).grouping.role,'extra');
  await mode('aggressive');
  assert.equal((await get(30.5)).alternateOf,bid(30));
  await manual(22.1,'part',22);
  await mode('off');
  assert.equal((await get(30.5)).alternateOf,null);
  assert.equal((await get(22.1)).alternateOf,bid(22));
  assert.equal((await get(22.1)).grouping.manual,true);
});

test('missing .1 makes unsuffixed entry first, at every level; no renumbering or progress rewrite', { skip }, async () => {
  await q('DELETE FROM lib_books WHERE id=$1',[bid(20.1)]);
  await q(`INSERT INTO read_progress(user_id,book_id,series_id,page,completed) VALUES ($1,$2,$3,7,false)`,[adminId,bid(20),S]);
  for(const level of ['careful','balanced','aggressive']) {
    await mode(level);
    assert.equal((await get(20)).grouping.role,'first');
    assert.equal((await get(20)).number,20);
    assert.equal((await get(20.2)).alternateOf,null);
    assert.equal((await ok('GET',`/api/books/${bid(20)}/next`)).id,bid(20.2));
  }
  assert.deepEqual((await q('SELECT page,completed FROM read_progress WHERE book_id=$1',[bid(20)]))[0],{page:7,completed:false});
  await manual(20,'complete');
  assert.equal((await get(20.2)).alternateOf,bid(20));
  await mode('off');
  // A complete-chapter declaration doesn't invent associations after detection is disabled.
  assert.equal((await get(20.2)).alternateOf,null);
  await manual(20.2,'part',20);
  assert.equal((await get(20.2)).alternateOf,bid(20));
});

test('manual extra/association/first/complete survive listing refreshes and explicit reset restores detection', { skip }, async () => {
  await mode('aggressive');
  await manual(20.1,'extra');
  await manual(23.1,'part',22);
  await writeListing(numbers);
  await mode('balanced');
  assert.equal((await get(20.1)).grouping.role,'extra');
  assert.equal((await get(23.1)).grouping.parentNumber,22);
  await manual(22,'first');
  assert.equal((await get(23.1)).alternateOf,null);
  await manual(22,'complete');
  assert.equal((await get(23.1)).alternateOf,bid(22));
  await manual(20.1,'auto');
  assert.equal((await get(20.1)).grouping.manual,false);
  assert.equal((await get(20.1)).alternateOf,bid(20));
});

test('completion covers parts for that reader only; no stored child progress is invented', { skip }, async () => {
  await mode('careful');
  await q(`INSERT INTO read_progress(user_id,book_id,series_id,page,completed) VALUES ($1,$2,$3,40,true)`,[adminId,bid(20),S]);
  assert.equal((await get(20.1)).readProgress.completed,true);
  assert.ok(!(await books(reader)).find((b:any)=>b.number===20.1).readProgress?.completed);
  assert.equal((await q('SELECT * FROM read_progress WHERE book_id=$1',[bid(20.1)])).length,0);
  await manual(20,'first');
  assert.ok(!(await get(20.1)).readProgress?.completed);
});

test('download coverage uses the same page threshold and cannot suppress unknown or first-part releases', { skip }, async () => {
  await mode('careful');
  await q('DELETE FROM lib_books WHERE series_id=$1',[S]);
  const cs=[{number:40,pages:12},{number:40.1,pages:10},{number:40.2,pages:10}];
  assert.deepEqual([...await policy.coveredParts(S,cs.map(c=>c.number),q,[],cs)].sort(),[40.1,40.2]);
  cs[0].pages=11;
  assert.deepEqual([...await policy.coveredParts(S,cs.map(c=>c.number),q,[],cs)],[]);
  assert.deepEqual([...await policy.coveredParts(S,[40,40.2,40.3],q,[],[{number:40,pages:100},{number:40.2,pages:10},{number:40.3,pages:10}])],[]);
  await writeListing([40,40.1,40.2]);
  assert.equal((await q('SELECT status FROM series_listing WHERE series_id=$1 AND number=40.1::real',[S]))[0].status,'covered');
  await mode('off');
  assert.equal((await q('SELECT status FROM series_listing WHERE series_id=$1 AND number=40.1::real',[S]))[0].status,'available');
});

test('volume mappings still hide covered chapters independently of part detection and preserve progress', { skip }, async () => {
  await addBook(1);
  await q('UPDATE lib_series SET books_count=11 WHERE id=$1',[S]);
  await ok('PUT',`/api/admin/books/${bid(1)}/meta`,{number:20,numberEnd:21.1,volumeNumber:1,volumeNumberEnd:2});
  await manual(20.1,'extra');
  for(const n of [20,20.1,20.2,20.5,21.1]) assert.equal((await books()).find((b:any)=>b.id===bid(n)).alternateOf,bid(1));
  assert.equal((await get(21.2)).alternateOf,null);
  assert.equal((await ok('GET',`/api/series/${S}`)).booksCount,6);
  assert.equal((await ok('GET',`/api/books/${bid(1)}/next`)).id,bid(21.2));
  await q('UPDATE lib_books SET missing_pages=ARRAY[1] WHERE id=$1',[bid(1)]);
  assert.equal((await get(20.1)).alternateOf,null);
});

test('only admins can change associations; malformed choices and incompatible numbering are rejected', { skip }, async () => {
  assert.equal((await request('PUT',`/api/admin/series/${S}/chapter-grouping`,{number:20.1,role:'extra'},reader)).statusCode,403);
  assert.equal((await request('PUT',`/api/admin/series/${S}/chapter-grouping`,{number:20,role:'part',parentNumber:20})).statusCode,400);
  assert.equal((await request('PUT',`/api/admin/series/${S}/chapter-grouping`,{number:20.1,role:'complete'})).statusCode,400);
  await q("UPDATE lib_series SET numbering='posting_order' WHERE id=$1",[S]);
  assert.equal((await request('PATCH',`/api/admin/series/${S}`,{partDetection:'careful'})).statusCode,409);
});

test('source page counts use URL lists without image downloads, cache successes/failures, and update coverage', { skip }, async () => {
  await mode('careful');
  await q('DELETE FROM lib_books WHERE series_id=$1',[S]);
  await q('DELETE FROM chapter_page_counts WHERE source=$1',[SRC]);
  const cs=chapters([50,50.1,50.2,51,51.1,51.2]).map(c=>({...c,pages:undefined}));
  await listing.replaceListing(S,listing.listingRows(cs,cs,new Set(),SRC));
  pageRequests.length=0;
  const report=await ok('POST',`/api/admin/series/${S}/chapter-page-counts`,{});
  assert.deepEqual(report,{checked:3,failed:1,remaining:2});
  assert.equal(pageRequests.length,4);
  const state=await q('SELECT number,status FROM series_listing WHERE series_id=$1',[S]);
  assert.equal(state.find((r:any)=>r.number===50.1).status,'covered');
  assert.equal(state.find((r:any)=>r.number===51.1).status,'available');
  assert.deepEqual([...await policy.coveredParts(S,cs.map(c=>c.number),q,[],cs)].sort(),[50.1,50.2],
    'fresh source listings without counts must reuse cached counts for the exact release');
  const otherCopy=cs.map(c=>({...c,sourceId:c.number===50?'different-copy':c.sourceId}));
  assert.deepEqual([...await policy.coveredParts(S,otherCopy.map(c=>c.number),q,[],otherCopy)],[],
    'a different copy of the parent must not inherit the old copy’s page count');
  await ok('POST',`/api/admin/series/${S}/chapter-page-counts`,{});
  await ok('POST',`/api/admin/series/${S}/chapter-page-counts`,{});
  assert.equal(pageRequests.length,6,'cached failures must not cause repeated requests');
});

test('new series default to careful; legacy keep-separate choices survive changing levels', { skip }, async () => {
  await q("INSERT INTO lib_series(id,source,title,folder) VALUES ('grouping-default','test','Default','default')");
  assert.equal((await ok('GET','/api/series/grouping-default')).partDetection,'careful');
  await q("DELETE FROM lib_series WHERE id='grouping-default'");
  await separate(20.1,true);
  await mode('aggressive');
  assert.equal((await get(20.1)).grouping.role,'extra');
  assert.equal((await get(20.1)).grouping.manual,true);
});

test('chapter manager includes undownloaded and covered releases; manual choices control pre-download coverage', {skip}, async()=>{
  await mode('careful');
  await writeListing([30,30.1,30.2]);
  const entries=async()=> (await ok('GET',`/api/admin/series/${S}/chapter-grouping`)).content;
  let rows=await entries();
  assert.deepEqual(rows.map((r:any)=>r.number),[30,30.1,30.2]);
  assert.equal(rows[0].pagesCount,40);
  assert.equal(rows[1].pagesCount,10);
  assert.deepEqual(rows[1].coveredBy,{kind:'chapter',number:30});
  assert.equal((await q('SELECT id FROM lib_books WHERE series_id=$1 AND number>=30',[S])).length,0);
  await manual(30,'complete');
  await manual(30.1,'part',30);
  await manual(30.2,'extra');
  await mode('off');
  rows=await entries();
  assert.deepEqual(rows[1].coveredBy,{kind:'chapter',number:30});
  assert.equal(rows[1].grouping.manual,true);
  assert.equal(rows[1].status,'covered');
  assert.equal(rows[2].coveredBy,null);
  assert.equal(rows[2].status,'available');
  assert.equal(rows[2].grouping.role,'extra');
  assert.deepEqual([...await policy.coveredParts(S,[30,30.1,30.2])],[30.1]);
  assert.equal((await request('GET',`/api/admin/series/${S}/chapter-grouping`,undefined,reader)).statusCode,403);
  assert.equal((await request('GET',`/api/admin/series/no-such-series/chapter-grouping`)).statusCode,404);
});

test('chapter manager shows cached page counts, unknown counts, and remote chapters covered by a held volume', {skip}, async()=>{
  await writeListing([40,41,42]);
  await q(`INSERT INTO book_overrides(book_id,number,number_end,volume_number) VALUES ($1,40,42,7)`,[bid(20)]);
  await q(`UPDATE series_listing SET copies=(SELECT jsonb_agg(c-'pages') FROM jsonb_array_elements(copies)c) WHERE series_id=$1`,[S]);
  await q(`INSERT INTO chapter_page_counts(source,chapter_id,pages) VALUES ($1,'ch-41',24) ON CONFLICT(source,chapter_id) DO UPDATE SET pages=24`,[SRC]);
  const rows=(await ok('GET',`/api/admin/series/${S}/chapter-grouping`)).content;
  assert.equal(rows[0].pagesCount,null);
  assert.equal(rows[1].pagesCount,24);
  assert.equal(rows[2].pagesCount,null);
  for(const row of rows)assert.deepEqual(row.coveredBy,{kind:'volume',number:7,end:null});
});
