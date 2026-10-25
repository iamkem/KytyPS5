'use strict';

// CPU/file-system-only tests for the opt-in 0x3 shader feature trial.
// Do not invoke emulator gameplay or shader compilation.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const root = path.resolve(__dirname, '..', '..');
const source = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('normal and trial cache roots are separate, including production recordings', () => {
  const helper = source('src/local/shader-feature-trial.h');
  const pipeline = source('src/graphics/host_gpu/renderer/pipeline/pipelineCache.cpp');
  const apr = source('src/libs/libAmpr.cpp');
  assert.match(helper, /std::string_view\(value\) == "1"/);
  assert.match(helper, /"shader-feature-trial"\s*\/\s*"_PipelineCache"/);
  assert.ok((pipeline.match(/ShaderFeatureTrial::CacheRoot\(\)/g) || []).length >= 8);
  assert.match(apr, /ShaderFeatureTrial::CacheRoot\(\)\s*\/\s*"files"/);
});

test('runtime requires completed 0x3 sidecar; scripts refuse unsafe modes', () => {
  const pipeline = source('src/graphics/host_gpu/renderer/pipeline/pipelineCache.cpp');
  const precompile = source('precompile-windows.ps1');
  const runner = source('run-windows.ps1');
  assert.match(pipeline, /ReadStaticFeatures\(\) != TrialFeatures/);
  assert.match(pipeline, /marker != "KytyShaderFeatureTrial1 3"/);
  assert.match(pipeline, /validated_store->VerifyAllData\(\)/);
  assert.match(pipeline, /KYTY_BUILD != KYTY_BUILD_RELEASE/);
  assert.match(source('src/graphics/host_gpu/renderer/pipeline/pipelineBinaries.cpp'), /XXH3_64bits_update\(state\.get\(\)/);
  assert.match(source('src/main.cpp'), /#if KYTY_BUILD == KYTY_BUILD_RELEASE/);
  assert.match(source('src/local/shader-precompile.cpp'), /#if KYTY_BUILD == KYTY_BUILD_RELEASE/);
  assert.match(precompile, /\[switch\]\$ShaderFeatureTrial/);
  assert.match(precompile, /\[switch\]\$TrialCheck/);
  assert.match(precompile, /if \(\$Incremental -or \$Quick/);
  assert.match(precompile, /\$cacheRoot = Join-Path \$PSScriptRoot '_Build\\shader-feature-trial\\_PipelineCache'/);
  assert.match(runner, /if \(\$remember -and !\$ShaderFeatureTrial\)/);
  assert.match(runner, /\$environment\['KYTY_SHADER_FEATURE_TRIAL'\] = '1'/);
});

test('trial preflight writes nothing and does not invoke the native tool', {skip: process.platform !== 'win32'}, () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'kyty-trial-policy-'));
  try {
    const game = path.join(fixture, 'game');
    const seed = path.join(fixture, 'seeds.seeds');
    fs.mkdirSync(game);
    fs.writeFileSync(seed, 'read-only fixture');
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(root, 'precompile-windows.ps1'), '-ShaderFeatureTrial', '-TrialCheck', '-Full',
      '-Game', game, '-Seeds', seed];
    const result = spawnSync('powershell.exe', args, {cwd: root, encoding: 'utf8', timeout: 12000});
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.match(result.stdout, /No files or environment changed/);
    assert.deepEqual(fs.readdirSync(fixture).sort(), ['game', 'seeds.seeds']);
    const refusal = spawnSync('powershell.exe',
      args.filter((value) => value !== '-Full').concat(['-Quick']),
      {cwd: root, encoding: 'utf8', timeout: 12000});
    assert.notEqual(refusal.status, 0, 'unsafe trial precompile option must be refused');
    assert.deepEqual(fs.readdirSync(fixture).sort(), ['game', 'seeds.seeds']);
    // The runner must reject a trial flag hidden inside a comma-separated -Set,
    // before even reading game data or creating any cache/log files.
    const bypass = spawnSync('powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
        path.join(root, 'run-windows.ps1'), '-Set',
        'FOO=1,KYTY_SHADER_FEATURE_TRIAL=1', '-DryRun'],
      {cwd: root, encoding: 'utf8', timeout: 12000});
    assert.notEqual(bypass.status, 0);
    assert.match(bypass.stderr + bypass.stdout, /Use -ShaderFeatureTrial explicitly/);
    assert.deepEqual(fs.readdirSync(fixture).sort(), ['game', 'seeds.seeds']);
  } finally {
    fs.rmSync(fixture, {recursive: true, force: true});
  }
});
