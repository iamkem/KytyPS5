'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {STEAM_GAME_ARG,STEAM_GAME_NAME,isSteamGameMode,steamShortcut}=require('../steam-integration.cjs');
test('Steam integration is opt-in and never starts gameplay in UI smoke mode',()=>{
 assert.equal(isSteamGameMode(['launcher.exe']),false);
 assert.equal(isSteamGameMode(['launcher.exe',STEAM_GAME_ARG]),true);
 assert.equal(isSteamGameMode(['launcher.exe',STEAM_GAME_ARG,'--smoke-ui']),false);
 assert.equal(isSteamGameMode(['launcher.exe','--steam-game-extra']),false);
});
test('Steam shortcut references only latest packaged launcher',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kyty-steam-'));
 try{
  const target=path.join(dir,'_Build','latest','launcher','DemonsSoulsLauncher-win32-x64','DemonsSoulsLauncher.exe');
  assert.equal(steamShortcut(dir).available,false);
  assert.equal(steamShortcut(dir).target,target);
  fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,'dummy');
  const expected=steamShortcut(dir);
  assert.equal(expected.available,true);
  assert.equal(expected.target,target);
  assert.equal(expected.startIn,path.dirname(target));
  assert.equal(expected.launchOptions,'--steam-game');
  assert.equal(expected.name,STEAM_GAME_NAME);
  assert.match(expected.limitation,/Non-Steam Game/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('Steam setup surface is separate from JSON-only Discord integration',()=>{
 const root=path.join(__dirname,'..');
 const html=fs.readFileSync(path.join(root,'options.html'),'utf8');
 const preload=fs.readFileSync(path.join(root,'preload.cjs'),'utf8');
 const main=fs.readFileSync(path.join(root,'main.cjs'),'utf8');
 assert.match(html,/id="steam-setup"/);
 assert.match(html,/id="steam-hint"/);
 assert.match(preload,/launcher:steam-setup/);
 assert.match(main,/steamGameMode/);
 assert.match(main,/startGame\(currentSettings\(\),\{steam:true\}\)/);
 assert.doesNotMatch(html,/data-tab="discord"/);
 assert.doesNotMatch(main,/SteamAPI_Init|steam_appid\.txt|shortcuts\.vdf/);
});
