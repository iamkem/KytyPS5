'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=relative=>fs.readFileSync(path.join(__dirname,'..','..',relative),'utf8');

test('upstream Anti-Lag guard disables extra pacing under frame generation',()=>{
 const code=src('src/local/anti-lag.cpp');
 const wanted=code.split('bool Requested() {')[1].split('void Initialize')[0];
 assert.match(wanted,/KYTY_FRAMEGEN/);
 assert.match(wanted,/wanted && framegen != nullptr && std::atoi\(framegen\) != 0/);
 assert.match(wanted,/return false;/);
 assert.match(wanted,/return wanted;/);
});

test('upstream Direct Present guard retains ordinary path but excludes FG',()=>{
 const code=src('src/graphics/presentation/window/swapchain.cpp');
 const direct=code.split('static bool PresentDirect() {')[1].split('return on;')[0];
 assert.match(direct,/KYTY_PRESENT_DIRECT/);
 assert.match(direct,/KYTY_FRAMEGEN/);
 assert.match(direct,/if \(value == nullptr \|\| value\[0\] != '1'\) return false/);
 assert.match(direct,/if \(const char\* framegen/);
 assert.match(direct,/return false;/);
 assert.match(direct,/return true;/);
});
