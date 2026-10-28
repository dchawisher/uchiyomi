'use client';
import { Fragment, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { t as tr } from '@/lib/i18n';
import { volumeDrafts, validVolumeDraft, type VolumeLookup, type VolumeDraft } from '@/lib/volumeLookup';
import { Modal, msgOf } from './ConfirmDialog';
import { useToast } from './Toast';

const field = 'w-full min-w-0 rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm';

export default function VolumeRangeLookup({ seriesId, title, target, onClose, onSaved, embedded = false }: {
  seriesId: string; title: string; target?: { bookId?: string; volume?: number }; onClose: () => void; onSaved: () => void; embedded?: boolean;
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
  const body = <>
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
      <div className="overflow-x-auto" data-lenis-prevent-horizontal>
        <table className="w-full min-w-[560px] text-sm" data-volume-lookup>
          <thead className="text-xs text-fog-400"><tr>{[tr('Include'), tr('Volume'), tr('Volume file'), tr('First chapter'), tr('Last chapter')].map(h => <th key={h} className="border-b border-ink-700 px-2 py-2 text-start font-medium">{h}</th>)}</tr></thead>
          <tbody>{rows.map(row => <Fragment key={row.volume}>
            <tr data-volume={row.volume} className="border-b border-ink-800 [&>td]:px-2 [&>td]:py-1.5">
              <td><input type="checkbox" aria-label={tr('Include this volume')} checked={row.saved || row.selected} disabled={saving || row.saved}
                onChange={e => patch(row.volume, { selected: e.target.checked })} /></td>
              <td className="whitespace-nowrap">{tr('Vol. {n}', { n: row.volume })}</td>
              <td>{row.saved ? <span className="text-fog-400">{data.books.find(b => b.id === row.bookId)?.name}</span> :
                <select className={field} aria-label={tr('Volume file')} disabled={saving} value={row.bookId} onChange={e => patch(row.volume, { bookId: e.target.value })}>
                  <option value="">{tr('Choose a file')}</option>{data.books.filter(b => b.volumeNumber == null).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>}</td>
              <td className="w-28"><input aria-label={tr('First chapter')} className={field} inputMode="decimal" readOnly={row.saved} disabled={saving}
                value={row.start} onChange={e => patch(row.volume, { start: e.target.value, reviewed: false })} /></td>
              <td className="w-28"><input aria-label={tr('Last chapter')} className={field} inputMode="decimal" readOnly={row.saved} disabled={saving}
                value={row.end} onChange={e => patch(row.volume, { end: e.target.value, reviewed: false })} /></td>
            </tr>
            <tr><td colSpan={5} className="px-2 pb-2">
              {!row.saved && row.issues.length > 0 && <div className="space-y-1 text-xs text-amber-200">
                {row.issues.includes('gaps') && <p>{tr('Chapters are missing inside this range.')}</p>}
                {row.issues.includes('conflict') && <p>{tr('Some chapters are assigned to more than one volume.')}</p>}
                {row.issues.includes('noWholeChapters') && <p>{tr('Only decimal-numbered chapters are listed. Enter the range from your volume.')}</p>}
                {row.issues.includes('tooWide') && <p>{tr('This range is too large. Check the chapter numbers.')}</p>}
                <label className="flex items-center gap-2"><input type="checkbox" checked={row.reviewed} disabled={saving} onChange={e => patch(row.volume, { reviewed: e.target.checked })} />{tr('I checked this range against my volume')}</label>
              </div>}
              <details className="text-xs text-fog-400"><summary className="cursor-pointer">{tr('Listed chapters')}</summary><p className="mt-1 break-words">{row.chapters.join(', ')}</p></details>
            </td></tr>
          </Fragment>)}</tbody>
        </table>
      </div>
      {selected.length > 0 && !valid && <p className="mt-3 text-sm text-amber-200">{tr('Choose a different file for each selected volume, enter valid ranges, and review any warnings.')}</p>}
      <div className="sticky bottom-0 mt-4 flex justify-end gap-2 bg-ink-950 py-3">
        <button className="btn-ghost px-3 py-2" onClick={onClose} disabled={saving}>{tr('Cancel')}</button>
        <button className="btn-accent px-4 py-2 disabled:opacity-50" onClick={save} disabled={!valid || saving}>
          {saving ? tr('Saving…') : selected.length === 1 ? tr('Apply 1 volume range') : tr('Apply {n} volume ranges', { n: selected.length })}
        </button>
      </div>
    </>}
  </>;
  return embedded ? body : <Modal wide="table" title={tr('Look up chapter ranges')} onClose={() => { if (!saving) onClose(); }} fieldFocus={false}>{body}</Modal>;
}
