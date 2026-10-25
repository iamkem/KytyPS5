'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const audit=require('../../tools/local/graphics-audit-baseline.cjs');

test('audit counts only threshold-filtered slow events, not all game frames',()=>{
 const lines=[
  'Game args: test profile',
  '[tsc 1] SLOW Frame 220.0 ms idle=200.0 cpu=4.0 unix_ms=100',
  '[tsc 2] SLOW Frame 110.0 ms idle=1.0 compile=48.0 record_wait=37.0 gpu_wait=16.0 unix_ms=101',
  '[tsc 3] SLOW Frame 150.0 ms idle=10.0 compile=4.0 gpu_wait=2.0 unix_ms=102'
 ].join('\n');
 const result=audit.summarize(lines);
 assert.equal(result.slow_events,3);
 assert.equal(result.median_slow_ms,150);
 assert.equal(result.worst_slow_ms,220);
 assert.equal(result.high_idle_events_80pct,1);
 assert.equal(result.compile_events_ge_10ms,1);
 assert.equal(result.gpu_wait_events_ge_10ms,1);
 assert.equal(result.gpu_wait_not_reported_events,1);
 assert.equal(result.max_compile_ms,48);
 for(const name of ['fps_average','fps_1pct_low','gpu_busy_ms'])assert.equal(result[name],null);
});
test('audit handles missing metrics and empty logs without inventing FPS',()=>{
 const empty=audit.summarize('Loaded world\n');
 assert.equal(empty.slow_events,0);
 assert.equal(empty.p95_slow_ms,null);
 assert.equal(empty.fps_average,null);
 const lone=audit.parseSlowLine('[tsc 1] SLOW Frame 105.1 ms idle=0.0 cpu=10.2 compile=5.5');
 assert.equal(lone.ms,105.1); assert.equal(lone.gpu_wait,null);
});
test('read-only session selection ignores precompile and arbitrary paths',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'kyty-audit-'));
 try{
   fs.writeFileSync(path.join(root,'20261025-090000-001.out.log'),'SLOW Frame 200.0 ms idle=190.0');
   fs.writeFileSync(path.join(root,'20261025-090000-002.out.log'),'SLOW Frame 100.0 ms gpu_wait=20.0');
   fs.writeFileSync(path.join(root,'precompile.out.log'),'SLOW Frame 9999.0 ms');
   fs.writeFileSync(path.join(root,'README'),'');
   const chosen=audit.recentLogs(root,1);
   assert.equal(chosen.length,1);
   assert.equal(path.basename(chosen[0]),'20261025-090000-002.out.log');
   assert.equal(audit.audit(chosen).sessions[0].slow_events,1);
   assert.throws(()=>audit.recentLogs(root,0));
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});
