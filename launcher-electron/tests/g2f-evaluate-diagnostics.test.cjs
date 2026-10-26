'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const dir=path.resolve(__dirname,'../..');
const code=p=>fs.readFileSync(path.join(dir,p),'utf8');
const native=code('src/local/native-xpr.inc');
const tbl=code('src/local/table-xpr.inc');
const hdr=code('src/local/g2f-evaluate-diagnostics.h');
const benchmark=code('launcher-electron/scene-benchmark.cjs');
const ui=code('launcher-electron/benchmark.js');
const {parseCensusEntry}=require('../scene-benchmark.cjs');

test('G2-F is sampled 1-in-32 and only activates during an explicit native CPU Census',()=>{
 assert.match(hdr,/SampleEvery = 32/);
 assert.match(tbl,/LiveCensus::g_on.load\(std::memory_order_relaxed\) && LiveCensus::g_render/);
 assert.match(tbl,/g2f_sequence % G2FDiagnostics::SampleEvery == 0/);
 assert.match(tbl,/else if \(!census_on\) g2f_sequence = 0/);
 assert.match(tbl,/if \(!counters\) return/);
});
test('weighted count-only census uses calls not cycles; queues stay distinct',()=>{
 assert.match(tbl,/TableG2FAddCount\(0x7ab27, \(i \+ 1\) \| queue, c.reader\[i\]\)/);
 assert.match(tbl,/TableG2FAddCount\(0x7ab28, \(i \+ 1\) \| queue, c.locate\[i\]\)/);
 assert.match(tbl,/entry.calls \+= count/);
 assert.match(tbl,/entry = \{a, b, 0, 0, kind, true\}/);
 assert.match(tbl,/c.locate\[G2FDiagnostics::SampledEvaluations\] = 1/);
 assert.match(tbl,/if \(success\) c.locate\[G2FDiagnostics::CompletedEvaluations\] = 1/);
});
test('NativeXprReader remains unwatched when not used by TableEvaluate and retains correct read ordering',()=>{
 const classDef=native.slice(native.indexOf('class NativeXprReader {'),native.indexOf('// Traced records:'));
 assert.match(classDef,/G2FDiagnostics::Counts\* diagnostics = nullptr/);
 assert.match(classDef,/ReadImpl<true>/);
 assert.match(classDef,/ReadImpl<false>/);
 assert.match(classDef,/memory_order_acquire/);
 assert.match(classDef,/HasReadWatchers\(first << 12u, 4096\)/);
 assert.match(classDef,/__attribute__\(\(no_builtin\("memcpy"\)\)\)/);
 assert.match(classDef,/for \(uint32_t i = 0; i < count; \+\+i\) out\[i\] = from\[i\]/);
 assert.match(classDef,/std::memcpy\(out, reinterpret_cast<const void\*>\(address\), bytes\)/);
 const gathered=native.slice(native.indexOf('bool RenderExecutor::NativeXprGather('));
 assert.match(gathered,/NativeXprReader reader\(m_context.GetGpuResources\(\)\)/);
 assert.match(tbl,/NativeXprReader reader\(resources, g2f \? &\*g2f : nullptr\)/);
});
test('locate counters observe decisions and advisory prefetch without skipping existing reads/checks',()=>{
 const evaluator=tbl.slice(tbl.indexOf('bool RenderExecutor::TableEvaluate('),tbl.indexOf('// The image set of the words TableEvaluate made:'));
 for(const name of ['MappingProbes','MappingHits','MappingMisses','MappingFailures','BoundsRejects','LocateCalls'])
   assert.ok(evaluator.includes('G2FDiagnostics::'+name));
 assert.match(evaluator,/IsFullyMapped\(page << 14u, 16384\)/);
 assert.match(evaluator,/g2f->NotePrefetch\(line\)/);
 assert.match(evaluator,/__builtin_prefetch\(reinterpret_cast<const void\*>\(line\)\)/);
 assert.equal((evaluator.match(/g2f->BeginLevel\(\)/g)||[]).length,2);
 assert.match(evaluator,/if \(!by_operands\(st\) \|\| !indirect\(st\)\) return false/);
 assert.match(evaluator,/g2f_flush.success = true/);
});
test('full 64-bit G2-F entries persist through CPU census, with dedicated count-only UI',()=>{
 for(const key of ['000000000007ab27','000000000007ab28']){
   assert.ok(benchmark.includes(key));
   const e=parseCensusEntry('LIVE_CENSUS_ENTRY id=42 kind=12 a='+key+' b=8000000000000005 calls_per_frame=34.25 ms_per_frame=0.0000',42);
   assert.equal(e?.a,key);
   assert.equal(e?.b,'8000000000000005');
   assert.equal(e?.calls_per_frame,34.25);
   assert.equal(e?.ms_per_frame,0);
 }
 assert.match(ui,/G2-F sampled read \/ mapping paths/);
 assert.match(ui,/1-in-32 evaluations/);
 assert.match(ui,/NOT measured ms/);
});
