// The reader-prefs store is local-first: `savePrefs` writes localStorage at once and PUTs the server 1.5 s
// later. `syncPrefsFromServer` is the other direction, and for the length of that window the server's
// answer is the OLD value. Adopting it put the old value back locally and the debounced PUT then sent the
// old value up as if it were new -- a theme picked on Profile → Settings read "✓ Saved" and was gone from
// the row, the store and the server whenever the section remounted inside the window (a tab away and back,
// a Language chip on the same page). These tests drive the real module against a stubbed server.
import test, { before, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_API_BASE = '';

// The module returns the defaults without touching storage when there is no `window`, and `api.ts` seeds
// itself from localStorage at load, so both stubs go in BEFORE the dynamic imports below.
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  get length() { return mem.size; },
  key: (i: number) => [...mem.keys()][i] ?? null,
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
};
(globalThis as any).window = globalThis;

/** What the stubbed server answers a GET with, and a handle on the PUT so a test can hold it in flight. */
let serverReader: Record<string, unknown> = { theme: 'amoled' };
let serverSeries: Record<string, unknown> = {};
let lastPut: any;
const calls: string[] = [];
let releasePut: (() => void) | null = null;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const method = init?.method ?? 'GET';
  calls.push(`${method} ${url.replace(/\?.*$/, '')}`);
  if (method === 'PUT') {
    lastPut = JSON.parse(String(init?.body));
    await new Promise<void>((resolve) => { releasePut = resolve; });
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response(JSON.stringify({ reader: serverReader, readerSeries: serverSeries }), { status: 200, headers: { 'content-type': 'application/json' } });
}) as any;

let prefs: typeof import('../lib/readerPrefs');
before(async () => {
  prefs = await import('../lib/readerPrefs');
});

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const gets = () => calls.filter((c) => c.startsWith('GET')).length;
const puts = () => calls.filter((c) => c.startsWith('PUT')).length;

test('file pairing is pinned on double-mode opening, inherits prospectively, and survives sync beyond the recent-series cap', async (t) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => { mock.timers.reset(); mem.clear(); serverSeries = {}; });
  assert.equal(prefs.fileSpreadShift(prefs.loadSeriesPrefs('series'), 'A'), false);
  assert.equal(mem.has('yomi_rs_series'), false, 'a fallback read does not initialize a single-mode or preloaded file');
  assert.equal(prefs.rememberFileSpreadShift('series', 'A'), false);
  prefs.rememberFileSpreadShift('series', 'A', true);
  assert.equal(prefs.rememberFileSpreadShift('series', 'B'), true, 'a newly opened file inherits the last choice');
  prefs.rememberFileSpreadShift('series', 'B', false);
  assert.equal(prefs.rememberFileSpreadShift('series', 'A'), true, 'reopening preserves the old file');
  assert.equal(prefs.loadSeriesPrefs('series').spreadShift, false, 'reopening does not reset the prospective default');
  assert.equal(prefs.rememberFileSpreadShift('series', 'C'), false);
  for (let n = 0; n < 305; n++) mem.set(`yomi_rs_other-${n}`, JSON.stringify({ zoom: 1.2 }));
  mock.timers.tick(1500);
  await settle(); await settle();
  assert.deepEqual(lastPut.readerSeries.series.fileSpreadShifts, { A: true, B: false, C: false });
  releasePut?.(); releasePut = null;
  await settle(); await settle(); await settle();
  serverSeries = { series: { spreadShift: true, fileSpreadShifts: { D: true } } };
  await prefs.syncPrefsFromServer();
  assert.deepEqual(prefs.loadSeriesPrefs('series').fileSpreadShifts, { A: true, B: false, C: false, D: true });
});

test('a pull while a push is pending keeps the local value', async (t) => {
  // The whole bug, end to end. Pick sepia (local write, PUT queued), and before the debounce fires let the
  // section remount and ask the server, which still says amoled. The local copy must survive and the server
  // must not even be asked -- its answer cannot be newer than what was just written.
  // Reintroduce by deleting `if (syncTimer || pushing) return loadPrefs();` in syncPrefsFromServer.
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => { mock.timers.reset(); mem.clear(); calls.length = 0; });
  mem.clear(); calls.length = 0;
  serverReader = { theme: 'amoled' };
  prefs.savePrefs({ ...prefs.DEFAULT_PREFS, theme: 'sepia' });
  assert.equal(prefs.loadPrefs().theme, 'sepia', 'the local write did not land');

  const p = await prefs.syncPrefsFromServer();
  assert.equal(p.theme, 'sepia', 'a pull while a push is pending keeps the local value');
  assert.equal(prefs.loadPrefs().theme, 'sepia', 'the pull overwrote localStorage with the server\'s old copy');
  assert.equal(gets(), 0, 'the server was asked while a newer local write was still unsent');

  // ⚠️ The window does not close when the timer fires; it closes when the PUT has SETTLED. A GET racing an
  // in-flight PUT can still answer the pre-PUT row. Fire the debounce, hold the PUT open, and pull again.
  mock.timers.tick(1500);
  await settle(); await settle();
  assert.equal(puts(), 1, 'the debounce did not push');
  const during = await prefs.syncPrefsFromServer();
  assert.equal(during.theme, 'sepia', 'a pull while the push is in flight adopted the server\'s old copy');
  assert.equal(gets(), 0, 'the server was asked while the push was still in flight');

  // And it is a window, not a lock: once the PUT has landed, the next pull adopts what the server says.
  // (The stub still answers amoled -- a second device could have written it meanwhile -- to prove adoption.)
  releasePut?.(); releasePut = null;
  await settle(); await settle(); await settle();
  const after = await prefs.syncPrefsFromServer();
  assert.equal(gets(), 1, 'the pull after the push landed did not ask the server');
  assert.equal(after.theme, 'amoled', 'the pull after the push landed did not adopt the server copy');
  assert.equal(prefs.loadPrefs().theme, 'amoled');
});

test('a pull with nothing pending adopts the server copy', async (t) => {
  // The ordinary sign-in case is unchanged: no local write in the last 1.5 s, so the server wins, and the
  // adopted copy is written through so the next `loadPrefs()` agrees with what was returned.
  t.after(() => { mem.clear(); calls.length = 0; });
  mem.clear(); calls.length = 0;
  serverReader = { theme: 'gray', gap: 12 };
  const p = await prefs.syncPrefsFromServer();
  assert.equal(gets(), 1, 'the server was not asked');
  assert.equal(p.theme, 'gray');
  assert.equal(p.gap, 12);
  assert.equal(prefs.loadPrefs().theme, 'gray', 'the adopted copy was not written to localStorage');
});
