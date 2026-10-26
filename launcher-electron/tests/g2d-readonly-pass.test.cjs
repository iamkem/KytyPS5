'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const l=require('../logic.cjs');
const source=p=>fs.readFileSync(path.resolve(__dirname,'../..',p),'utf8');
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'kyty-g2d-launcher-'));
 const exe=l.findEmulator(root),game=path.join(root,'game');
 fs.mkdirSync(path.dirname(exe),{recursive:true});
 fs.mkdirSync(path.join(game,'sce_sys'),{recursive:true});
 fs.writeFileSync(exe,'mock executable');
 fs.writeFileSync(path.join(game,'eboot.bin'),'mock game');
 return {root,game,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('G2-D is default off; save/load and Graphics presets preserve explicit choice',()=>{
 const f=fixture();
 try {
  assert.equal(l.clean({}).table_readonly_trial,false);
  assert.equal(l.clean({table_readonly_trial:true}).table_readonly_trial,true);
  const value=l.saveSettings(f.root,{table_readonly_trial:true,scene_benchmark:true});
  assert.equal(value.table_readonly_trial,true);
  assert.equal(l.loadSettings(f.root).table_readonly_trial,true);
  assert.equal(l.applyPreset(value,'Performance').table_readonly_trial,true);
  assert.equal(l.clean({...value,table_readonly_trial:false}).table_readonly_trial,false);
 }finally{f.close();}
});
test('Standard launch explicitly overrides inherited/config G2-D flags with 0; opt-in 1 only when selected',()=>{
 const f=fixture();
 try {
  const base={...l.defaults,game:f.game,upscaler:'',hud:0,shader_mode:'standard'};
  for(const mode of [false,true]){
   const spec=l.buildPlayArgs(f.root,{...base,table_readonly_trial:mode});
   const idx=spec.args.indexOf('-Set');
   assert.ok(idx>0);
   const vars=spec.args[idx+1].split(',');
   assert.equal(vars.filter(x=>x.startsWith('KYTY_TABLE_READONLY_PASS_SKIP=')).length,1);
   assert.ok(vars.includes('KYTY_TABLE_READONLY_PASS_SKIP='+(mode?'1':'0')));
   assert.equal(spec.args.includes('-ShaderFeatureTrial'),false);
  }
 }finally{f.close();}
});
test('opt-in policy is registered as zero-default bounded switch, no shader pipeline-cache toggle',()=>{
 const sw=source('src/local/performance-switches.h');
 const def=source('src/local/native-xpr.inc');
 const impl=source('src/local/table-xpr.inc');
 const hdr=source('src/local/table-readonly-pass.h');
 const census=source('src/local/live-census.h');
 const report=source('launcher-electron/scene-benchmark.cjs');
 assert.match(sw,/Switch \{"KYTY_TABLE_READONLY_PASS_SKIP", &kyty_local_table_readonly_pass_skip\}/);
 assert.match(def,/kyty_local_table_readonly_pass_skip \{0\}/);
 assert.match(impl,/TableReadOnlyPass::Eligible\(plan.buffers.size\(\), info\)/);
 assert.match(impl,/TableReadOnlyPass::Begin\(readonly_pass_skip, eligible, buffers\)/);
 assert.match(hdr,/resource.written \|\| resource.atomic/);
 assert.match(impl,/pair.readonly_buffer_stage = \{\}/);
 assert.match(impl,/LiveCensus::Add\(LiveCensus::DrawPhase, 0x7ab24/);
 assert.match(impl,/LiveCensus::g_queue/);
 assert.match(census,/inline std::atomic_bool g_on/);
 assert.match(report,/000000000007ab24/);
});
test('Launcher control stays independent of shader mode and has default Off option',()=>{
 const html=fs.readFileSync(path.join(__dirname,'..','options.html'),'utf8');
 const js=fs.readFileSync(path.join(__dirname,'..','options.js'),'utf8');
 assert.match(html,/<select id="table-readonly-trial">/);
 assert.match(html,/<option value="false">Off \(baseline\)<\/option>/);
 assert.match(js,/'table-readonly-trial':'table_readonly_trial'/);
});
