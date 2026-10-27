'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const l=require('../logic.cjs');
const code=(p)=>fs.readFileSync(path.resolve(__dirname,'../..',p),'utf8');
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'kyty-g2g-'));
 const exe=l.findEmulator(root), game=path.join(root,'game');
 fs.mkdirSync(path.dirname(exe),{recursive:true});
 fs.mkdirSync(path.join(game,'sce_sys'),{recursive:true});
 fs.writeFileSync(exe,'mock native');
 fs.writeFileSync(path.join(game,'eboot.bin'),'mock game');
 return {root,game,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('G2-G trial defaults Off and only literal true can opt in',()=>{
 assert.equal(l.clean({}).table_prefetch_trial,false);
 for(const invalid of ['true','false','0','1',{},[],1,0,null,false])
  assert.equal(l.clean({table_prefetch_trial:invalid}).table_prefetch_trial,false);
 assert.equal(l.clean({table_prefetch_trial:true}).table_prefetch_trial,true);
 const f=fixture();
 try{
  const s=l.saveSettings(f.root,{table_prefetch_trial:true});
  assert.equal(s.table_prefetch_trial,true);
  assert.equal(l.loadSettings(f.root).table_prefetch_trial,true);
  assert.equal(l.applyPreset(s,'Performance').table_prefetch_trial,true);
 }finally{f.close()}
});
test('G2-G and G2-D flags remain independent under Standard and launch toggles',()=>{
 const f=fixture();
 try{
  for(const g2g of [false,true])for(const g2d of [false,true]){
   const base={...l.defaults,game:f.game,upscaler:'',shader_mode:'standard',
     table_readonly_trial:g2d,table_prefetch_trial:g2g};
   const spec=l.buildPlayArgs(f.root,base);
   const idx=spec.args.indexOf('-Set');
   const vars=spec.args[idx+1].split(',');
   assert.equal(vars.filter(x=>x.startsWith('KYTY_TABLE_PREFETCH_DEDUPE=')).length,1);
   assert.equal(vars.filter(x=>x.startsWith('KYTY_TABLE_READONLY_PASS_SKIP=')).length,1);
   assert.ok(vars.includes('KYTY_TABLE_PREFETCH_DEDUPE='+(g2g?'1':'0')));
   assert.ok(vars.includes('KYTY_TABLE_READONLY_PASS_SKIP='+(g2d?'1':'0')));
   assert.equal(spec.args.includes('-ShaderFeatureTrial'),false);
  }
 }finally{f.close()}
});
test('Native G2-G gate defaults 0 and only suppresses advisory prefetch in level-local scope',()=>{
 const sw=code('src/local/performance-switches.h');
 const def=code('src/local/native-xpr.inc');
 const tbl=code('src/local/table-xpr.inc');
 const header=code('src/local/table-prefetch-dedupe.h');
 assert.match(sw,/Switch \{"KYTY_TABLE_PREFETCH_DEDUPE", &kyty_local_table_prefetch_dedupe\}/);
 assert.match(def,/kyty_local_table_prefetch_dedupe \{0\}/);
 assert.match(tbl,/kyty_local_table_prefetch_dedupe\.load\(std::memory_order_relaxed\)/);
 assert.match(tbl,/g2g_prefetch_dedupe && g2g_prefetch_state\.ShouldSkip\(line\)/);
 assert.match(tbl,/__builtin_prefetch\(reinterpret_cast<const void\*>\(line\)\)/);
 assert.match(tbl,/IsFullyMapped\(page << 14u, 16384\)/);
 assert.match(header,/previous == line/);
 assert.equal((tbl.match(/g2g_prefetch_state.BeginLevel\(\)/g)||[]).length,2);
 assert.match(tbl,/G2FDiagnostics::SuppressedPrefetch/);
 assert.match(tbl,/g2f->NotePrefetch\(line\)/);
});
test('G2-G selector and report allow Off rollback, sampled suppressed counter is count-only',()=>{
 const html=code('launcher-electron/options.html');
 const js=code('launcher-electron/options.js');
 const report=code('launcher-electron/benchmark.js');
 assert.match(html,/<select id="table-prefetch-trial">/);
 assert.match(html,/<option value="false">Off \(baseline\)<\/option>/);
 assert.match(js,/'table-prefetch-trial':'table_prefetch_trial'/);
 assert.match(report,/const issued=select\('28',10\),duplicates=select\('28',11\),suppressed=select\('28',12\)/);
 assert.match(code('src/local/g2f-evaluate-diagnostics.h'),/SuppressedPrefetch/);
});
