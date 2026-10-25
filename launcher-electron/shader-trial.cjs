'use strict';

// Read-only, inexpensive admission check for the separately precompiled 0x3 cache.
// Native Kyty remains authoritative: it verifies the GPU/driver signature and
// every pipeline binary payload at process startup.
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const CAPABILITY = 'KytyShaderFeatureTrial1 cache=_Build/shader-feature-trial/_PipelineCache features=3';
const TITLE = /^PPSA[0-9]{5}$/;
const VERSION = /^[0-9]{2}\.[0-9]{3}\.[0-9]{3}$/;
const STAMP = /^3\s+3\s+[a-f0-9]{16}$/i;

function probeExecutable(exe) {
  const result = spawnSync(exe, ['--shader-feature-trial-capabilities'], {
    windowsHide: true, encoding: 'utf8', timeout: 5000, maxBuffer: 16384
  });
  return result.status === 0 && result.stdout.trim() === CAPABILITY;
}

function inspect(root, game, executable, {probe = probeExecutable} = {}) {
  const cacheRoot = path.join(root, '_Build', 'shader-feature-trial', '_PipelineCache');
  const result = (ready, reason, extra={}) => ({ready, reason, cacheRoot, ...extra});
  try {
    if (!game || !executable) return result(false, 'Select a game and use the latest native emulator.');
    const paramPath = path.join(game, 'sce_sys', 'param.json');
    if (!fs.statSync(paramPath).isFile()) return result(false, 'Game metadata is missing.');
    const param = JSON.parse(fs.readFileSync(paramPath, 'utf8').replace(/^\uFEFF/, ''));
    const title = param.titleId, version = param.contentVersion;
    if (typeof title !== 'string' || !TITLE.test(title) ||
        typeof version !== 'string' || !VERSION.test(version) ||
        title !== 'PPSA01341' || version !== '01.007.000') {
      return result(false, "Experimental shader 0x3 is prepared only for Demon's Souls PPSA01341 v1.07.");
    }
    const gameId = title + '_' + version;
    // Prevent a linked trial root from resolving into the production cache,
    // or from making the inexpensive preflight read an unrelated directory.
    let part = path.resolve(root);
    for (const name of ['_Build', 'shader-feature-trial', '_PipelineCache', 'static']) {
      part = path.join(part, name);
      const stat = fs.lstatSync(part);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        return result(false, 'Trial cache directory contains a link or is not a directory.');
      }
    }
    const staticDir = part;
    const readyPath = path.join(staticDir, gameId + '.trial-ready');
    const stampPath = path.join(staticDir, gameId + '.features');
    const binaryPath = path.join(staticDir, gameId + '.binaries');
    if (fs.existsSync(path.join(staticDir, gameId + '.resume-required'))) {
      return result(false, 'Shader trial preparation was interrupted; it is not ready.');
    }
    for (const file of [readyPath,stampPath,binaryPath]) {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        return result(false, 'Experimental cache has missing or linked files.');
      }
    }
    if (fs.statSync(readyPath).size > 128 || fs.statSync(stampPath).size > 128 ||
        fs.readFileSync(readyPath, 'utf8').trim() !== 'KytyShaderFeatureTrial1 3' ||
        !STAMP.test(fs.readFileSync(stampPath, 'utf8').trim())) {
      return result(false, 'Shader trial readiness marker or translation stamp is invalid.');
    }
    const bytes = fs.statSync(binaryPath).size;
    if (bytes < 4096) return result(false, 'Experimental pipeline binaries are missing or incomplete.');
    if (!fs.existsSync(executable) || !probe(executable)) {
      return result(false, 'Latest Release emulator does not support the isolated shader 0x3 trial.');
    }
    return result(true, 'Experimental 0x3 cache found; native integrity verification runs when Play starts.', {
      gameId, bytes
    });
  } catch (error) {
    if (['ENOENT','ENOTDIR'].includes(error.code)) {
      return result(false, 'Experimental 0x3 cache not found. Keep Standard or prepare a separate trial cache.');
    }
    return result(false, 'Cannot verify experimental cache: ' + error.message);
  }
}

module.exports = {inspect, probeExecutable, CAPABILITY};
