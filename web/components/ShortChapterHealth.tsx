'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { t as tr } from '@/lib/i18n';
import { healthQuery } from '@/lib/healthBySeries';
import { healthLinks } from '@/lib/healthLinks';
import { itemKey } from '@/lib/healthKeys';
import { itemDetail } from '@/lib/said';
import type { HealthCheck, HealthItem } from '@/lib/types';
import { HealthRow } from './HealthActions';
import { msgOf } from './ConfirmDialog';
import { useToast } from './Toast';

const queryKey = ['short-chapter-health'] as const;
interface ShortReport {
  items: HealthItem[];
  disabledSeries: { seriesId: string; title: string }[];
}

export function ShortChapterCheckToggle({ seriesId, enabled }: { seriesId: string; enabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const toggle = async () => {
    setBusy(true);
    try {
      await api(`/api/admin/series/${encodeURIComponent(seriesId)}/short-chapter-check`, {
        method: 'POST', json: { enabled: !enabled },
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey }),
        qc.invalidateQueries({ queryKey: healthQuery.queryKey }),
      ]);
      // The health report above stores the summary before the header reads it.
      await qc.invalidateQueries({ queryKey: ['health-summary'] });
    } catch (e) {
      toast(msgOf(e, tr('Could not update short-chapter checking')), 'error');
    } finally {
      setBusy(false);
    }
  };
  return <button type="button" className="btn-key" disabled={busy} onClick={toggle}>
    {busy ? tr('Saving…') : enabled ? tr('Disable short-chapter check') : tr('Enable checking')}
  </button>;
}

function ShortSeries({ check, seriesId, items }: { check: HealthCheck; seriesId: string; items: HealthItem[] }) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(20);
  const id = useId();
  return <section data-short-series={seriesId} className="border-t border-ink-800/70">
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <button type="button" className="min-w-0 flex-1 text-start" aria-expanded={open} aria-controls={id}
        onClick={() => setOpen(!open)}>
        <span dir="auto" className="block break-words text-sm text-fog-100">{items[0].title}</span>
        <span className="text-xs text-fog-500">
          {items.length === 1 ? tr('1 short chapter') : tr('{n} short chapters', { n: items.length })}
          {' · '}{open ? tr('Hide details') : tr('Show details')}
        </span>
      </button>
      <ShortChapterCheckToggle seriesId={seriesId} enabled />
    </div>
    {open && <div id={id} className="divide-y divide-ink-800/70">
      {items.slice(0, count).map((item) => {
        const key = itemKey(check.id, item);
        return <HealthRow key={key} rowKey={key} check={check} item={item}
          links={healthLinks(check.id, item).map((link) => <Link key={link.href} href={link.href}
            className="text-xs text-accent hover:underline">{tr('Open')}</Link>)}>
          <p dir="auto" className="text-xs text-fog-300">{itemDetail(item)}</p>
        </HealthRow>;
      })}
      {items.length > count && <div className="px-4 py-3">
        <button type="button" className="btn-key" onClick={() => setCount(count + 20)}>
          {tr('Show {n} more', { n: Math.min(20, items.length - count) })}
        </button>
      </div>}
    </div>}
  </section>;
}

export function ShortChapterHealth({ check, reportAt }: { check: HealthCheck; reportAt: string }) {
  const { data, error, refetch } = useQuery({
    queryKey: [...queryKey, reportAt],
    queryFn: () => api<ShortReport>('/api/admin/health/short-chapters'),
    placeholderData: (previous) => previous,
    gcTime: 0,
  });
  // The dedicated endpoint includes all findings, even series beyond the report's fifty-row preview.
  const groups = new Map<string, HealthItem[]>();
  for (const item of data?.items ?? []) {
    if (!item.seriesId) continue;
    const group = groups.get(item.seriesId);
    if (group) group.push(item);
    else groups.set(item.seriesId, [item]);
  }
  return <div data-short-chapter-health>
    <p className="px-4 py-3 text-xs text-fog-500">
      {tr('Disabling this check also skips short-chapter repairs for this series, including future chapters.')}
    </p>
    {error ? <div role="alert" className="px-4 pb-3">
      <p>{tr('Could not load short chapters')}</p>
      <button type="button" className="btn-key" onClick={() => refetch()}>{tr('Retry')}</button>
    </div> : !data ? <p role="status" className="px-4 pb-3">{tr('Checking…')}</p> : <>
      {groups.size === 0 && <p className="px-4 pb-3 text-xs text-fog-500">{tr('No short chapters to check')}</p>}
      {[...groups].map(([seriesId, items]) => <ShortSeries key={seriesId} seriesId={seriesId} items={items} check={check} />)}
      {data.disabledSeries.length > 0 && <div className="border-t border-ink-800/70 px-4 py-3">
        <h3 className="mb-2 text-xs text-fog-500">{tr('Checking disabled')}</h3>
        {data.disabledSeries.map((series) => <div key={series.seriesId} data-short-disabled={series.seriesId}
          className="flex flex-wrap items-center justify-between gap-3 py-2">
          <span dir="auto" className="min-w-0 flex-1 break-words text-sm text-fog-300">{series.title}</span>
          <ShortChapterCheckToggle seriesId={series.seriesId} enabled={false} />
        </div>)}
      </div>}
    </>}
  </div>;
}
