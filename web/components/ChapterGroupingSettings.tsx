'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { t as tr } from '@/lib/i18n';
import type { Series } from '@/lib/types';
import { msgOf } from './ConfirmDialog';

export default function ChapterGroupingSettings({series,busy,onBusy,onSaved,onChange}:{
  series:Series; busy:boolean; onBusy:(v:boolean)=>void; onSaved:()=>void;
  onChange:(mode:NonNullable<Series['partDetection']>)=>Promise<boolean>;
}) {
  const [report,setReport]=useState<{checked:number;failed:number;remaining:number}|null>(null);
  const [error,setError]=useState('');
  const [mode,setMode]=useState(series.partDetection ?? (series.fullChapters ? 'careful' : 'off'));
  const [checking,setChecking]=useState(false);
  const options = [
    {value:'careful',title:tr('Careful (default)'),body:tr('A single decimal entry is treated as an extra. Two or more can form parts of a chapter.')},
    {value:'balanced',title:tr('Balanced'),body:tr('A single decimal entry can be a part, except a lone .5, which stays an extra.')},
    {value:'aggressive',title:tr('Aggressive'),body:tr('Any decimal entry can be a part, including a lone .5.')},
    {value:'off',title:tr('Off'),body:tr('Only your manual associations are used.')},
  ] as const;
  return <div className="max-w-2xl space-y-5">
    <fieldset disabled={busy} className="space-y-2">
      <legend className="mb-3 text-base font-medium">{tr('Automatic part detection')}</legend>
      {options.map(o=><label key={o.value} className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${mode===o.value?'border-accent bg-accent-soft':'border-ink-700'}`}>
        <input type="radio" name="part-detection" checked={mode===o.value} onChange={async()=>{const previous=mode;setMode(o.value);if(!await onChange(o.value))setMode(previous);}} className="mt-1 shrink-0" />
        <span><span className="block font-medium">{o.title}</span><span className="mt-1 block text-sm leading-relaxed text-fog-300">{o.body}</span></span>
      </label>)}
    </fieldset>
    <div className="space-y-3 text-sm leading-relaxed text-fog-300">
      <p>{tr('At every level, a complete chapter must have at least the combined page count of its parts, minus four pages per part for repeated covers or adverts. If a page count is unknown, the parts stay in the reading list.')}</p>
      <p>{tr('If there are multiple parts but no .1, the entry without a suffix is treated as the first part. For example, 20, 20.2 and 20.3 are read as three parts, not a complete chapter and two duplicates.')}</p>
      <p>{tr('Your manual associations always take priority. Changing this setting does not erase them.')}</p>
    </div>
    <div className="border-t border-ink-700 pt-4">
      <p className="mb-3 text-sm leading-relaxed text-fog-300">{tr('Some sources include page counts in their listings. For others, we can count their page URLs without downloading the images.')}</p>
      <button className="btn-key" disabled={busy} onClick={async()=>{
        onBusy(true);setChecking(true);setError('');
        try { setReport(await api(`/api/admin/series/${series.id}/chapter-page-counts`,{method:'POST',json:{}}));onSaved(); }
        catch(e){setError(msgOf(e,tr('Could not check page counts')));}
        finally{onBusy(false);setChecking(false);}
      }}>{checking?tr('Checking…'):tr('Check missing page counts')}</button>
      {report && <p role="status" className="mt-3 text-sm">{tr('Page counts found: {found}. Unavailable: {failed}. Still to check: {remaining}.',{found:report.checked,failed:report.failed,remaining:report.remaining})}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
    </div>
  </div>;
}
