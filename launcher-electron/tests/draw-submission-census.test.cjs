'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..','..');const get=p=>fs.readFileSync(path.join(root,p),'utf8');
test('Retired draw packet census is fully disconnected from hot PM4 and frame boundary paths',()=>{
 for(const p of ['src/graphics/guest_gpu/graphicsRun.cpp','src/graphics/guest_gpu/command_processor/commandProcessor.h']){
  assert.doesNotMatch(get(p),/DrawSubmissionCensus|draw-submission-census|m_draw_submission_census|DRAW_SUBMISSION_CENSUS|ReportDrawSubmissionCensus/);
 }
 assert.doesNotMatch(get('launcher-electron/README.md'),/DRAW_SUBMISSION_CENSUS/);
});
