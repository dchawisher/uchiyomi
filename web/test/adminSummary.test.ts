import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSummary } from '../lib/said';

test('admin summaries omit investigated gaps and failures on unused sources', () => {
  assert.equal(checkSummary({ summary: '', summarySaid: [
    { code: 'gaps.live', params: { n: 2 } },
    { code: 'gaps.quiet', params: { n: 9 }, join: 'dot' },
  ] }), '2 series have missing chapters');
  assert.equal(checkSummary({ summary: '', summarySaid: [
    { code: 'sources.affected', params: { n: 1 } },
    { code: 'sources.failingUnused', params: { n: 4 }, join: 'dot' },
  ] }), '1 source your series use needs a look');
});

test('summary suppression handles an unused-only check and keeps older server summaries', () => {
  assert.equal(checkSummary({ summary: 'unused failures', summarySaid: [
    { code: 'sources.failingUnused', params: { n: 4 } },
  ] }), '');
  assert.equal(checkSummary({ summary: 'Legacy summary' }), 'Legacy summary');
});
