import test from 'node:test';
import assert from 'node:assert/strict';
import { chapterLabel, mixedBookCountText } from '../lib/format';

test('a volume label stays separate from its chapter range, regardless of its filename', () => {
  assert.equal(chapterLabel({ volumeNumber: 2, number: 9, numberEnd: 16, name: 'Chapter 2' }), 'Vol. 2 · Ch. 9–16');
  assert.equal(chapterLabel({ volumeNumber: 3, number: 17, numberEnd: 17, name: 'Vol. 3' }), 'Vol. 3 · Ch. 17');
  assert.equal(chapterLabel({ number: 9, numberEnd: 16, name: 'Collected chapters' }), 'Ch. 9–16');
});

test('mixed collections count volume files separately from chapter files', () => {
  assert.equal(mixedBookCountText(3, 2), '2 volumes · 1 chapter');
  assert.equal(mixedBookCountText(2, 2), '2 volumes');
  assert.equal(mixedBookCountText(2, 0), '2 chapters');
});
