export type PageCountReport = {checked:number;failed:number;remaining:number};

/** Small requests keep progress visible and let Stop finish only the current lookup. */
export async function lookUpPageCounts(batch:()=>Promise<PageCountReport>, stopped:()=>boolean,
  progress:(report:PageCountReport)=>void):Promise<void> {
  let checked=0,failed=0;
  while(!stopped()) {
    const next=await batch();
    checked+=next.checked;failed+=next.failed;
    progress({checked,failed,remaining:next.remaining});
    if(next.remaining===0)return;
    if(next.checked+next.failed===0)throw new Error('Page-count lookup made no progress');
  }
}
