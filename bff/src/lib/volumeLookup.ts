/** MangaDex aggregates describe uploaded chapters, not a guaranteed complete table of contents. */
export interface VolumeSuggestion {
  volume: number;
  first: number | null;
  last: number | null;
  chapters: number[];
  issues: Array<'gaps' | 'conflict' | 'noWholeChapters' | 'tooWide'>;
}

const numeric = (value: string): number | null => /^\d+(?:\.\d+)?$/.test(value)
  && Number(value) <= 100000 ? Number(value) : null;

export function volumeSuggestions(aggregate: unknown): { volumes: VolumeSuggestion[]; unassigned: boolean } {
  const buckets = new Map<number, Set<number>>();
  let unassigned = false;
  const source = (aggregate as { volumes?: Record<string, { chapters?: Record<string, unknown> }> })?.volumes;
  for (const [label, entry] of Object.entries(source ?? {})) {
    const volume = numeric(label);
    if (volume == null || volume <= 0) { unassigned = true; continue; }
    const chapters = buckets.get(volume) ?? new Set<number>();
    for (const chapter of Object.keys(entry?.chapters ?? {})) {
      const n = numeric(chapter);
      if (n == null) unassigned = true;
      else chapters.add(n);
    }
    buckets.set(volume, chapters);
  }
  const owners = new Map<number, Set<number>>();
  for (const [volume, chapters] of buckets) for (const chapter of chapters) {
    const set = owners.get(chapter) ?? new Set<number>();
    set.add(volume); owners.set(chapter, set);
  }
  const volumes = [...buckets].sort(([a], [b]) => a - b).map(([volume, numbers]): VolumeSuggestion => {
    const chapters = [...numbers].sort((a, b) => a - b);
    const whole = chapters.filter(Number.isInteger);
    const first = whole[0] ?? null;
    const last = whole.at(-1) ?? null;
    const issues: VolumeSuggestion['issues'] = [];
    if (first == null || last == null) issues.push('noWholeChapters');
    else {
      if (last - first > 1000) issues.push('tooWide');
      if (whole.length !== last - first + 1) issues.push('gaps');
    }
    if (chapters.some(n => owners.get(n)!.size > 1)) issues.push('conflict');
    return { volume, first, last, chapters, issues };
  });
  return { volumes, unassigned };
}
