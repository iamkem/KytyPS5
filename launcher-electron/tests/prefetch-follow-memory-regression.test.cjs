'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '../../src/graphics/host_gpu/renderer/pipeline/pipelineCache.cpp'), 'utf8');

test('low-memory prefetch does not consume followed work without executing it', () => {
  const begin = source.indexOf('bool WaitForMemory(Prefetch& p) {');
  const end = source.indexOf('bool RunGroup(Prefetch& p, Prefetch::Group& group)', begin);
  assert.ok(begin >= 0 && end > begin, 'expected live prefetch memory gate');
  const body = source.slice(begin, end);
  assert.doesNotMatch(body, /if\s*\(p\.Followed\(\)\s*!=\s*nullptr\)\s*return true/,
    'consuming probe discards a pending follow group');
  assert.match(body, /if\s*\(auto\* group\s*=\s*p\.Followed\(\)\)\s*\{\s*if\s*\(RunGroup\(p,\s*\*group\)\)/,
    'selected group must be attempted by this worker before returning');
  assert.match(body, /p\.followed\.fetch_add\(1,\s*std::memory_order_relaxed\)/,
    'successful followed work retains progress accounting');
  assert.match(body, /available == 0 \|\| available >= minimum/,
    'existing memory-pressure threshold remains unchanged');
  assert.match(body, /sleep_for\(std::chrono::milliseconds\(250\)\)/,
    'existing memory-pressure polling interval remains unchanged');
});

test('prefetch inputs are not released on sequential-slot exhaustion while follow workers may read', () => {
  const begin = source.indexOf('void PrefetchWork(uint32_t worker) {');
  const end = source.indexOf('bool WaitForMemory(Prefetch& p) {', begin);
  assert.ok(begin >= 0 && end > begin);
  const body = source.slice(begin, end);
  assert.doesNotMatch(body, /swap\(p\.inputs\.records\)|p\.inputs\.records\.clear\(\)/,
    'sequential cursor exhaustion does not mean all concurrent PrefetchTranslate readers are done');
  assert.match(source, /for \(auto& thread: threads\) thread\.join\(\)/,
    'Prefetch destructor joins all workers before input records are destructed');
  assert.match(source, /LocalShaderWarmup::Reader reader \{p\.inputs\.records\[index\]\}/,
    'regression concerns the actual asynchronous input record reader');
});
