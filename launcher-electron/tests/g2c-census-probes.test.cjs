'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.resolve(__dirname,'../../src/local/table-xpr.inc'),'utf8');
const report=require('../scene-benchmark.cjs');

function body(signature,endSignature){
 const start=src.indexOf(signature);
 assert.ok(start>=0,'Missing function '+signature);
 const end=src.indexOf(endSignature,start+signature.length);
 assert.ok(end>start,'Missing next boundary: '+endSignature);
 return src.slice(start,end);
}
const keys={
 eval:'LiveCensus::Scope g2c(LiveCensus::DrawPhase, 0x7ab20, 1)',
 gather:'LiveCensus::Scope g2c(LiveCensus::DrawPhase, 0x7ab20, 2)',
 bda:'LiveCensus::Scope g2c(LiveCensus::DrawPhase, 0x7ab21, 1)',
 blocks:'LiveCensus::Scope g2c(LiveCensus::DrawPhase, 0x7ab21, 2)',
 indirect:'LiveCensus::Scope g2c_indirect(LiveCensus::DrawPhase, 0x7ab21, 3)',
 ring:'LiveCensus::Scope g2c_ring(LiveCensus::DrawPhase, 0x7ab22, 1)',
 fallback:'LiveCensus::Scope g2c_fallback(LiveCensus::DrawPhase, 0x7ab22, 2)',
 try:'LiveCensus::Scope g2c_try(LiveCensus::DrawPhase, 0x7ab23, 1)',
 continue:'LiveCensus::Scope g2c_continue(LiveCensus::DrawPhase, 0x7ab23, 2)'
};
test('each G2-C probe occupies a stable unique key without replacing historical timers',()=>{
 for(const [name,needle] of Object.entries(keys)){
  assert.equal(src.split(needle).length-1,1,'Probe not unique: '+name);
 }
 for(const old of [
  'phase.emplace(LiveCensus::DrawPhase, 0x7ab1e, 1)',
  'phase.emplace(LiveCensus::DrawPhase, 0x7ab1e, 3)',
  'phase.emplace(LiveCensus::DrawPhase, 0x7ab1f, 3)',
  'LiveCensus::Scope census(LiveCensus::DrawPhase, 0x7ab1e, 0)'
 ])assert.ok(src.includes(old),'Historical census scope was displaced.');
 const map=[...Object.values(keys)].map(s=>s.match(/0x[a-f0-9]+, \d+/)[0]);
 assert.equal(new Set(map).size,map.length);
});
test('evaluate and gather are timed inside original functions, with ordering unchanged',()=>{
 const evaluate=body('bool RenderExecutor::TableEvaluate(', 'void RenderExecutor::TableGather(');
 const gather=body('void RenderExecutor::TableGather(', 'bool RenderExecutor::TableBlocks(');
 const draw=body('RenderExecutor::TableResult RenderExecutor::TableDraw(', 'bool RenderExecutor::TableDispatch(');
 assert.ok(evaluate.includes(keys.eval));
 assert.ok(gather.includes(keys.gather));
 assert.ok(draw.indexOf('TableEvaluate(pair, user_data)')<draw.indexOf('TableGather(pair, user_data)'));
 assert.ok(draw.indexOf('TableGather(pair, user_data)')<draw.indexOf('TableSet(buffer, pair,'));
});
test('TableBlocks and BDA timers keep buffer ownership/validation and indirect behavior unchanged',()=>{
 const blocks=body('bool RenderExecutor::TableBlocks(', 'void RenderExecutor::TablePrepareBda(');
 const bda=body('void RenderExecutor::TablePrepareBda(', 'bool RenderExecutor::TableTransit(');
 assert.ok(blocks.includes(keys.blocks));
 assert.ok(blocks.includes(keys.ring));
 assert.ok(blocks.includes(keys.fallback));
 assert.ok(blocks.indexOf(keys.ring)<blocks.indexOf('auto* const shared ='));
 assert.ok(blocks.indexOf(keys.fallback)<blocks.indexOf('buffer_cache.EnsureBufferContents(address, size)'));
 assert.ok(bda.indexOf('if (!global(0) && !global(1)) return;')<bda.indexOf(keys.bda));
 const dispatch=src.slice(src.indexOf('TablePrepareBda(pair, user_data); // (as TableDraw'));
 assert.ok(dispatch.includes(keys.indirect));
});
test('continuations are distinguishable from TableTry, with original fallbacks preserved',()=>{
 const first=body('RenderExecutor::TableResult RenderExecutor::TableTry(', 'bool RenderExecutor::TableContinue(');
 const next=body('bool RenderExecutor::TableContinue(', 'RenderExecutor::TableImageSet* RenderExecutor::TableResolveSet(');
 assert.ok(first.includes(keys.try));
 assert.ok(next.includes(keys.continue));
 assert.ok(next.includes('!= TableResult::Drawn'));
 assert.ok(next.includes('LiveCounters::Add(LiveCounters::TableContinued'));
});
test('JSON census report selects raw G2-C 64-bit keys separately from top general scopes',()=>{
 const needles=fs.readFileSync(path.resolve(__dirname,'../scene-benchmark.cjs'),'utf8');
 for(const key of ['000000000007ab20','000000000007ab21','000000000007ab22','000000000007ab23']){
  assert.ok(needles.includes(key));
 }
 assert.ok(needles.includes('focusEntries:entries.filter(x=>focusKeys.has(x.a))'));
 const item=report.parseCensusEntry('LIVE_CENSUS_ENTRY id=17 kind=12 a=000000000007ab20 b=8000000000000001 calls_per_frame=25.00 ms_per_frame=1.2345',17);
 assert.equal(item?.a,'000000000007ab20');
 assert.equal(item?.b,'8000000000000001');
});
