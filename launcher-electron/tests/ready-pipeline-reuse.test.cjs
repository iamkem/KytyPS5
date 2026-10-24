'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..','..');const get=p=>fs.readFileSync(path.join(root,p),'utf8');
const lib=require('../logic.cjs');
test('Retired Ready Pipeline Reuse has no experimental sync-adoption path',()=>{
 assert.equal(Object.hasOwn(lib.defaults,'ready_pipeline_reuse'),false);
 assert.equal(Object.hasOwn(lib.clean({ready_pipeline_reuse:true}),'ready_pipeline_reuse'),false);
 for(const p of ['launcher-electron/options.html','launcher-electron/options.js','launcher-electron/logic.cjs','src/graphics/host_gpu/renderer/pipeline/pipelineCache.cpp']){
  assert.doesNotMatch(get(p),/ReadyPipelineReuse|PIPELINE_READY_REUSE|KYTY_READY_PIPELINE_REUSE|ready_pipeline_reuse|ready-pipeline-reuse|Ready Pipeline Reuse/);
 }
 const src=get('src/graphics/host_gpu/renderer/pipeline/pipelineCache.cpp');
 assert.match(src,/if \(async\) \{/);
 assert.match(src,/m_pending_graphics_pipelines\.find\(key\)/);
 assert.match(src,/done\.load\(std::memory_order_acquire\)/);
});
