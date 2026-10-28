'use client';
import { useState } from 'react';
import type { Book } from '@/lib/types';
import { t as tr } from '@/lib/i18n';

export type GroupingChoice = { role: 'auto' | 'extra' | 'part' | 'first' | 'complete'; parentNumber?: number };
export default function ChapterGrouping({ book, busy, error, onSave, onCancel }: {
  book: Book; busy: boolean; error: string;
  onSave: (choice: GroupingChoice) => Promise<void>; onCancel: () => void;
}) {
  const initial:GroupingChoice['role']=book.grouping?.manual
    ? book.grouping.role==='chapter'?'complete':book.grouping.role : book.keepSeparate?'extra':'auto';
  const [role,setRole]=useState(initial);
  const [parent,setParent]=useState(String(book.grouping?.parentNumber ?? Math.floor(book.number)));
  const choices:Array<{value:GroupingChoice['role'];title:string;body:string}>= [
    {value:'auto',title:tr('Use this series’ detection settings'),body:tr('Let the page counts and numbering decide. This removes your manual choice for this entry.')},
    {value:'extra',title:tr('Keep as a separate chapter or extra'),body:tr('Do not treat this entry as part of another chapter.')},
    ...(!Number.isInteger(book.number)?[{value:'part' as const,title:tr('Assign to a chapter'),body:tr('Keep this association even if the numbering, page counts or series settings change.')}]:[]),
    ...(Number.isInteger(book.number)?[
      {value:'first' as const,title:tr('This is the first part'),body:tr('The source left off .1. Keep this entry and the later parts in reading order.')},
      {value:'complete' as const,title:tr('This is the complete chapter'),body:tr('Use this entry instead of its associated parts, even if the page counts do not match.')},
    ]:[]),
  ];
  const valid=role!=='part'||(parent.trim()!==''&&Number.isInteger(Number(parent))&&Number(parent)>=0&&Number(parent)<=1e6&&Number(parent)!==book.number);
  return <form onSubmit={e=>{e.preventDefault();if(!busy&&valid)void onSave({role,...(role==='part'?{parentNumber:Number(parent)}:{})});}}>
    <fieldset disabled={busy} className="space-y-2">
      <legend className="mb-3 text-sm leading-relaxed text-fog-200">{tr('Manual choices stay in place until you change them.')}</legend>
      {choices.map(c=><label key={c.value} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${role===c.value?'border-accent bg-accent-soft':'border-ink-700'}`}>
        <input type="radio" name="chapter-grouping" autoFocus={initial===c.value} checked={role===c.value} onChange={()=>setRole(c.value)} className="mt-1 shrink-0" />
        <span><span className="block text-sm font-medium">{c.title}</span><span className="mt-1 block text-sm leading-relaxed text-fog-300">{c.body}</span></span>
      </label>)}
      {role==='part'&&<label className="block text-sm">{tr('Chapter number')}
        <input inputMode="numeric" className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2" value={parent} onChange={e=>setParent(e.target.value)} />
      </label>}
    </fieldset>
    {error&&<p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
    <div className="mt-5 flex justify-end gap-2">
      <button type="button" className="btn-key" disabled={busy} onClick={onCancel}>{tr('Cancel')}</button>
      <button type="submit" className="btn-key btn-key-primary" disabled={busy||!valid}>{tr('Save')}</button>
    </div>
  </form>;
}
