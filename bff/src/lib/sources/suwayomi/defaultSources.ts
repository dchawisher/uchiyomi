/** One language variant by default; additional languages require an explicit standing choice. */
export function defaultExtensionSources(
  sources: ReadonlyArray<{ id: string; lang: string | null }>,
  hidden: ReadonlySet<string>,
  preferred: readonly string[] = [],
): Set<string> {
  const eligible = sources.filter((s) => !s.lang || !hidden.has(s.lang));
  const main = eligible.find((s) => /^en(?:[-_]|$)/i.test(s.lang ?? ''))
    ?? eligible.find((s) => !s.lang || s.lang === 'all')
    ?? eligible[0];
  const selected = new Set(main ? [main.id] : []);
  for (const s of eligible) if (s.lang && preferred.includes(s.lang)) selected.add(s.id);
  return selected;
}
