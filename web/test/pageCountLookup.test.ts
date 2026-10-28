import test from 'node:test';
import assert from 'node:assert/strict';
import {lookUpPageCounts,type PageCountReport} from '../lib/pageCountLookup';

test('counts accumulate through every batch, including failed lookups',async()=>{
  const batches=[{checked:1,failed:0,remaining:2},{checked:0,failed:1,remaining:1},{checked:1,failed:0,remaining:0}];
  const reports:PageCountReport[]=[];
  await lookUpPageCounts(async()=>batches.shift()!,()=>false,r=>reports.push(r));
  assert.deepEqual(reports.at(-1),{checked:2,failed:1,remaining:0});
  assert.equal(reports.length,3);
});
test('stop retains the current result and does not start another request',async()=>{
  let stop=false,calls=0;const reports:PageCountReport[]=[];
  await lookUpPageCounts(async()=>{calls++;stop=true;return {checked:1,failed:0,remaining:3};},()=>stop,r=>reports.push(r));
  assert.equal(calls,1);assert.equal(reports[0].checked,1);
});
test('failed requests and a non-advancing response cannot cause a retry loop',async()=>{
  await assert.rejects(lookUpPageCounts(async()=>{throw new Error('source unavailable');},()=>false,()=>{}),/source unavailable/);
  await assert.rejects(lookUpPageCounts(async()=>({checked:0,failed:0,remaining:1}),()=>false,()=>{}),/no progress/);
});
