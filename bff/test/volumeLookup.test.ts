import test from 'node:test';
import assert from 'node:assert/strict';
import { volumeSuggestions } from '../src/lib/volumeLookup';

const aggregate = (entries: Record<string, string[]>) => ({ volumes: Object.fromEntries(Object.entries(entries)
  .map(([v, ns]) => [v, { chapters: Object.fromEntries(ns.map(n => [n, {}])) }])) });

test('maps main chapters per volume without rounding decimal extras into whole chapters', () => {
  const result = volumeSuggestions(aggregate({ '1': ['1', '2', '3', '3.5'], '2': ['4', '4.1', '4.2', '5'] }));
  assert.deepEqual(result.volumes.map(v => [v.volume, v.first, v.last, v.issues]), [[1, 1, 3, []], [2, 4, 5, []]]);
  assert.deepEqual(result.volumes[0].chapters, [1, 2, 3, 3.5]);
});
test('flags missing main chapters, conflicting volumes and decimal-only releases', () => {
  const result = volumeSuggestions(aggregate({ '1': ['1', '3'], '2': ['3', '4'], '3': ['5.1', '5.2'] }));
  assert.deepEqual(result.volumes[0].issues, ['gaps', 'conflict']);
  assert.deepEqual(result.volumes[1].issues, ['conflict']);
  assert.equal(result.volumes[2].first, null);
  assert.deepEqual(result.volumes[2].issues, ['noWholeChapters']);
});
test('unassigned/unsupported numbers stay unknown and oversized ranges are flagged', () => {
  const result = volumeSuggestions(aggregate({ none: ['1'], '1': ['0', '100000', 'extra'], '2a': ['2'] }));
  assert.equal(result.unassigned, true);
  assert.deepEqual(result.volumes[0].issues, ['tooWide', 'gaps']);
  assert.equal(result.volumes.length, 1);
  assert.deepEqual(volumeSuggestions({}), { volumes: [], unassigned: false });
});
