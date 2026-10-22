'use strict';
// Shader *inputs*, not active GPU cache. Conservative filename allowlist; no arbitrary paths from the renderer.
const fs=require('node:fs');
const path=require('node:path');
const GAME='[A-Z]{4}[0-9]{5}_[0-9.]+';
const rules=[
  {rx:new RegExp('^seeds-('+GAME+')\\.seeds$'),kind:'base',level:'protected',label:'KEEP — BASE SEEDS',
   reason:'Original game shader seeds. Required for cache verification; deleting forces shader extraction.'},
  {rx:new RegExp('^cache-fingerprint-('+GAME+')\\.json$'),kind:'fingerprint',level:'protected',label:'KEEP — VERIFY',
   reason:'Content fingerprint used to prevent unnecessary shader recompilation.'},
  {rx:new RegExp('^seeds-('+GAME+')\\.seeds\\.program$'),kind:'legacy',level:'safe',label:'SAFE TO CLEAN',
   reason:'Legacy build timestamp marker. Current incremental scripts no longer rely on it.'},
  {rx:new RegExp('^(?:hinted|released|recorded)-('+GAME+')\\.seeds$'),kind:'derived',level:'review',label:'REGENERABLE — REVIEW',
   reason:'Derived shader specializations; removing forces regeneration before the next precompile.'},
  {rx:new RegExp('^recorded-play-('+GAME+')\\.hints$'),kind:'derived',level:'review',label:'REGENERABLE — REVIEW',
   reason:'Combined recorded-play hints. May be recreated from release hints and warmup recordings.'}
];
function inventory(root){
  const dir=path.join(root,'_Build','static-precompile');
  if(!fs.existsSync(dir))return [];
  return fs.readdirSync(dir,{withFileTypes:true}).filter(e=>e.isFile()&&!e.isSymbolicLink())
    .flatMap(e=>{
      const rule=rules.find(r=>r.rx.test(e.name));
      if(!rule)return [];
      const stat=fs.lstatSync(path.join(dir,e.name));
      if(!stat.isFile()||stat.isSymbolicLink())return [];
      return [{id:e.name,title:e.name,category:'input',kind:rule.kind,cleanupLevel:rule.level,
        cleanupLabel:rule.label,cleanupReason:rule.reason,bytes:stat.size,count:1,
        newest:stat.mtime.toISOString(),deletable:rule.level!=='protected',locked:rule.level==='protected'}];
    }).sort((a,b)=>(a.locked?0:1)-(b.locked?0:1)||a.title.localeCompare(b.title));
}
async function remove(root,ids,shell,assertIdle){
  if(!Array.isArray(ids)||!ids.length||ids.length>10||ids.some(v=>typeof v!=='string'))
    throw Error('Invalid shader input selection');
  assertIdle();
  const all=new Map(inventory(root).map(x=>[x.id,x]));
  const unique=[...new Set(ids)];
  if(unique.length!==ids.length||unique.some(id=>!all.has(id)))throw Error('Shader input list changed; refresh');
  if(unique.some(id=>!all.get(id).deletable))throw Error('Required shader inputs are locked');
  const base=fs.realpathSync(path.join(root,'_Build','static-precompile'));
  let moved=0;
  for(const id of unique){
    assertIdle();
    const file=path.join(base,id),real=fs.realpathSync(file);
    if(path.dirname(real)!==base||fs.lstatSync(real).isSymbolicLink())throw Error('Unsafe shader input path');
    await shell.trashItem(real);moved++;
  }
  return {deletedFiles:moved};
}
module.exports={inventory,remove};
