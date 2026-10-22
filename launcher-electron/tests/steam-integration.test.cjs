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
test('Steam shortcut picks packaged launcher v8 without editing Steam or user settings',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kyty-steam-'));
 try{
  const v8=path.join(dir,'_Build','demons-souls-launcher-v8',
    'DemonsSoulsLauncher-win32-x64','DemonsSoulsLauncher.exe');
  const v7=v8.replaceAll('launcher-v8','launcher-v7');
  fs.mkdirSync(path.dirname(v8),{recursive:true});fs.writeFileSync(v8,'dummy');
  fs.mkdirSync(path.dirname(v7),{recursive:true});fs.writeFileSync(v7,'dummy');
  const expected=steamShortcut(dir);
  assert.equal(expected.available,true);
  assert.equal(expected.target,v8);
  assert.equal(expected.startIn,path.dirname(v8));
  assert.equal(expected.launchOptions,'--steam-game');
  assert.equal(expected.name,STEAM_GAME_NAME);
  assert.match(expected.limitation,/Non-Steam Game/);
  fs.rmSync(v8);
  assert.equal(steamShortcut(dir).target,v7);
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
