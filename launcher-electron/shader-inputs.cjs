'use strict';
// Compilation seeds/hints are provenance for the active shader cache. They are NEVER
// cleanup targets, even when a derived copy can technically be regenerated.
// Show all relevant locations; do not expose or accept arbitrary filesystem paths.
const fs=require('node:fs');
const path=require('node:path');
const GAME='[A-Z]{4}[0-9]{5}_[0-9.]+';
const game=GAME;
const rules={
  build:[
    {rx:new RegExp('^seeds-('+game+')\\.seeds$'),kind:'base',label:'KEEP — BASE SEEDS',
      reason:'Original game shader seeds, required to verify and incrementally update the active cache.'},
    {rx:new RegExp('^(?:hinted|released|recorded)-('+game+')\\.seeds(?:\\.new)?$'),kind:'derived',label:'KEEP — DERIVED SEEDS',
      reason:'Recorded-play shader specializations. Regeneration may be expensive or require gameplay recordings.'},
    {rx:new RegExp('^recorded-play-('+game+')\\.hints$'),kind:'recordings',label:'KEEP — PLAY HINTS',
      reason:'Merged recorded-play hints used by shader precompile; do not discard prior coverage.'},
    {rx:new RegExp('^cache-fingerprint-('+game+')\\.json$'),kind:'fingerprint',label:'KEEP — VERIFY',
      reason:'Content fingerprint needed to detect changed shader inputs and prevent false completion.'},
    {rx:new RegExp('^seeds-('+game+')\\.seeds\\.program$'),kind:'legacy',label:'KEEP — LEGACY',
      reason:'Legacy shader metadata retained for safety; current precompile does not depend on it.'}
  ],
  release:[
    {rx:new RegExp('^hints-('+game+')\\.hints(?:\\.backup[-.][a-zA-Z0-9_-]+)?$'),kind:'release',label:'KEEP — RELEASE HINTS',
      reason:'Published game-version-specific hints or their previous backup. Needed to retain shader coverage.'},
    {rx:new RegExp('^files-('+game+')\\.files$'),kind:'manifest',label:'KEEP — SOURCE MANIFEST',
      reason:'Game file listing for static shader extraction.'},
    {rx:/^pass-states\.json$/,kind:'states',label:'KEEP — PASS STATES',
      reason:'Render pass definitions used when generating shader seeds.'}
  ],
  root:[
    {rx:new RegExp('^(?:seeds|hinted|released|recorded)-('+game+')\\.seeds$'),kind:'base',label:'KEEP — SEEDS',
      reason:'Release-layout seeds or saved shader specializations.'},
    {rx:new RegExp('^(?:my-hints|recorded-play)-('+game+')\\.hints$'),kind:'recordings',label:'KEEP — GAMEPLAY HINTS',
      reason:'User-exported or recorded-play shader hints.'}
  ]
};
const locations=[
  {kind:'build',prefix:'',relative:path.join('_Build','static-precompile')},
  {kind:'release',prefix:'release:',relative:path.join('tools','local','static-precompile')},
  {kind:'root',prefix:'root:',relative:''}
];
function inventory(root){
  const result=[];
  for(const source of locations){
    const dir=path.join(root,source.relative);
    if(!fs.existsSync(dir))continue;
    for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
      if(!entry.isFile()||entry.isSymbolicLink())continue;
      const rule=rules[source.kind].find(r=>r.rx.test(entry.name));
      if(!rule)continue;
      const stat=fs.lstatSync(path.join(dir,entry.name));
      if(!stat.isFile()||stat.isSymbolicLink())continue;
      result.push({
        id:source.prefix+entry.name,title:entry.name,category:'input',kind:rule.kind,
        cleanupLevel:'protected',cleanupLabel:rule.label,cleanupReason:rule.reason,
        location:source.relative.replaceAll('\\','/')||'.',
        bytes:stat.size,count:1,newest:stat.mtime.toISOString(),deletable:false,locked:true
      });
    }
  }
  return result.sort((a,b)=>a.location.localeCompare(b.location)||a.title.localeCompare(b.title));
}
async function remove(root,ids,shell,assertIdle){
  if(!Array.isArray(ids)||!ids.length||ids.length>10||ids.some(v=>typeof v!=='string'))
    throw Error('Invalid shader input selection');
  assertIdle();
  const known=new Map(inventory(root).map(x=>[x.id,x]));
  if(ids.some(id=>!known.has(id)))throw Error('Shader input list changed; refresh');
  // Deliberately fail closed. No UI/IPC caller can delete a base seed,
  // release hint, recorded hint, generated seed or related source manifest.
  throw Error('Required shader seeds, hints and compilation inputs are locked');
}
module.exports={inventory,remove};
