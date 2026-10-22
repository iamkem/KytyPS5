'use strict';
const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('launcher', Object.freeze({
  load: () => ipcRenderer.invoke('launcher:load'),
  save: (settings) => ipcRenderer.invoke('launcher:save', settings),
  play: (settings) => ipcRenderer.invoke('launcher:play', settings),
  openOptions: () => ipcRenderer.invoke('launcher:options'),
  closeOptions: (commit=false) => ipcRenderer.invoke('launcher:close-options',Boolean(commit)),
  chooseGame: () => ipcRenderer.invoke('launcher:choose-game'),
  chooseStreamline: () => ipcRenderer.invoke('launcher:choose-streamline'),
  shaderUpdate: () => ipcRenderer.invoke('launcher:shader-update'),
  openDiscordDevelopers: () => ipcRenderer.invoke('launcher:discord-developers'),
  shaderStatus: () => ipcRenderer.invoke('launcher:shader-status'),
  showShaderProgress: () => ipcRenderer.invoke('launcher:shader-progress-window'),
  stopShaderUpdate: () => ipcRenderer.invoke('launcher:shader-stop'),
  openShaderLog: () => ipcRenderer.invoke('launcher:shader-log'),
  onShaderProgress: callback => ipcRenderer.on('launcher:shader-progress',(_event,state)=>callback(state)),
  exportHints: () => ipcRenderer.invoke('launcher:export-hints'),
  openLogs: () => ipcRenderer.invoke('launcher:logs'),
  quit: () => ipcRenderer.invoke('launcher:quit'),
  onGameExit: callback => ipcRenderer.on('launcher:game-exit',()=>callback()),
  listCaches: () => ipcRenderer.invoke('launcher:cache-list'),
  deleteCaches: ids => ipcRenderer.invoke('launcher:cache-delete',ids),
  deleteShaderInputs: ids => ipcRenderer.invoke('launcher:input-delete',ids),
  saveCacheVersion: () => ipcRenderer.invoke('launcher:cache-snapshot'),
  useCacheVersion: id => ipcRenderer.invoke('launcher:cache-activate',id)
}));
