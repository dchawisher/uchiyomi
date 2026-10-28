'use client';
import {useEffect,useRef,useState} from 'react';
import {api} from '@/lib/api';
import {t as tr} from '@/lib/i18n';
import {lookUpPageCounts,type PageCountReport} from '@/lib/pageCountLookup';
import {msgOf} from './ConfirmDialog';

export default function PageCountLookup({seriesId,disabled,onRunning,onSaved}:{
  seriesId:string;disabled:boolean;onRunning:(running:boolean)=>void;onSaved:()=>void;
}) {
  const [running,setRunning]=useState(false),[stopping,setStopping]=useState(false);
  const [report,setReport]=useState<PageCountReport|null>(null),[error,setError]=useState('');
  const stop=useRef(false),alive=useRef(true),saved=useRef(onSaved);
  saved.current=onSaved;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;stop.current=true;};},[]);
  const start=async()=>{
    stop.current=false;setRunning(true);setStopping(false);setReport(null);setError('');onRunning(true);
    try {
      await lookUpPageCounts(()=>api(`/api/admin/series/${seriesId}/chapter-page-counts`,{method:'POST',json:{limit:1}}),
        ()=>stop.current,report=>{if(alive.current){setReport(report);saved.current();}});
    }catch(e){if(alive.current)setError(msgOf(e,tr('Could not check page counts')));}
    finally{if(alive.current){setRunning(false);setStopping(false);onRunning(false);}}
  };
  return <div className="flex min-w-0 flex-wrap items-center gap-2">
    <button className="btn-key" disabled={disabled||running} onClick={()=>void start()}
      title={tr('Counts pages from the source without downloading images.')}>{running?tr('Checking…'):tr('Look up page counts')}</button>
    {running&&<button className="btn-key" disabled={stopping} onClick={()=>{stop.current=true;setStopping(true);}}
      title={tr('Stops after the current chapter.')}>{stopping?tr('Stopping…'):tr('Stop')}</button>}
    {report&&<span role="status" className="text-xs text-fog-400">{tr('Found {found} · Unavailable {failed} · Remaining {remaining}',{found:report.checked,failed:report.failed,remaining:report.remaining})}</span>}
    {error&&<span role="alert" className="text-xs text-red-300">{error}</span>}
  </div>;
}
