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
 const target=path.join(root,'_Build','latest','launcher','DemonsSoulsLauncher-win32-x64','DemonsSoulsLauncher.exe');
 return {
   name:STEAM_GAME_NAME, target, startIn:path.dirname(target),
   launchOptions:STEAM_GAME_ARG, available:Boolean(exists(target)),
   limitation:'Steam displays a Non-Steam Game while the Steam-launched launcher process remains running. Custom Steamworks Rich Presence, achievements and guaranteed overlay are not available.'
 };
}
module.exports={STEAM_GAME_ARG,STEAM_GAME_NAME,isSteamGameMode,steamShortcut};
