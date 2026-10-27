import test from 'node:test';
import assert from 'node:assert/strict';
import { actionForKey, keyMapFor, bindKey } from '../lib/readerKeys';
import { nextRating, ratingRequest } from '../lib/ratings';

test('p shifts double-page pairing once per press and can be rebound', () => {
  assert.equal(actionForKey({ key: 'p' }, keyMapFor('paged')), 'spreadShift');
  assert.equal(actionForKey({ key: 'p', repeat: true }, keyMapFor('paged')), null);
  assert.equal(actionForKey({ key: 'p', ctrlKey: true }, keyMapFor('paged')), null);
  assert.equal(actionForKey({ key: 'p' }, keyMapFor('vertical')), null);
  const { overrides } = bindKey({}, 'paged', 'spreadShift', 'x');
  assert.equal(actionForKey({ key: 'x' }, keyMapFor('paged', overrides)), 'spreadShift');
});

test('half-star values survive the request and tapping the same value clears it', () => {
  for (let n = 0.5; n <= 5; n += 0.5) {
    assert.equal(nextRating(null, n), n);
    assert.equal(ratingRequest('s1', n).init.json?.stars, n);
    assert.equal(nextRating(n, n), null);
  }
});
