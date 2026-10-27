'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const s=(f)=>fs.readFileSync(path.join(__dirname,'../..',f),'utf8');
const tbl=s('src/local/table-xpr.inc');
const hdr=s('src/local/g2i-blocks-diagnostics.h');
const benchmark=s('launcher-electron/scene-benchmark.cjs');
const panel=s('launcher-electron/benchmark.js');
const {parseCensusEntry}=require('../scene-benchmark.cjs');
const blocks=tbl.slice(tbl.indexOf('bool RenderExecutor::TableBlocks('),
 tbl.indexOf('void RenderExecutor::TablePrepareBda('));

test('G2-I sampling only during native CPU Census and one-in-64 TableBlocks invocations',()=>{
 assert.match(hdr,/SampleEvery = 64/);
 assert.match(blocks,/LiveCensus::g_on.load\(std::memory_order_relaxed\) && LiveCensus::g_render/);
 assert.match(blocks,/g2i_sequence % G2IBlocksDiagnostics::SampleEvery == 0/);
 assert.match(blocks,/else if \(!census_on\) g2i_sequence = 0/);
 assert.match(blocks,/if \(!sampled\) return/);
 assert.match(blocks,/g2i_flush.success = true/);
});
test('G2-I uses weighted counts, cycles and distinct queue tags',()=>{
 assert.match(blocks,/TableG2FAddCount\(0x7ab2a, \(i \+ 1\) \| queue, c.counts\[i\]\)/);
 assert.match(blocks,/TableG2IAddCycles\(\(i \+ 1\) \| queue, c.timed_calls\[i\], c.cycles\[i\]\)/);
 assert.match(tbl,/entry.calls \+= count/);
 assert.match(tbl,/entry.cycles \+= cycles/);
 assert.match(blocks,/G2IBlocksDiagnostics::CompletedCalls/);
});
test('G2-I preserves original buffer validation/protection and copy ordering',()=>{
 assert.match(blocks,/HasImageStartingAt\(address\)/);
 assert.match(blocks,/IsRegionCpuModified\(address, size\)/);
 assert.match(blocks,/range_clean\(held.address, held.size\)/);
 assert.match(blocks,/GetBufferIfLive\(buffer_cache.FindBuffer\(address, size\)\)/);
 assert.match(blocks,/GetBufferIfLive\(buffer_cache.FindBuffer\(address, size\)\) != owner/);
 assert.match(blocks,/buffer_cache.ObtainBuffer\(address, size, true, formatted\)/);
 assert.match(blocks,/buffer_cache.ObtainBuffer\(address, size, false, formatted\)/);
 assert.match(blocks,/textures.InvalidateMemoryFromGPU\(address, size, "storage-buffer"\)/);
 assert.match(blocks,/upload.Copy\(block.data\(\), g2i_bytes, 16\)/);
 assert.match(blocks,/plan.BlockDwords\(\) != 0/);
 assert.match(blocks,/G2IBlocksDiagnostics::ReadonlyReused/);
 assert.match(blocks,/G2IBlocksDiagnostics::ReadonlyResolves/);
});
test('no timing per descriptor / protection query; isolated two measured operations',()=>{
 assert.equal((blocks.match(/g2i\s*\?\s*__rdtsc\(\)/g)||[]).length,2);
 assert.equal((blocks.match(/g2i->AddTime\(/g)||[]).length,2);
 assert.match(blocks,/G2IBlocksDiagnostics::WritableObtain/);
 assert.match(blocks,/G2IBlocksDiagnostics::FinalUpload/);
 assert.match(hdr,/SampledCalls,\s*CompletedCalls,/);
});
test('native metric keys preserve exact 64-bit queue encoding in benchmark and distinct labels',()=>{
 for(const key of ['000000000007ab2a','000000000007ab2b']){
  assert.ok(benchmark.includes(key));
  const entry=parseCensusEntry('LIVE_CENSUS_ENTRY id=17 kind=12 a='+key+' b=8000000000000002 calls_per_frame=14.25 ms_per_frame=0.0571',17);
  assert.equal(entry?.a,key);
  assert.equal(entry?.b,'8000000000000002');
  assert.equal(entry?.calls_per_frame,14.25);
  assert.equal(entry?.ms_per_frame,0.0571);
 }
 assert.match(panel,/G2-I TableBlocks sampled breakdown/);
 assert.match(panel,/1-in-64/);
 assert.match(panel,/do not compare directly to inclusive TableBlocks/);
});
