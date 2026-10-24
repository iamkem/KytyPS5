'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..','..');
const get=p=>fs.readFileSync(path.join(root,p),'utf8');
const lib=require('../logic.cjs');
test('Retired Engine Occlusion Culling is absent from launcher defaults and native loader',()=>{
 assert.equal(Object.hasOwn(lib.defaults,'engine_culling'),false);
 assert.equal(Object.hasOwn(lib.clean({engine_culling:'combined'}),'engine_culling'),false);
 assert.doesNotMatch(get('src/loader/gameArgs.cpp'),/EngineCullingConvars|KYTY_ENGINE_CULLING|engineCulling\.h/);
 assert.doesNotMatch(get('launcher-electron/options.html'),/Engine Occlusion Culling|engine-culling/);
 assert.doesNotMatch(get('launcher-electron/options.js'),/engine-culling|engine_culling/);
 assert.doesNotMatch(get('launcher-electron/logic.cjs'),/KYTY_ENGINE_CULLING|engine_culling/);
});
