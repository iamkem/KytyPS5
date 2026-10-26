'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','..','src','local','table-xpr.inc'),'utf8');
const benchmark=fs.readFileSync(path.join(__dirname,'..','scene-benchmark.cjs'),'utf8');
const panel=fs.readFileSync(path.join(__dirname,'..','benchmark.js'),'utf8');
const {parseCensusEntry}=require('../scene-benchmark.cjs');
function area(a,b){
 const i=source.indexOf(a);
 assert.ok(i>=0,'missing start: '+a);
 const j=source.indexOf(b,i+a.length);
 assert.ok(j>i,'missing end: '+b);
 return source.slice(i,j);
}
const evaluation=area('bool RenderExecutor::TableEvaluate(', 'RenderExecutor::TableImageSet* RenderExecutor::TableSet(');
const packed=evaluation.slice(evaluation.indexOf('for (const auto end: form.level_ends)'));
const operand=evaluation.slice(evaluation.indexOf('const auto by_operands ='));
test('G2-E retains inclusive TableEvaluate timer and adds five new subphase keys',()=>{
 assert.match(evaluation,/LiveCensus::Scope g2c\(LiveCensus::DrawPhase, 0x7ab20, 1\)/);
 assert.match(evaluation,/0x7ab25, 1 \| LiveCensus::g_queue/);
 for(let i=2;i<=5;i++) assert.ok(evaluation.includes('0x7ab25, '+i),'missing phase '+i);
 assert.match(evaluation,/0x7ab26/);
 assert.equal((evaluation.match(/0x7ab25, 2\)/g)||[]).length,2,'packed+fallback locate timer');
 assert.equal((evaluation.match(/0x7ab25, 3\)/g)||[]).length,2,'packed+fallback read timer');
 assert.equal((evaluation.match(/0x7ab25, 4\)/g)||[]).length,2,'packed+fallback descriptor timer');
});
test('packed and fallback preserve mapping before dependent reads per dependency level',()=>{
 assert.ok(operand.indexOf('g2e_locate')<operand.indexOf('g2e_read'));
 assert.ok(operand.indexOf('if (!locate(')<operand.indexOf('reader.Read('));
 assert.ok(packed.indexOf('g2e_locate')<packed.indexOf('g2e_read'));
 assert.ok(packed.indexOf('if (!locate(')<packed.indexOf('reader.Read('));
 assert.ok(evaluation.includes('begin = end;'));
 assert.ok(evaluation.includes('NativeXprReader reader(resources)'));
});
test('fallback and indirect preserve original short-circuit and validity checks',()=>{
 assert.ok(evaluation.includes('if (!by_operands(st) || !indirect(st)) return false;'));
 assert.ok(evaluation.includes('if (!indirect(st)) return false;'));
 assert.ok(evaluation.includes('if (program.table_plan.indirect.empty()) return true;'));
 assert.ok(evaluation.includes('if (!Libs::LibKernel::Memory::IsFullyMapped(page << 14u, 16384)) return false;'));
 assert.ok(evaluation.includes('if (count == 0 || count > Plan::IndirectCapacity'));
 assert.ok(evaluation.includes('form.runs.size() != pair.runs[st].size()'));
 assert.ok(evaluation.includes('user_data[st].size() > 64'));
});
test('fallback count-only census needs native g_on; no extra guest reads',()=>{
 assert.ok(evaluation.includes('LiveCensus::g_on.load(std::memory_order_relaxed) && LiveCensus::g_render'));
 assert.ok(evaluation.includes('(fallback ? 2ull : 1ull) | LiveCensus::g_queue, 0'));
 assert.equal((evaluation.match(/reader\.Read\(/g)||[]).length,2,'same two read sites as original');
 assert.equal((evaluation.match(/EnumerateAddressProbe\(/g)||[]).length,1,'same indirect enumeration');
 assert.equal((evaluation.match(/__builtin_prefetch/g)||[]).length,1,'same prefetch site');
});
test('launcher preserves raw G2-E 64-bit keys and labels modes',()=>{
 assert.match(benchmark,/000000000007ab25/);
 assert.match(benchmark,/000000000007ab26/);
 assert.match(panel,/G2-E TableEvaluate subphases/);
 assert.match(panel,/G2-E dependent NativeXprReader reads/);
 const item=parseCensusEntry('LIVE_CENSUS_ENTRY id=100 kind=12 a=000000000007ab25 b=8000000000000003 calls_per_frame=12.00 ms_per_frame=0.0550','100');
 assert.equal(item?.a,'000000000007ab25');
 assert.equal(item?.b,'8000000000000003');
 assert.equal(item?.ms_per_frame,0.055);
 const pathCount=parseCensusEntry('LIVE_CENSUS_ENTRY id=100 kind=12 a=000000000007ab26 b=0000000000000002 calls_per_frame=24.00 ms_per_frame=0.0000','100');
 assert.equal(pathCount?.calls_per_frame,24);
});
