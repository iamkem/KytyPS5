'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const launcher = require('../logic.cjs');
const project = path.resolve(__dirname, '..', '..');

// Fixture-only: generate Play argument specifications; never launch the emulator.
test('RAM Safety preserves shader/backing protection without enabling driver-pipeline policy', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kyty-ram-safety-test-'));
  try {
    const game = path.join(root, 'fake-game');
    const native = path.join(root, '_Build', 'latest', 'native-build');
    fs.mkdirSync(game, { recursive: true });
    fs.mkdirSync(native, { recursive: true });
    fs.writeFileSync(path.join(game, 'eboot.bin'), 'test fixture only');
    fs.writeFileSync(path.join(native, 'kyty_emulator.exe'), 'test fixture only');
    const flagsFor = (ram_safety, ram_diet) => {
      const s = launcher.clean({ ...launcher.defaults, game, ram_safety, ram_diet,
        ram16_backing: true, upscaler: '', framegen: 0 });
      const spec = launcher.buildPlayArgs(root, s);
      return spec.args[spec.args.indexOf('-Set') + 1].split(',');
    };
    const on = flagsFor(true, true);
    const off = flagsFor(false, true);
    for (const flags of [on, off]) {
      assert.ok(flags.includes('KYTY_RAM_DIET=1'));
      assert.ok(flags.includes('KYTY_BACKING_FILE=1'));
      assert.ok(flags.includes('KYTY_BACKING_ON_DEMAND=1'));
      assert.ok(flags.includes('KYTY_TEXTURE_OFFLOAD=0'));
      assert.ok(flags.includes('KYTY_TEXTURE_OFFLOAD_PROBE=0'));
    }
    for (const flag of ['KYTY_ADAPTIVE_RAM=1', 'KYTY_PREFETCH_MIN_AVAIL_MB=4096',
      'KYTY_SHADER_PREFETCH_THREADS=1', 'KYTY_SHADER_FOLLOW_THREADS=1']) {
      assert.ok(on.includes(flag), `${flag} enabled with RAM Safety`);
      assert.ok(!off.includes(flag), `${flag} absent with RAM Safety off`);
    }
    const independent = flagsFor(true, false);
    assert.ok(independent.includes('KYTY_ADAPTIVE_RAM=1'));
    assert.ok(!independent.includes('KYTY_RAM_DIET=1'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Native pipeline policy has no Stutter Guard hooks; adaptive texture/backing stay', () => {
  const pipeline = fs.readFileSync(path.join(project, 'src/graphics/host_gpu/renderer/pipeline/pipelineCache.cpp'), 'utf8');
  const header = fs.readFileSync(path.join(project, 'src/graphics/host_gpu/renderer/pipeline/pipelineCache.h'), 'utf8');
  const pressure = fs.readFileSync(path.join(project, 'src/local/memory-pressure.h'), 'utf8');
  const texture = fs.readFileSync(path.join(project, 'src/graphics/host_gpu/renderer/cache/textureCache.cpp'), 'utf8');
  const backing = fs.readFileSync(path.join(project, 'src/kernel/memoryAddressSpace.inc'), 'utf8');
  assert.doesNotMatch(pipeline, /MemoryPressure::(?:Next|Pipelines)|last_remade_at|adaptive_policy|ram_pressure/);
  const remainingAdaptiveGates = pipeline.match(/MemoryPressure::Enabled\(\)/g) || [];
  assert.equal(remainingAdaptiveGates.length, 1, 'only the proven scene-sweep anti-regression gate remains');
  assert.match(pipeline, /const bool scene_left = !MemoryPressure::Enabled\(\)/);
  assert.doesNotMatch(pipeline, /\bAdaptive pipelines:|const bool emergency\s*=/);
  assert.doesNotMatch(header, /last_remade_at/);
  assert.doesNotMatch(pressure, /(?:struct PipelinePolicy|constexpr PipelinePolicy Pipelines)/);
  assert.match(pipeline, /RamDietEnabled\(\)/);
  assert.match(pipeline, /const auto idle_horizon = settings\.idle;/);
  assert.match(pipeline, /const size_t max_evictions = MaxEvictions;/);
  assert.ok(pipeline.includes('!(evict != nullptr && std::string_view(evict) == "0")'),
    'explicit KYTY_PIPELINE_EVICT=0 still disables forced RAM Diet evictions');
  assert.match(pipeline, /for \(auto& \[key, pipeline\]: m_graphics_pipelines\) \{\s*if \(evicted == max_evictions\) break;/);
  assert.match(pipeline, /if \(evicted < max_evictions\) \{\s*for \(auto& \[id, pipeline\]: m_compute_pipelines\)/);
  assert.match(texture, /MemoryPressure::Images\(/);
  assert.match(backing, /MemoryPressure::PreferTemporaryBacking\(MemoryPressure::Enabled\(\)\)/);
});
