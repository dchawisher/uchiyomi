import type { Book } from './types';

export type ChapterKind = 'volume' | 'chapter' | 'bonus' | 'part';
export type ChapterTreeEntry = Pick<Book, 'id' | 'number' | 'numberEnd' | 'volumeNumber' | 'volumeNumberEnd' | 'alternateOf' | 'keepSeparate' | 'grouping'>;
export interface ChapterNode<T extends ChapterTreeEntry = Book> {
  id: string;
  number: number;
  kind: ChapterKind;
  book?: T;
  children: ChapterNode<T>[];
}

export function chapterKind(book: ChapterTreeEntry, known: ReadonlySet<number>): ChapterKind {
  if (book.volumeNumber != null) return 'volume';
  if (book.grouping) return book.grouping.role === 'extra' ? 'bonus'
    : book.grouping.role === 'first' ? 'part' : book.grouping.role;
  if (Number.isInteger(book.number)) return 'chapter';
  return book.keepSeparate || (Math.round((book.number % 1) * 1000) === 500 && !known.has(Math.floor(book.number) + 0.4))
    ? 'bonus' : 'part';
}

/** Containment and numbering, not reading-list visibility. Keep every file exactly once. */
export function chapterTree<T extends ChapterTreeEntry>(books: readonly T[], known: ReadonlySet<number>): ChapterNode<T>[] {
  const roots: ChapterNode<T>[] = [];
  const nodes = new Map(books.map(book => [book.id, {
    id: book.id, number: book.number, kind: chapterKind(book, known), book, children: [],
  } as ChapterNode<T>]));
  const volumes = [...nodes.values()].filter(n => n.kind === 'volume').sort(compare);
  const container = new Map<string, ChapterNode<T> | undefined>();
  for (const node of nodes.values()) {
    if (node.kind === 'volume') { roots.push(node); continue; }
    const parent = node.book?.alternateOf ? nodes.get(node.book.alternateOf) : undefined;
    // Prefer the server's chosen volume where ranges overlap. The range still describes containment
    // when a damaged/pruned volume cannot replace the chapter in the reading list.
    container.set(node.id, parent?.kind === 'volume' ? parent : volumes.find(v =>
      v.book!.numberEnd != null && node.number >= v.number && node.number <= v.book!.numberEnd));
  }
  const chapters = new Map<string, ChapterNode<T>>();
  const key = (volume: ChapterNode<T> | undefined, number: number) => `${volume?.id ?? 'root'}:${number}`;
  for (const node of nodes.values()) {
    if (node.kind === 'volume' || node.kind === 'part') continue;
    const volume = container.get(node.id);
    (volume?.children ?? roots).push(node);
    if (node.kind === 'chapter' && !chapters.has(key(volume, node.number))) chapters.set(key(volume, node.number), node);
  }
  for (const node of nodes.values()) {
    if (node.kind !== 'part') continue;
    const volume = container.get(node.id);
    const whole = node.book?.grouping?.parentNumber ?? Math.floor(node.number);
    const group = key(volume, whole);
    const alternate = node.book?.alternateOf ? nodes.get(node.book.alternateOf) : undefined;
    let parent = alternate?.kind === 'chapter' && alternate.number === whole && container.get(alternate.id) === volume
      ? alternate : chapters.get(group);
    if (!parent) {
      // A heading for existing parts, never a pretend downloadable/readable file.
      parent = { id: `chapter:${group}`, number: whole, kind: 'chapter', children: [] };
      chapters.set(group, parent);
      (volume?.children ?? roots).push(parent);
    }
    parent.children.push(node);
  }
  const sort = (list: ChapterNode<T>[]) => { list.sort(compare); list.forEach(n => sort(n.children)); };
  sort(roots);
  return roots;
}

function compare(a: ChapterNode<ChapterTreeEntry>, b: ChapterNode<ChapterTreeEntry>): number {
  return a.number - b.number || Number(b.kind === 'volume') - Number(a.kind === 'volume') || a.id.localeCompare(b.id);
}

/** Retain ancestors of matches so searching/filtering never detaches a part from its chapter/volume. */
export function filterChapterTree<T extends ChapterTreeEntry>(nodes: readonly ChapterNode<T>[], matches: (node: ChapterNode<T>) => boolean): ChapterNode<T>[] {
  return nodes.flatMap(node => {
    const children = filterChapterTree(node.children, matches);
    return matches(node) || children.length ? [{ ...node, children }] : [];
  });
}
