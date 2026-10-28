import test from 'node:test';
import assert from 'node:assert/strict';
import { volumeFromName, volumeDrafts, validVolumeDraft, type VolumeLookup } from '../lib/volumeLookup';

test('matches explicit single volume files, never chapter numbers or omnibus ranges', () => {
  for (const name of ['Volume 2', 'Book v02', 'Tome 2', 'Vol. 2', 'Volume 2.cbz']) assert.equal(volumeFromName(name), 2);
  for (const name of ['Chapter 2', 'Book 2', 'Vol 2 Ch 8', 'Vol 12-14', 'Vol 1.5-3', 'Vol 1 & 2', 'Vol 1 Vol 2']) assert.equal(volumeFromName(name), null, name);
});
const data: VolumeLookup = { mangaId: 'test', candidates: [], unassigned: false, books: [
  { id: 'a', name: 'Vol 1', number: 1, numberEnd: null, volumeNumber: null },
  { id: 'b', name: 'Vol 2', number: 10, numberEnd: 20, volumeNumber: 2 },
], volumes: [
  { volume: 1, first: 1, last: 8, chapters: [1, 8], issues: [] },
  { volume: 2, first: 9, last: 16, chapters: [9, 16], issues: [] },
] };
test('keeps saved mappings even when the remote boundaries differ', () => {
  const [fresh, saved] = volumeDrafts(data);
  assert.equal(fresh.selected, true); assert.equal(fresh.bookId, 'a');
  assert.equal(saved.saved, true); assert.equal(saved.selected, false);
  assert.equal(saved.start, '10'); assert.equal(saved.end, '20');
});
test('ambiguous files are not automatically chosen; warnings require review', () => {
  assert.equal(volumeDrafts({ ...data, books: [...data.books, { ...data.books[0], id: 'c' }] })[0].bookId, '');
  const row = { ...volumeDrafts(data)[0], issues: ['gaps'] as const };
  assert.equal(validVolumeDraft({ ...row, issues: [...row.issues] }), false);
  assert.equal(validVolumeDraft({ ...row, issues: [...row.issues], reviewed: true }), true);
  assert.equal(validVolumeDraft({ ...volumeDrafts(data)[0], start: '' }), false);
  assert.equal(validVolumeDraft({ ...volumeDrafts(data)[0], end: '1002' }), false);
});
