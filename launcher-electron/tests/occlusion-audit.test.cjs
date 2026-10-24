'use strict';
const test=require('node:test'); const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..','..');
const get=p=>fs.readFileSync(path.join(root,p),'utf8');
const lib=require('../logic.cjs');
test('Retired Occlusion Audit does not emit audit banner, counter reports or launcher flags',()=>{
 assert.equal(Object.hasOwn(lib.defaults,'occlusion_audit'),false);
 assert.equal(Object.hasOwn(lib.clean({occlusion_audit:true}),'occlusion_audit'),false);
 for(const file of ['src/graphics/guest_gpu/graphicsRun.cpp','src/graphics/guest_gpu/command_processor/pm4Handlers.cpp','src/graphics/guest_gpu/command_processor/commandProcessor.h','launcher-electron/logic.cjs','launcher-electron/options.js','launcher-electron/options.html']){
  assert.doesNotMatch(get(file),/OCCLUSION_AUDIT|OcclusionQueryAudit|KYTY_OCCLUSION_AUDIT|occlusion_audit|Occlusion Query Audit|occlusion-audit/);
 }
 // Original guest-visible synthetic always-visible occlusion result must survive.
 const run=get('src/graphics/guest_gpu/graphicsRun.cpp');
 assert.match(run,/m_synthetic_occlusion_counter/);
 assert.match(run,/Warning: game uses occlusion queries/);
});
