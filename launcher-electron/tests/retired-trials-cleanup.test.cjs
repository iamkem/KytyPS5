'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..','..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const launch=require('../logic.cjs');

test('retired G2 trials cannot survive launcher settings migration',()=>{
 for(const legacy of [true,false,1,'true',null]){
  const cleaned=launch.clean({
   table_readonly_trial:legacy,
   table_prefetch_trial:legacy,
   table_unbounded_trial:legacy,
   shader_mode:'standard',
   scene_benchmark:true
  });
  for(const key of ['table_readonly_trial','table_prefetch_trial','table_unbounded_trial'])
   assert.equal(Object.hasOwn(cleaned,key),false,key);
  assert.equal(cleaned.shader_mode,'standard');
  assert.equal(cleaned.scene_benchmark,true);
 }
});

test('retired controls and native switches are absent, benchmark retained',()=>{
 const options=read('launcher-electron/options.html');
 const logic=read('launcher-electron/logic.cjs');
 const native=read('src/local/native-xpr.inc');
 const switches=read('src/local/performance-switches.h');
 const table=read('src/local/table-xpr.inc');
 for(const term of ['table-readonly-trial','table-prefetch-trial','table-unbounded-trial'])
  assert.equal(options.includes(term),false,'UI '+term);
 for(const term of ['KYTY_TABLE_READONLY_PASS_SKIP','KYTY_TABLE_PREFETCH_DEDUPE','KYTY_TABLE_UNBOUNDED_LEVELS']){
  assert.equal(logic.includes(term),false,'launcher '+term);
  assert.equal(switches.includes(term),false,'runtime '+term);
 }
 for(const term of ['TableReadOnlyPass','TablePrefetchDedupe','TableUnboundedLevels','G2FDiagnostics','G2IBlocksDiagnostics'])
  assert.equal(table.includes(term)||native.includes(term),false,'native '+term);
 assert.match(options,/id="scene-benchmark"/);
 assert.match(logic,/DisableLiveControl/);
});

test('TableBlocks preserves writable-first pass, guest protections, upload, fallback',()=>{
 const table=read('src/local/table-xpr.inc');
 const blocks=table.split('bool RenderExecutor::TableBlocks(')[1].split('void RenderExecutor::TablePrepareBda(')[0];
 const draw=table.split('RenderExecutor::TableResult RenderExecutor::TableDraw(')[1].split('void RenderExecutor::TableRuns(')[0];
 assert.match(blocks,/for \(size_t n = 0; n < 2 \* buffers; \+\+n\)/);
 assert.match(blocks,/\(resource\.written \|\| resource\.atomic\) != \(n < plan\.buffers\.size\(\)\)/);
 assert.match(blocks,/ObtainBuffer\(address, size, true, formatted\)/);
 assert.match(blocks,/GetBufferIfLive\(buffer_cache\.FindBuffer\(address, size\)\)/);
 assert.match(blocks,/buffer_cache\.IsRegionGpuModified\(held\.address, held\.size\)/);
 assert.match(blocks,/upload\.Copy\(block\.data\(\), block_bytes, 16\)/);
 assert.match(draw,/if \(!TableEvaluate\(pair, user_data\)\)/);
 assert.match(draw,/if \(!TableBlocks\(pair, user_data, blocks, &writes\)\)/);
 assert.match(draw,/TablePrepareBda\(pair, user_data\)/);
});

test('NativeXpr reader keeps acquire-and-watch semantics',()=>{
 const text=read('src/local/native-xpr.inc');
 const reader=text.split('class NativeXprReader {')[1].split('// Traced records:')[0];
 assert.match(reader,/memory_order_acquire/);
 assert.match(reader,/HasReadWatchers/);
 assert.match(reader,/NativeXprReadWords\(address, count, out\)/);
 assert.match(reader,/std::memcpy/);
 assert.match(text,/TryReadGpuShaderSpan/);
});
