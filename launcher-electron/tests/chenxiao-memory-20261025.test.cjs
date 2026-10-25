'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..', '..');
const source = (name) => fs.readFileSync(path.join(root, name), 'utf8');

// Source-contract tests only: never start game, precompile shaders, or discard mapped memory.
test('20261025 A: file handles are released after an idle read and retain active readers', () => {
  const platform = source('src/local/local-platform.cpp');
  const ampr = source('src/libs/libAmpr.cpp');
  assert.match(platform, /KYTY_FILE_IDLE_CLOSE/);
  assert.match(platform, /uint64_t\s*\{10000\}/, 'default read idle timeout remains 10 seconds');
  assert.match(platform, /KeptFileCloser\(/);
  assert.match(platform, /DoneKeptReadFile\(/);
  assert.match(ampr, /DoneKeptReadFile\(/);
});

test('20261025 A: direct-memory cap applies to supported Demons Souls only', () => {
  const memory = source('src/kernel/memory.cpp');
  assert.match(memory, /static uint64_t ReportedDirectMemorySize\(\)/);
  assert.match(memory, /constexpr uint64_t Base = uint64_t\s*\{12\}\s*<<\s*30u/);
  assert.match(memory, /DemonsSouls::IsSupportedGame\(\)\s*\?\s*Base/);
  assert.match(memory, /KYTY_DIRECT_MEMORY_MB/);
  assert.match(memory, /return mib << 20u/);
});

test('20261025 A: a freshly created pipeline store stamps its translation features', () => {
  const precompile = source('src/graphics/host_gpu/renderer/pipeline/staticPrecompile.inc');
  assert.match(precompile, /const bool\s+fresh\s*=\s*!std::filesystem::exists\(active, exists_error\)/);
  assert.match(precompile, /if \(merged && \(prune \|\| stamp \|\| fresh\)\)/);
  assert.match(precompile, /WriteStaticFeatures\(prune \|\| fresh\)/);
});

test('20261025 B: engine free giveback is opt-in, blocked for file-backed memory', () => {
  const engine = source('src/loader/demonsSoulsPageFree.cpp');
  const kernelHeader = source('src/kernel/memory.h');
  const kernel = source('src/kernel/memory.cpp');
  const addressSpace = source('src/kernel/memoryAddressSpace.inc');
  assert.match(engine, /KYTY_ENGINE_FREE/);
  assert.match(engine, /DropHotReadsBacking\(/);
  assert.match(kernelHeader, /void DropHotReadsBacking\(uint64_t backing, uint64_t size\)/);
  assert.match(kernel, /g_guest_address_space->DropHotBacking\(backing, size\)/);
  assert.match(addressSpace, /void DropHotBacking\(uint64_t backing, uint64_t size\)/);
  assert.match(addressSpace, /UnlockHotBacking\(it->second.backing\)/);
  assert.match(engine, /text == "giveback" \|\| text == "1"/);
  assert.match(engine, /const char\* backing = std::getenv\("KYTY_BACKING_FILE"\)/);
  assert.match(engine, /if \(file_backed\)\s*\{[^}]*return Mode::Off/s);
  const gate = engine.slice(engine.indexOf('Mode GetMode()'), engine.indexOf('uint64_t cave'));
  assert.match(gate, /return Mode::Off;\s*\}\(\)/, 'unknown/default mode must stay off');
  assert.doesNotMatch(gate, /PhysicalMemory\(/, 'RAM threshold must not silently enable discard');
});

test('20261025: texture offload remains default-off with sparse backing protection', () => {
  const offload = source('src/local/texture-offload.h');
  assert.match(offload, /wants_offload = offload != nullptr && offload\[0\] == '1'/);
  assert.match(offload, /file_backing/);
  assert.match(offload, /Texture offload: BLOCKED on file-backed guest mapping/);
});
