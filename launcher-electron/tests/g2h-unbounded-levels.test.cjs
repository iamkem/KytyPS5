'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const l=require('../logic.cjs');
const source=p=>fs.readFileSync(path.join(__dirname,'../..',p),'utf8');
const fixture=()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'kyty-g2h-'));
 const exe=l.findEmulator(root),game=path.join(root,'game');
 fs.mkdirSync(path.dirname(exe),{recursive:true});
 fs.mkdirSync(path.join(game,'sce_sys'),{recursive:true});
 fs.writeFileSync(exe,'mock native');
 fs.writeFileSync(path.join(game,'eboot.bin'),'mock game');
 return {root,game,close:()=>fs.rmSync(root,{recursive:true,force:true})};
};
test('G2-H strict opt-in, defaults OFF; presets preserve explicit On',()=>{
 assert.equal(l.clean({}).table_unbounded_trial,false);
 for(const value of ['false','true',{},1,0,false,null,[]])
  assert.equal(l.clean({table_unbounded_trial:value}).table_unbounded_trial,false);
 assert.equal(l.clean({table_unbounded_trial:true}).table_unbounded_trial,true);
 const f=fixture();
 try{
  const s=l.saveSettings(f.root,{table_unbounded_trial:true});
  assert.equal(l.loadSettings(f.root).table_unbounded_trial,true);
  assert.equal(l.applyPreset(s,'Performance').table_unbounded_trial,true);
 }finally{f.close()}
});
test('G2-H independent of G2-D, G2-G, shader Standard; always overrides inherited flags',()=>{
 const f=fixture();
 try{
  for(const h of [false,true])for(const d of [false,true])for(const g of [false,true]){
   const config={...l.defaults,game:f.game,upscaler:'',shader_mode:'standard',
    table_unbounded_trial:h,table_readonly_trial:d,table_prefetch_trial:g};
   const spec=l.buildPlayArgs(f.root,config);
   const vars=spec.args[spec.args.indexOf('-Set')+1].split(',');
   for(const [key,enabled] of [['KYTY_TABLE_UNBOUNDED_LEVELS',h],
      ['KYTY_TABLE_READONLY_PASS_SKIP',d],['KYTY_TABLE_PREFETCH_DEDUPE',g]]){
     assert.equal(vars.filter(x=>x.startsWith(key+'=')).length,1);
     assert.ok(vars.includes(key+'='+(enabled?'1':'0')));
   }
   assert.equal(spec.args.includes('-ShaderFeatureTrial'),false);
  }
 }finally{f.close()}
});
test('G2-H precomputed after TablePack and conservatively reset; invalid/fallback unchanged',()=>{
 const tbl=source('src/local/table-xpr.inc'),head=source('src/local/table-unbounded-levels.h');
 const sw=source('src/local/performance-switches.h'),def=source('src/local/native-xpr.inc');
 const start=tbl.indexOf('bool RenderExecutor::TableEvaluate(');
 const end=tbl.indexOf('// The image set of the words TableEvaluate made:',start);
 const evalSource=tbl.slice(start,end);
 assert.match(sw,/Switch \{"KYTY_TABLE_UNBOUNDED_LEVELS", &kyty_local_table_unbounded_levels\}/);
 assert.match(def,/kyty_local_table_unbounded_levels \{0\}/);
 assert.match(tbl,/for \(auto& flags : pair.unbounded_levels\) flags.clear\(\)/);
 assert.match(tbl,/TablePack\(pair, flat_forms\)/);
 assert.match(tbl,/TableUnboundedLevels::Compute\(packed.runs, packed.level_ends/);
 assert.match(tbl,/if \(!pair.packed\[st\].valid\) continue/);
 assert.match(head,/if \(end <= begin \|\| end > runs.size\(\)\) return/);
 assert.match(evalSource,/g2h_unbounded_levels && unbounded/);
 assert.match(evalSource,/if \(specialized\) \{/);
 assert.match(evalSource,/const bool  bounded = run.records != TablePair::PackedRun::NotBounded/);
 assert.match(evalSource,/if \(!locate\(get\(run.address\[0\]\)/);
 assert.match(evalSource,/IsFullyMapped\(page << 14u, 16384\)/);
 assert.match(evalSource,/reader.Read\(table.addresses\[i\]/);
});
test('G2-H aggregate sampled level/run counters separately by queue',()=>{
 const hdr=source('src/local/g2f-evaluate-diagnostics.h'),tbl=source('src/local/table-xpr.inc');
 const c=source('launcher-electron/scene-benchmark.cjs'),ui=source('launcher-electron/benchmark.js');
 assert.match(hdr,/UnboundedLevels, Runs, UnboundedRuns, OptimizedLevels, OptimizedRuns/);
 assert.match(tbl,/TableG2FAddCount\(0x7ab29, \(i \+ 1\) \| queue, c.packed\[i\]\)/);
 assert.match(c,/000000000007ab29/);
 assert.match(ui,/G2-H packed unbounded-level opportunity/);
});
test('G2-H visible Launcher control defaults Off',()=>{
 const html=source('launcher-electron/options.html'),js=source('launcher-electron/options.js');
 assert.match(html,/<select id="table-unbounded-trial">/);
 assert.match(html,/On \(G2-H CPU test\)/);
 assert.match(js,/'table-unbounded-trial':'table_unbounded_trial'/);
});
