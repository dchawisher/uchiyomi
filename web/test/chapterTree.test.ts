import test from 'node:test';
import assert from 'node:assert/strict';
import { chapterTree, filterChapterTree, type ChapterNode } from '../lib/chapterTree';
import type { Book } from '../lib/types';

const book = (number: number, extra: Partial<Book> = {}): Book => ({
  id: `b${number}`, name: `Chapter ${number}`, number, seriesId: 's', seriesTitle: 'S', metadata: {}, media: { pagesCount: 20 }, ...extra,
});
const make = (books: Book[], listed: number[] = []) => chapterTree(books, new Set([...books.map(b => b.number), ...listed]));
const files = (nodes: ChapterNode[]): string[] => nodes.flatMap(n => [...(n.book ? [n.book.id] : []), ...files(n.children)]);

test('volume → chapter → parts preserves every file and keeps an omnibus intact', () => {
  const books = [book(16.2), book(17.5), book(15, { id: 'v', volumeNumber: 11, volumeNumberEnd: 12, numberEnd: 17.5 }), book(16), book(16.1)];
  const tree = make(books);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].book?.volumeNumberEnd, 12);
  assert.deepEqual(tree[0].children.map(n => [n.kind, n.number]), [['chapter', 16], ['bonus', 17.5]]);
  assert.deepEqual(tree[0].children[0].children.map(n => n.number), [16.1, 16.2]);
  assert.deepEqual(files(tree).sort(), books.map(b => b.id).sort());
});

test('parts without a whole file get a heading, not a pretend file or read/download action', () => {
  const tree = make([book(20.1), book(20.2), book(20.5)]);
  assert.equal(tree[0].number, 20);
  assert.equal(tree[0].book, undefined);
  assert.deepEqual(tree[0].children.map(n => n.number), [20.1, 20.2]);
  assert.equal(tree[1].kind, 'bonus');
});

test('a remotely listed .4 makes .5 a part; an explicit exception stays separate', () => {
  assert.equal(make([book(20.5)], [20.4])[0].children[0].kind, 'part');
  assert.equal(make([book(20.5, { keepSeparate: true })], [20.4])[0].kind, 'bonus');
});

test('volume boundaries take precedence over the inferred integer parent', () => {
  const tree = make([book(20, { id: 'v', volumeNumber: 1, numberEnd: 20.1 }), book(20), book(20.1), book(20.2)]);
  assert.deepEqual(files([tree[0]]), ['v', 'b20', 'b20.1']);
  assert.equal(tree[1].book, undefined);
  assert.deepEqual(files([tree[1]]), ['b20.2']);
});

test('search keeps ancestors and drops unrelated siblings, without mutating the tree', () => {
  const tree = make([book(1, { id: 'v', volumeNumber: 1, numberEnd: 5 }), book(2), book(2.1), book(2.2), book(3)]);
  const filtered = filterChapterTree(tree, n => n.book?.id === 'b2.2');
  assert.deepEqual(files(filtered), ['v', 'b2', 'b2.2']);
  assert.equal(files(tree).length, 5);
});

test('overlapping volumes use the server-selected parent; duplicate copies never disappear', () => {
  const tree = make([book(1, { id: 'v1', volumeNumber: 1, numberEnd: 5 }), book(1, { id: 'v2', volumeNumber: 2, numberEnd: 5 }),
    book(2, { alternateOf: 'v2' }), book(2.1, { alternateOf: 'v2' }), book(2, { id: 'copy', alternateOf: 'v2' })]);
  assert.equal(tree[0].children.length, 0);
  assert.deepEqual(files([tree[1]]).sort(), ['b2', 'b2.1', 'copy', 'v2']);
});

test('a source’s unsuffixed first part is a child of a heading, never the container file', () => {
  const grouping = {role:'first' as const,parentNumber:20,manual:false,requiredPages:null,parentIsFirst:false};
  const tree=make([book(20,{grouping}),book(20.2,{grouping:{...grouping,role:'part'}}),book(20.3,{grouping:{...grouping,role:'part'}})]);
  assert.equal(tree.length,1);
  assert.equal(tree[0].book,undefined);
  assert.deepEqual(tree[0].children.map(n=>n.book?.id),['b20','b20.2','b20.3']);
});

test('server decisions and manual parent associations outrank frontend suffix guesses', () => {
  const base={manual:true,requiredPages:null,parentIsFirst:false};
  const tree=make([book(20),book(23.1,{grouping:{...base,role:'part',parentNumber:20}}),
    book(20.5,{grouping:{...base,role:'extra',parentNumber:null}})]);
  assert.equal(tree[0].children[0].number,23.1);
  assert.equal(tree[1].kind,'bonus');
});
