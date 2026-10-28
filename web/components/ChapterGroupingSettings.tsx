'use client';
import { useState } from 'react';
import { t as tr } from '@/lib/i18n';
import type { Series } from '@/lib/types';

export default function ChapterGroupingSettings({series,busy,onChange}:{
  series:Series; busy:boolean;
  onChange:(mode:NonNullable<Series['partDetection']>)=>Promise<boolean>;
}) {
  const [mode,setMode]=useState(series.partDetection ?? (series.fullChapters ? 'careful' : 'off'));
  const options = [
    {value:'careful',title:tr('Careful (default)'),body:tr('A single decimal entry is treated as an extra. Two or more can form parts of a chapter.')},
    {value:'balanced',title:tr('Balanced'),body:tr('A single decimal entry can be a part, except a lone .5, which stays an extra.')},
    {value:'aggressive',title:tr('Aggressive'),body:tr('Any decimal entry can be a part, including a lone .5.')},
    {value:'off',title:tr('Off'),body:tr('Only your manual associations are used.')},
  ] as const;
  return <div className="max-w-3xl space-y-3">
    <fieldset disabled={busy} className="divide-y divide-ink-800">
      <legend className="mb-2 text-sm font-medium">{tr('Automatic part detection')}</legend>
      {options.map(o=><label key={o.value} className={`flex cursor-pointer items-start gap-3 rounded px-2 py-2 ${mode===o.value?'bg-accent-soft':'border-ink-700'}`}>
        <input type="radio" name="part-detection" checked={mode===o.value} onChange={async()=>{const previous=mode;setMode(o.value);if(!await onChange(o.value))setMode(previous);}} className="mt-1 shrink-0" />
        <span className="min-w-0 sm:grid sm:grid-cols-[10rem_1fr] sm:gap-3"><span className="block text-sm font-medium">{o.title}</span><span className="block text-sm leading-snug text-fog-300">{o.body}</span></span>
      </label>)}
    </fieldset>
    <div className="space-y-2 text-sm leading-snug text-fog-300">
      <p>{tr('At every level, a complete chapter must have at least the combined page count of its parts, minus four pages per part for repeated covers or adverts. If a page count is unknown, the parts stay in the reading list.')}</p>
      <p>{tr('If there are multiple parts but no .1, the entry without a suffix is treated as the first part. For example, 20, 20.2 and 20.3 are read as three parts, not a complete chapter and two duplicates.')}</p>
      <p>{tr('Your manual associations always take priority. Changing this setting does not erase them.')}</p>
    </div>
    <div className="border-t border-ink-700 pt-3">
      <p className="mb-2 text-sm leading-snug text-fog-300">{tr('Some sources include page counts in their listings. For others, we can count their page URLs without downloading the images.')}</p>
    </div>
  </div>;
}
