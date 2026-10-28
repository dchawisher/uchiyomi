'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { t as tr } from '@/lib/i18n';
import { volumeDrafts, validVolumeDraft, type VolumeLookup, type VolumeDraft } from '@/lib/volumeLookup';
import { Modal, msgOf } from './ConfirmDialog';
import { useToast } from './Toast';

const field = 'w-full min-w-0 rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm';

export default function VolumeRangeLookup({ seriesId, title, target, onClose, onSaved }: {
  seriesId: string; title: string; target?: { bookId?: string; volume?: number }; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const [query, setQuery] = useState(title);
  const [data, setData] = useState<VolumeLookup | null>(null);
  const [rows, setRows] = useState<VolumeDraft[]>([]);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const accept = (result: VolumeLookup) => { setData(result); setRows(volumeDrafts(result, target)); };
  useEffect(() => {
    let live = true;
    api<VolumeLookup>(`/api/admin/series/${seriesId}/volume-lookup`).then(result => {
      if (live) accept(result);
    }).catch(e => { if (live) setError(msgOf(e, tr('Could not look up volumes'))); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [seriesId]); // The modal is remounted for each series/target.
  const lookup = async (params: URLSearchParams) => {
    setBusy(true); setError(''); setData(null); setRows([]);
    try { accept(await api<VolumeLookup>(`/api/admin/series/${seriesId}/volume-lookup?${params}`)); }
    catch (e) { setError(msgOf(e, tr('Could not look up volumes'))); }
    finally { setBusy(false); }
  };
  const patch = (volume: number, change: Partial<VolumeDraft>) => setRows(old => old.map(r => r.volume === volume ? { ...r, ...change } : r));
  const selected = rows.filter(r => r.selected && !r.saved);
  const valid = selected.length > 0 && selected.every(validVolumeDraft)
    && new Set(selected.map(r => r.bookId)).size === selected.length;
  const save = async () => {
    if (!valid) return;
    setSaving(true); setError('');
    try {
      await api(`/api/admin/series/${seriesId}/volume-ranges`, { method: 'POST', json: { mappings: selected.map(r => ({
        bookId: r.bookId, volume: r.volume, first: Number(r.start), last: Number(r.end),
      })) } });
      toast(tr('Volume ranges saved'), 'success'); onSaved(); onClose();
    } catch (e) { setError(msgOf(e, tr('Could not save'))); }
    finally { setSaving(false); }
  };
  return <Modal wide title={tr('Look up chapter ranges')} onClose={() => { if (!saving) onClose(); }} fieldFocus={false}>
    <p className="mb-3 text-sm text-fog-400">{tr('Check the ranges against your edition. Existing volume mappings stay unchanged.')}</p>
    <form className="mb-4 flex gap-2" onSubmit={e => {
      e.preventDefault();
      const id = query.trim().match(/^(?:https:\/\/mangadex\.org\/title\/)?([0-9a-f]{8}-[0-9a-f-]{27})(?:\/.*)?$/i)?.[1];
      if (query.trim()) void lookup(new URLSearchParams(id ? { mangaId: id } : { query: query.trim() }));
    }}>
      <input className={field} aria-label={tr('MangaDex title or link')} value={query} onChange={e => setQuery(e.target.value)} disabled={busy || saving} />
      <button className="btn-key" disabled={busy || saving || !query.trim()}>{tr('Search')}</button>
    </form>
    {busy && <p role="status">{tr('Looking up volumes…')}</p>}
    {error && <p role="alert" className="mb-3 text-sm text-red-300">{error}</p>}
    {data && !data.mangaId && <div className="space-y-2">
      <p className="text-sm text-fog-400">{data.candidates.length ? tr('Choose the matching manga') : tr('No matching manga found. Try another title or paste a MangaDex link.')}</p>
      {data.candidates.map(c => <button key={c.id} className="block w-full rounded-lg border border-white/10 p-3 text-start text-sm"
        onClick={() => void lookup(new URLSearchParams({ mangaId: c.id }))}>{c.title}{c.year ? ` (${c.year})` : ''}</button>)}
    </div>}
    {data?.mangaId && <>
      <a className="mb-3 inline-block text-sm text-accent" href={`https://mangadex.org/title/${data.mangaId}`} target="_blank" rel="noreferrer">{tr('View on MangaDex')}</a>
      {data.unassigned && <p className="mb-3 text-sm text-amber-200">{tr('Some chapters have no numbered volume assignment.')}</p>}
      {!rows.length && <p className="text-sm text-fog-400">{tr('No volume assignments found for this manga.')}</p>}
      <div className="space-y-3">
        {rows.map(row => <fieldset key={row.volume} data-volume={row.volume} disabled={saving} className="min-w-0 rounded-xl border border-white/10 p-3">
          <legend className="px-1 text-sm font-semibold">{tr('Vol. {n}', { n: row.volume })}</legend>
          {row.saved ? <p className="mb-2 text-sm text-fog-400">{tr('Saved mapping')} · {data.books.find(b => b.id === row.bookId)?.name}</p> : <>
            <label className="mb-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={row.selected}
              onChange={e => patch(row.volume, { selected: e.target.checked })} />{tr('Include this volume')}</label>
            <label className="mb-2 block text-xs text-fog-400">{tr('Volume file')}
              <select className={`${field} mt-1`} value={row.bookId} onChange={e => patch(row.volume, { bookId: e.target.value })}>
                <option value="">{tr('Choose a file')}</option>
                {data.books.filter(b => b.volumeNumber == null).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
          </>}
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-fog-400">{tr('First chapter')}<input className={`${field} mt-1`} inputMode="decimal" readOnly={row.saved}
              value={row.start} onChange={e => patch(row.volume, { start: e.target.value, reviewed: false })} /></label>
            <label className="text-xs text-fog-400">{tr('Last chapter')}<input className={`${field} mt-1`} inputMode="decimal" readOnly={row.saved}
              value={row.end} onChange={e => patch(row.volume, { end: e.target.value, reviewed: false })} /></label>
          </div>
          {!row.saved && row.issues.length > 0 && <div className="mt-2 space-y-1 text-xs text-amber-200">
            {row.issues.includes('gaps') && <p>{tr('Chapters are missing inside this range.')}</p>}
            {row.issues.includes('conflict') && <p>{tr('Some chapters are assigned to more than one volume.')}</p>}
            {row.issues.includes('noWholeChapters') && <p>{tr('Only decimal-numbered chapters are listed. Enter the range from your volume.')}</p>}
            {row.issues.includes('tooWide') && <p>{tr('This range is too large. Check the chapter numbers.')}</p>}
            <label className="flex items-center gap-2"><input type="checkbox" checked={row.reviewed} onChange={e => patch(row.volume, { reviewed: e.target.checked })} />{tr('I checked this range against my volume')}</label>
          </div>}
          <details className="mt-2 text-xs text-fog-400"><summary className="cursor-pointer">{tr('Listed chapters')}</summary>
            <p className="mt-1 break-words">{row.chapters.join(', ')}</p>
          </details>
        </fieldset>)}
      </div>
      {selected.length > 0 && !valid && <p className="mt-3 text-sm text-amber-200">{tr('Choose a different file for each selected volume, enter valid ranges, and review any warnings.')}</p>}
      <div className="sticky bottom-0 mt-4 flex justify-end gap-2 bg-ink-950 py-3">
        <button className="btn-ghost px-3 py-2" onClick={onClose} disabled={saving}>{tr('Cancel')}</button>
        <button className="btn-accent px-4 py-2 disabled:opacity-50" onClick={save} disabled={!valid || saving}>
          {saving ? tr('Saving…') : selected.length === 1 ? tr('Apply 1 volume range') : tr('Apply {n} volume ranges', { n: selected.length })}
        </button>
      </div>
    </>}
  </Modal>;
}
