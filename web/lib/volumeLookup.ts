export interface LookupBook { id: string; name: string; number: number; volumeNumber: number | null; numberEnd: number | null }
export interface VolumeSuggestion {
  volume: number; first: number | null; last: number | null; chapters: number[];
  issues: Array<'gaps' | 'conflict' | 'noWholeChapters' | 'tooWide'>;
}
export interface VolumeLookup {
  books: LookupBook[];
  candidates: Array<{ id: string; title: string; year: number | null }>;
  mangaId: string | null; volumes: VolumeSuggestion[]; unassigned: boolean;
}
export interface VolumeDraft extends VolumeSuggestion {
  bookId: string; start: string; end: string; selected: boolean; reviewed: boolean; saved: boolean;
}

/** Only an explicit volume marker is safe to match. Never interpret an ordinary chapter number as a volume. */
export function volumeFromName(name: string): number | null {
  if (/\b(?:chapter|ch|c)\.?\s*\d/i.test(name)) return null;
  const matches = [...name.matchAll(/\b(?:volume|vol|tome|[tv])\.?\s*(\d+(?:\.\d+)?)(?!\d|\.\d|\s*[-–&+]\s*\d)/gi)];
  return matches.length === 1 ? Number(matches[0][1]) : null;
}

export function volumeDrafts(data: VolumeLookup, target?: { bookId?: string; volume?: number }): VolumeDraft[] {
  return data.volumes.map(v => {
    const saved = data.books.filter(b => b.volumeNumber === v.volume);
    const matches = target?.bookId
      ? data.books.filter(b => b.id === target.bookId && b.volumeNumber == null
        && (target.volume ?? volumeFromName(b.name)) === v.volume)
      : data.books.filter(b => b.volumeNumber == null && volumeFromName(b.name) === v.volume);
    const book = saved[0] ?? (matches.length === 1 ? matches[0] : undefined);
    return { ...v, bookId: book?.id ?? '', start: String(saved.length ? book!.number : v.first ?? ''),
      end: String(saved.length ? book!.numberEnd ?? '' : v.last ?? ''),
      saved: saved.length > 0, selected: !saved.length && !!book && !v.issues.length, reviewed: false };
  });
}

export function validVolumeDraft(row: VolumeDraft): boolean {
  const start = Number(row.start), end = Number(row.end);
  return !!row.bookId && !!row.start.trim() && !!row.end.trim() && Number.isFinite(start) && Number.isFinite(end)
    && start >= 0 && end >= start && end <= 100000 && end - start <= 1000 && (!row.issues.length || row.reviewed);
}
