'use strict';
// Steam supports manually added Non-Steam Games as shortcuts; this is NOT Steamworks
// Rich Presence and must not impersonate a Steam App ID.
// We never edit Steam's userdata/shortcuts.vdf or inject into Steam processes.
const fs=require('node:fs');
const path=require('node:path');
const STEAM_GAME_ARG='--steam-game';
const STEAM_GAME_NAME="Demon's Souls Remake PC (KytyPS5)";
function isSteamGameMode(argv=[]){
 return Array.isArray(argv)&&argv.includes(STEAM_GAME_ARG)&&!argv.includes('--smoke-ui');
}
function steamShortcut(root,exists=fs.existsSync){
 const launchers=['v10','v9','v8','v7','v6'].map(version=>path.join(root,'_Build',
   'demons-souls-launcher-'+version,'DemonsSoulsLauncher-win32-x64','DemonsSoulsLauncher.exe'));
 const target=launchers.find(exists);
 return {
   name:STEAM_GAME_NAME,
   target:target||launchers[0],
   startIn:path.dirname(target||launchers[0]),
   launchOptions:STEAM_GAME_ARG,
   available:Boolean(target),
   limitation:'Steam displays a Non-Steam Game while the Steam-launched launcher process remains running. Custom Steamworks Rich Presence, achievements and guaranteed overlay are not available.'
 };
}
module.exports={STEAM_GAME_ARG,STEAM_GAME_NAME,isSteamGameMode,steamShortcut};
