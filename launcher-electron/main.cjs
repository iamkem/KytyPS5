'use strict';
const {app,BrowserWindow,ipcMain,dialog,screen,net,protocol,shell,clipboard} = require('electron');
const {pathToFileURL} = require('node:url');
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const logic = require('./logic.cjs');
const cache = require('./cache.cjs');
const versions=require('./cache-generations.cjs');
const {ShaderProgress}=require('./shader-progress.cjs');
const shaderInputs=require('./shader-inputs.cjs');
const shaderTrial=require('./shader-trial.cjs');
const sceneBenchmark=require('./scene-benchmark.cjs');
const {ModManager}=require('./mod-manager.cjs');
const {DiscordPresence,isConfigured,validConfig,readGamePid}=require('./discord-presence.cjs');
const {isSteamGameMode,steamShortcut}=require('./steam-integration.cjs');
const steamGameMode=isSteamGameMode(process.argv);
protocol.registerSchemesAsPrivileged([{scheme:'kytyart',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);

function locateProject(start){
  let dir=start;
  for(let i=0;i<7;i++){
    if(fs.existsSync(path.join(dir,'run-windows.ps1')) && fs.existsSync(path.join(dir,'precompile-windows.ps1')))return dir;
    const parent=path.dirname(dir);if(parent===dir)break;dir=parent;
  }
  throw Error('Cannot find KytyPS5 installation next to the launcher.');
}
const ROOT=process.env.KYTY_PROJECT_ROOT || locateProject(app.isPackaged?path.dirname(process.execPath):path.resolve(__dirname,'..'));
let mainWindow=null,optionsWindow=null,progressWindow=null,benchmarkWindow=null,benchmarkSession=null,gameProcess=null,optionsSnapshot=null,optionsCommitted=false;
let idlePresence=null,discordResumeTimer=null,discordClosing=false;
const discordLogFile=path.join(ROOT,'_Build','run-logs','discord-presence.log');
function discordLog(event,detail=''){
  try{
    fs.mkdirSync(path.dirname(discordLogFile),{recursive:true});
    fs.appendFileSync(discordLogFile,new Date().toISOString()+' '+event+' '+String(detail).slice(0,280)+'\n');
  }catch{}
}
function stopIdlePresence(){
  if(discordResumeTimer){clearTimeout(discordResumeTimer);discordResumeTimer=null;}
  if(idlePresence){
    idlePresence.stop();idlePresence=null;
    discordLog('LAUNCHER_PRESENCE_STOP');
  }
}
function startIdlePresence(){
  if(discordClosing||gameProcess||idlePresence||process.argv.includes('--smoke-ui'))return;
  const config=logic.loadSettings(ROOT);
  if(!isConfigured(config)){
    if(config.discord_presence)discordLog('CONFIG_INVALID','Check discord_app_id / discord_large_image');
    return;
  }
  const cfg=validConfig(config);
  idlePresence=new DiscordPresence({appId:cfg.appId,image:cfg.image,mode:'launcher'});
  idlePresence.on('published',()=>discordLog('LAUNCHER_PRESENCE_PUBLISHED','Discord acknowledged SET_ACTIVITY'));
  idlePresence.on('rejected',message=>discordLog('LAUNCHER_PRESENCE_REJECTED',message));
  idlePresence.on('retrying',message=>discordLog('LAUNCHER_PRESENCE_RETRY',message));
  idlePresence.start();
  discordLog('LAUNCHER_PRESENCE_CONNECTING');
}
function resumeIdlePresence(){
  if(discordClosing)return;
  stopIdlePresence();
  // Allow game helper to clear its own status and exit before publishing idle activity.
  discordResumeTimer=setTimeout(()=>{
    discordResumeTimer=null;
    if(!gameProcess)startIdlePresence();
  },2800);
}
// Do not share Chromium disk cache with an older launcher version that may be open.
const stableProfile=path.join(app.getPath('appData'),'KytyPS5-ElectronLauncher');
fs.mkdirSync(stableProfile,{recursive:true});
app.setPath('userData',stableProfile);
if (process.argv.includes('--smoke-ui')) {
  // Isolate Chromium disk cache and player config when multiple launchers are inspected.
  const temp=require('node:os').tmpdir();
  const profile=path.join(temp,'kyty-electron-profile-'+process.pid);
  fs.mkdirSync(profile,{recursive:true});
  app.setPath('userData',profile);
  process.on('exit',()=>{try{fs.rmSync(profile,{recursive:true,force:true});}catch{}});
  const scratch=path.join(temp,'kyty-electron-smoke-'+process.pid+'.json');
  const real=path.join(ROOT,'launcher-settings.json');
  if (fs.existsSync(real)) fs.copyFileSync(real,scratch);
  else fs.writeFileSync(scratch,JSON.stringify(logic.defaults));
  process.env.KYTY_LAUNCHER_SMOKE_CONFIG=scratch;
  process.on('exit',()=>{try{fs.unlinkSync(scratch);}catch{}});
}
// Only one Launcher instance may own this installation's settings/menu at once.
// A separate native/precompile process is also checked immediately before Play.
if(!app.requestSingleInstanceLock())app.exit(0);
app.on('second-instance',()=>{if(mainWindow&&!mainWindow.isDestroyed()){mainWindow.show();mainWindow.focus();}});
function createWindow() {
  mainWindow = new BrowserWindow({
    width:728,height:458,useContentSize:true,resizable:false,maximizable:false,show:!steamGameMode,
    backgroundColor:'#f8f7f4',title:"Demon's Souls",autoHideMenuBar:true,
    icon:path.join(__dirname,'assets','game.ico'),
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}
  });
  mainWindow.loadFile(path.join(__dirname,'index.html'));
  mainWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  mainWindow.webContents.on('will-navigate',(evt)=>evt.preventDefault());
  mainWindow.on('closed',()=>{mainWindow=null;if(optionsWindow)optionsWindow.close();});
}
const shaderProgress=new ShaderProgress(ROOT);
const mods=new ModManager(ROOT);
let modBusy=false;
function currentSettings(){return logic.loadSettings(ROOT);}
function openProgressWindow(){
  if(progressWindow&&!progressWindow.isDestroyed()){progressWindow.show();progressWindow.focus();return;}
  progressWindow=new BrowserWindow({
    width:755,height:520,useContentSize:true,minWidth:660,minHeight:430,
    backgroundColor:'#fbfaf9',title:'Shader Update — KytyPS5',autoHideMenuBar:true,
    icon:path.join(__dirname,'assets','game.ico'),
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}
  });
  progressWindow.loadFile(path.join(__dirname,'progress.html'));
  progressWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  progressWindow.webContents.on('will-navigate',e=>e.preventDefault());
  progressWindow.on('closed',()=>{progressWindow=null;});
}
shaderProgress.on('update',state=>{
  for(const win of [mainWindow,optionsWindow,progressWindow]){
    if(win&&!win.isDestroyed())win.webContents.send('launcher:shader-progress',state);
  }
});
function openOptions() {
  if (optionsWindow) {optionsWindow.focus();return;}
  optionsSnapshot=currentSettings();
  optionsCommitted=false;
  optionsWindow = new BrowserWindow({
    width:760,height:562,useContentSize:true,resizable:false,maximizable:false,
    parent:mainWindow,modal:true,show:false,backgroundColor:'#fbfbfa',
    autoHideMenuBar:true,title:"Demon's Souls - Setup",
    icon:path.join(__dirname,'assets','game.ico'),
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}
  });
  optionsWindow.loadFile(path.join(__dirname,'options.html'));
  optionsWindow.once('ready-to-show',()=>optionsWindow?.show());
  optionsWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  optionsWindow.webContents.on('will-navigate',(evt)=>evt.preventDefault());
  optionsWindow.on('closed',()=>{
    if (!optionsCommitted && optionsSnapshot) logic.saveSettings(ROOT,optionsSnapshot);
    optionsWindow=null;optionsSnapshot=null;
    mainWindow?.webContents.send('launcher:settings-changed',currentSettings());
  });
}
function benchmarkInfo(){
  const s=benchmarkSession;
  return {enabled:!!s,mode:s?.mode||'',ready:!!s?.ready&&!!s?.running,
    active:!!s?.running,probing:!!s?.probing,probeFailed:!!s?.probeFailed,capturing:!!s?.capturing,
    capturingKind:s?.capturingKind||null,
    logPath:s?.logPath||'',folder:s?.folder||'',results:s?.results||[],censusResults:s?.censusResults||[]};
}
function sendBenchmarkInfo(){
  if(benchmarkWindow&&!benchmarkWindow.isDestroyed())
    benchmarkWindow.webContents.send('launcher:benchmark-status',benchmarkInfo());
}
function openBenchmarkWindow(){
  if(benchmarkWindow&&!benchmarkWindow.isDestroyed()){
    benchmarkWindow.show();benchmarkWindow.focus();return;
  }
  benchmarkWindow=new BrowserWindow({
    width:492,height:440,minWidth:430,minHeight:370,resizable:true,show:false,
    backgroundColor:'#faf9f7',title:'Scene Benchmark — KytyPS5',autoHideMenuBar:true,
    icon:path.join(__dirname,'assets','game.ico'),
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}
  });
  benchmarkWindow.loadFile(path.join(__dirname,'benchmark.html'));
  benchmarkWindow.once('ready-to-show',()=>benchmarkWindow?.show());
  benchmarkWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  benchmarkWindow.webContents.on('will-navigate',e=>e.preventDefault());
  benchmarkWindow.on('close',event=>{
    if(benchmarkSession?.running){event.preventDefault();benchmarkWindow.minimize();}
  });
  benchmarkWindow.on('closed',()=>{benchmarkWindow=null;});
}
function startDiscordAgent(settings,gamePid){
  if(!isConfigured(settings)||!gamePid||process.argv.includes('--smoke-ui'))return false;
  const presence=validConfig(settings);
  // Use the installed Electron executable as a plain Node process to avoid a second Chromium instance.
  // Detached/unref + an independent supervisor PID lets the helper survive the launcher's Quit action.
  try{
    const child=spawn(process.execPath,[
      path.join(__dirname,'discord-agent.cjs'),
      '--watch-pid',String(gamePid),
      '--app-id',presence.appId,
      '--image',presence.image
    ],{cwd:ROOT,detached:true,windowsHide:true,stdio:'ignore',
      env:{...process.env,ELECTRON_RUN_AS_NODE:'1',KYTY_DISCORD_LOG_FILE:discordLogFile}});
    child.on('error',error=>{discordLog('GAME_HELPER_ERROR',error.message);console.warn('Discord Presence helper failed to launch:',error.message);});
    discordLog('GAME_HELPER_STARTED','Emulator PID '+gamePid+' / helper PID '+child.pid);
    child.unref();
    return true;
  }catch(error){
    discordLog('GAME_HELPER_UNAVAILABLE',error.message);
    console.warn('Discord Presence unavailable:',error.message);
    return false;
  }
}
function launchCommand(spec,{restore=false,visible=false,onGamePid=null,onGameLog=null,env=null,silentError=false,shaderMode='standard'}={}) {
  const child=spawn(spec.command,spec.args,{cwd:ROOT,windowsHide:!visible,
    env:env||process.env,stdio:onGamePid||onGameLog?['ignore','pipe','pipe']:'ignore'});
  if(onGamePid||onGameLog){
    let partial='',recognized=false,logBound=false;
    child.stdout.on('data',data=>{
      // Always drain stdout, even once metadata has been found, so that
      // a quiet UI does not block the -Follow PowerShell runner.
      if((recognized||!onGamePid)&&(logBound||!onGameLog))return;
      const lines=(partial+data.toString('utf8')).split(/\r?\n/);
      partial=lines.pop().slice(-4096);
      for(const line of lines){
        if(onGameLog&&!logBound&&onGameLog(line)===true)logBound=true;
        if(onGamePid&&!recognized){
          const pid=readGamePid(line);
          if(pid){recognized=true;onGamePid(pid);}
        }
      }
    });
    child.stderr.on('data',()=>{});
  }
  child.on('error',err=>{
    if(benchmarkSession){sceneBenchmark.end(benchmarkSession);sendBenchmarkInfo();}
    gameProcess=null;discordLog('GAME_START_ERROR',err.message);
    if(!silentError){
      resumeIdlePresence();mainWindow?.show();mainWindow?.webContents.send('launcher:game-exit');
      dialog.showErrorBox('Unable to start KytyPS5',err.message);
    }
  });
  child.on('exit',code=>{if (restore&&mainWindow) {mainWindow.show();mainWindow.focus();mainWindow.webContents.send('launcher:game-exit',{exitCode:code,shaderMode});}});
  child.unref();
  return child;
}
app.whenReady().then(()=>{
  protocol.handle('kytyart', async(request)=>{
    const raw = new URL(request.url);
    const filename = raw.pathname.includes('icon') ? 'icon0.png' : 'pic0.png';
    const file = logic.gameImagePath(currentSettings(),filename);
    if (!file) return new Response('Not found',{status:404});
    return new Response(fs.readFileSync(file), {status:200,headers:{'content-type':'image/png','cache-control':'no-cache'}});
  });
  ipcMain.handle('launcher:load',()=>{
    const settings=currentSettings();
    return {settings,valid:logic.gameValid(settings),executable:logic.findEmulator(ROOT),sdk:logic.findStreamline(settings,ROOT),
      displays:screen.getAllDisplays().map((d,i)=>({id:String(i),label:i===0?'Primary monitor':'Monitor '+(i+1),width:d.size.width,height:d.size.height}))};
  });
  ipcMain.handle('launcher:save',(_event,data)=>logic.saveSettings(ROOT,data));
  ipcMain.handle('launcher:shader-trial-status',(_event,game)=>
    shaderTrial.inspect(ROOT,typeof game==='string'?game:currentSettings().game,logic.findEmulator(ROOT)));
  ipcMain.handle('launcher:options',()=>{openOptions();return true;});
  ipcMain.handle('launcher:close-options',(_event,commit=false)=>{optionsCommitted=Boolean(commit);optionsWindow?.close();return true;});
  const startGame=(data,{steam=false}={})=>{
    if(cacheBusy||modBusy)throw Error('File management is in progress. Finish it before launching the game.');
    ensureCacheIdle(); // Best-effort external emulator/precompile detection before every Play, including Steam.
    if(mods.status(logic.clean(data).game).needsRepair)throw Error('Repair unfinished mod changes before starting the game.');
    if(['running','stopping'].includes(shaderProgress.snapshot().status))throw Error('Shader update is still running. Finish it before playing.');
    if (gameProcess) throw Error('KytyPS5 is already running.');
    let cfg=logic.clean(data);
    let spec;
    try {
      spec=logic.buildPlayArgs(ROOT,cfg);
    } catch(error) {
      if(error.code!=='SHADER_TRIAL_NOT_READY'||steam)throw error;
      const answer=dialog.showMessageBoxSync(mainWindow,{
        type:'warning',title:'Experimental shader 0x3 not ready',
        message:'The Experimental shader cache cannot be used safely.',
        detail:error.message+'\n\nSwitch back to Standard (0x0) and play with the existing cache? The experimental cache will not be changed.',
        buttons:['Use Standard & Play','Cancel'],defaultId:1,cancelId:1,noLink:true
      });
      if(answer!==0)return false;
      cfg=logic.clean({...cfg,shader_mode:'standard'});
      spec=logic.buildPlayArgs(ROOT,cfg);
    }
    if(!steam)logic.saveSettings(ROOT,cfg); // Steam auto-launch is read-only for user settings.
    // A fresh, session-local command file is inherited only by this one runner.
    // Nothing is measured until the player clicks the benchmark window button.
    const activeBench=!steam&&cfg.scene_benchmark?sceneBenchmark.create(ROOT,cfg.shader_mode):null;
    benchmarkSession=activeBench;
    // Do not leak a benchmark hook inherited from the caller into normal Play.
    const childEnv={...process.env};
    delete childEnv.KYTY_LIVE_FILE;
    if(activeBench){
      // Explicit runner switch overrides both inherited env and launch config.
      // Normal Play (including Steam) always forces live-control completely off.
      const index=spec.args.indexOf('-DisableLiveControl');
      if(index>=0)spec.args.splice(index,1);
      spec.args.push('-LiveControlFile',activeBench.commandFile);
      childEnv.KYTY_LIVE_FILE=activeBench.commandFile;
    }
    stopIdlePresence();
    const child=launchCommand(spec,{restore:!steam,silentError:steam,shaderMode:cfg.shader_mode,
      env:childEnv,
      onGameLog:activeBench?text=>{
        if(!activeBench.logPath&&sceneBenchmark.bindLog(activeBench,text,ROOT)){
          sendBenchmarkInfo();
          sceneBenchmark.probe(activeBench).then(()=>sendBenchmarkInfo())
            .catch(error=>{activeBench.probeFailed=true;console.warn('BENCHMARK_PROBE_FAILED',error.message);sendBenchmarkInfo();});
          sendBenchmarkInfo();
          return true;
        }
        return false;
      }:null,
      onGamePid:isConfigured(cfg)?pid=>{
      discordLog('GAME_PID_DETECTED',String(pid));
      startDiscordAgent(cfg,pid);
    }:null});
    gameProcess=child;
    child.on('exit',()=>{
      if(gameProcess===child)gameProcess=null;
      if(activeBench){sceneBenchmark.end(activeBench);sendBenchmarkInfo();}
      discordLog('GAME_EXIT',steam?'Ending Steam-launched game session':'Restoring launcher activity after helper cleanup');
      if(steam)app.quit();else resumeIdlePresence();
    });
    if(steam)child.on('error',()=>{app.quit();});
    mainWindow?.hide();
    if(activeBench)openBenchmarkWindow();
    return true;
  };
  ipcMain.handle('launcher:benchmark-status',()=>benchmarkInfo());
  ipcMain.handle('launcher:benchmark-probe',async event=>{
    if(!benchmarkWindow||event.sender!==benchmarkWindow.webContents||!gameProcess||
       !benchmarkSession?.running||benchmarkSession.probing||benchmarkSession.capturing)
      throw Error('No active benchmark session is available for reconnect.');
    const s=benchmarkSession;
    try{return await sceneBenchmark.probe(s);}
    finally{sendBenchmarkInfo();}
  });
  ipcMain.handle('launcher:benchmark-census',async event=>{
    if(!benchmarkWindow||event.sender!==benchmarkWindow.webContents||!gameProcess||!benchmarkSession?.running)
      throw Error('Start the game with Scene Benchmark enabled before measuring CPU phases.');
    const session=benchmarkSession;
    try{const pending=sceneBenchmark.census(session);sendBenchmarkInfo();return await pending;}
    finally{sendBenchmarkInfo();}
  });
  ipcMain.handle('launcher:benchmark-capture',async event=>{
    if(!benchmarkWindow||event.sender!==benchmarkWindow.webContents||!gameProcess||!benchmarkSession?.running)
      throw Error('Start the game with Scene Benchmark enabled in Options first.');
    const session=benchmarkSession;
    try{const pending=sceneBenchmark.capture(session);sendBenchmarkInfo();return await pending;}
    finally{sendBenchmarkInfo();}
  });
  ipcMain.handle('launcher:play',(_event,data)=>{
    if(steamGameMode)throw Error('Steam session owns game launch');
    return startGame(data);
  });
  ipcMain.handle('launcher:steam-setup',async()=>{
    if(!optionsWindow||optionsWindow.isDestroyed())throw Error('Open Options before configuring Steam.');
    const shortcut=steamShortcut(ROOT);
    if(!shortcut.available)throw Error('Packaged launcher not found. Build the Electron launcher first.');
    const result=await dialog.showMessageBox(optionsWindow,{
      type:'info',title:'Steam Non-Steam Game setup',
      message:'Add KytyPS5 to your Steam Library',
      detail:'Steam → Games → Add a Non-Steam Game to My Library → Browse to the EXE below.\n'+
        'Rename the shortcut to: '+shortcut.name+'\n\nTarget: '+shortcut.target+
        '\nStart In: '+shortcut.startIn+'\nLaunch Options: '+shortcut.launchOptions+
        '\n\nLaunch from Steam (not launcher.cmd). The game auto-starts and the helper exits when gameplay ends. Steam status is limited to Non-Steam Game; no Steamworks Rich Presence or guaranteed Overlay.',
      buttons:['Close','Copy EXE Path','Copy Launch Options'],defaultId:0,cancelId:0,noLink:true
    });
    if(result.response===1)clipboard.writeText(shortcut.target);
    if(result.response===2)clipboard.writeText(shortcut.launchOptions);
    return {copied:result.response===1?'target':result.response===2?'launchOptions':null};
  });
  ipcMain.handle('launcher:choose-game',async(event)=>{
    const parent=BrowserWindow.fromWebContents(event.sender);
    const r=await dialog.showOpenDialog(parent,{properties:['openDirectory'],title:"Choose Demon's Souls game folder"});
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('launcher:choose-streamline',async(event)=>{
    const r=await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender),{properties:['openDirectory'],title:'NVIDIA Streamline SDK'});
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('launcher:shader-update',()=>{
    if(currentSettings().shader_mode==='experimental')throw Error('Update Missing Shaders updates Standard only. Switch to Standard before updating.');
    if(cacheBusy)throw Error('Cache switch/backup in progress.');
    const status=shaderProgress.snapshot();
    if(status.status==='running'||status.status==='stopping') {
      openProgressWindow();
      return status;
    }
    ensureCacheIdle(); // also detects shader compilation started outside this launcher
    const processSpec=logic.buildPrecompileArgs(ROOT,currentSettings());
    const next=shaderProgress.run(processSpec);
    openProgressWindow();
    return next;
  });
  ipcMain.handle('launcher:shader-status',()=>shaderProgress.snapshot());
  ipcMain.handle('launcher:shader-progress-window',()=>{openProgressWindow();return true;});
  ipcMain.handle('launcher:shader-stop',()=>{
    const result=shaderProgress.stop();
    return result;
  });
  ipcMain.handle('launcher:shader-log',()=>{
    const file=shaderProgress.snapshot().logFile;
    if(!file||!fs.existsSync(file))throw Error('No shader update log is available yet.');
    shell.showItemInFolder(file);
    return true;
  });
  ipcMain.handle('launcher:export-hints',()=>{
    if(cacheBusy)throw Error('Cache switch/backup in progress.');
    launchCommand(logic.buildPrecompileArgs(ROOT,currentSettings(),'-ExportHints'),{restore:false,visible:true});
    return true;
  });
  ipcMain.handle('launcher:logs',()=>{
    const p=path.join(ROOT,'_Build','run-logs');fs.mkdirSync(p,{recursive:true});shell.openPath(p);
    return true;
  });
  let cacheBusy=false;
  const ensureCacheIdle=()=>{
    if(modBusy)throw Error('A mod operation is running.');
    if(cacheBusy)throw Error('Another cache operation is in progress.');
    if(gameProcess)throw Error('Close the running game before switching shader caches.');
    if(['running','stopping'].includes(shaderProgress.snapshot().status))throw Error('Shader update is running — do not modify shader caches.');
    const probe=require('node:child_process').spawnSync('powershell.exe',[
      '-NoProfile','-Command',"@((Get-Process kyty_emulator,kyty_shader_precompile -ErrorAction SilentlyContinue)).Count"
    ],{encoding:'utf8',windowsHide:true,timeout:6500});
    if(probe.error||probe.status!==0||probe.stdout.trim()!=='0')
      throw Error('Close KytyPS5 and shader precompile before changing cache versions.');
  };
  // Mods and cache operations share the same idle guard to avoid modifying
  // assets during game reads or shader compilation.
  const modIdle=()=>{
    ensureCacheIdle();
    if(mods.status(currentSettings().game).gameChanged)throw Error('The registered mods belong to another game path.');
  };
  ipcMain.handle('launcher:mods-list',()=>mods.status(currentSettings().game));
  ipcMain.handle('launcher:mods-inspect',(_event,id)=>{
    if(!optionsWindow||optionsWindow.isDestroyed())throw Error('Open Mods Manager first.');
    if(typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id))throw Error('Invalid mod ID');
    modIdle();
    return mods.inspect(id,currentSettings().game);
  });
  const importMod=async type=>{
    if(!optionsWindow||optionsWindow.isDestroyed())throw Error('Open Mods Manager first.');
    modIdle();
    const result=await dialog.showOpenDialog(optionsWindow,{
      title:type==='zip'?'Import a ZIP mod':'Select extracted asset-mod folder',
      properties:type==='zip'?['openFile']:['openDirectory'],
      filters:type==='zip'?[{name:'ZIP mods',extensions:['zip']}]:undefined
    });
    if(result.canceled||!result.filePaths.length)return {cancelled:true};
    modIdle();modBusy=true;
    try{
      const source=result.filePaths[0],game=currentSettings().game;
      return type==='zip'?await mods.importZip(source,game):await mods.importFolder(source,path.basename(source),game);
    }finally{modBusy=false;}
  };
  ipcMain.handle('launcher:mods-import-folder',()=>importMod('folder'));
  ipcMain.handle('launcher:mods-import-zip',()=>importMod('zip'));
  ipcMain.handle('launcher:mods-enable',async(_event,id,enabled)=>{
    if(!optionsWindow||optionsWindow.isDestroyed())throw Error('Open Mods Manager first.');
    if(typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id)||typeof enabled!=='boolean')throw Error('Invalid mod action');
    modIdle();
    const status=mods.status(currentSettings().game);
    const item=status.mods.find(m=>m.id===id);
    if(!item)throw Error('Mod not found; refresh');
    const inspection=mods.inspect(id,currentSettings().game);
    if(!inspection.ready){
      const problem=inspection.files.find(f=>f.state==='invalid'||f.state==='conflict');
      throw Error('Mod preflight blocked: '+problem?.rel+' — '+problem?.detail);
    }
    const counts=inspection.summary;
    const impact=inspection.enabled?
      counts.restore+' original(s) to restore; '+counts.remove+' mod-added file(s) to remove.':
      counts.replace+' replacement(s); '+counts.add+' new file(s); '+counts.identical+' identical file(s).';
    const examples=inspection.files.filter(f=>f.state!=='identical').slice(0,8)
      .map(f=>'['+f.state.toUpperCase()+'] '+f.rel).join('\n');
    const response=await dialog.showMessageBox(optionsWindow,{
      type:enabled?'warning':'question',title:enabled?'Enable asset mod?':'Restore original assets?',
      message:(enabled?'Enable ':'Disable ')+item.name+'?',
      detail:impact+'\n\n'+examples+(inspection.files.length>8?'\n… see Inspect Files for full inventory.':'')+
        '\n\nSHA-256 preflight passed. Game/runtime compatibility is NOT verified. '+
        (enabled?'Originals will be backed up; avoid external edits until disabled.':
          'Restoration is blocked if any file was modified externally.'),
      buttons:['Cancel',enabled?'Enable Mod':'Disable Mod'],defaultId:0,cancelId:0,noLink:true
    });
    if(response.response!==1)return {cancelled:true};
    modIdle();modBusy=true;
    try{return mods.setEnabled(id,enabled,currentSettings().game);}
    finally{modBusy=false;}
  });
  ipcMain.handle('launcher:mods-remove',async(_event,id)=>{
    if(!optionsWindow||optionsWindow.isDestroyed())throw Error('Open Mods Manager first.');
    modIdle();
    const item=mods.status(currentSettings().game).mods.find(m=>m.id===id);
    if(!item||item.enabled)throw Error('Disable the mod before removing it');
    const response=await dialog.showMessageBox(optionsWindow,{
      type:'warning',title:'Remove imported mod?',message:'Remove '+item.name+' from your mod library?',
      detail:'Deletes only this disabled mod’s managed package in _Mods. The game is unaffected.',
      buttons:['Cancel','Remove Mod'],defaultId:0,cancelId:0,noLink:true
    });
    if(response.response!==1)return {cancelled:true};
    modIdle();modBusy=true;
    try{return {removed:mods.remove(id)};}finally{modBusy=false;}
  });
  ipcMain.handle('launcher:mods-repair',async()=>{
    if(!optionsWindow||optionsWindow.isDestroyed())throw Error('Open Mods Manager first.');
    ensureCacheIdle();
    if(!mods.status(currentSettings().game).needsRepair)return {repaired:0};
    const response=await dialog.showMessageBox(optionsWindow,{
      type:'warning',title:'Repair interrupted mod installation?',
      message:'Restore the assets from the last interrupted mod operation?',
      detail:'Checks every target before changing files. Refuses if an external edit is found. Does not touch saves or shaders.',
      buttons:['Cancel','Repair'],defaultId:0,cancelId:0,noLink:true
    });
    if(response.response!==1)return {cancelled:true};
    ensureCacheIdle();modBusy=true;
    try{return mods.repair(currentSettings().game);}finally{modBusy=false;}
  });
  function currentCacheGame(){
    const current=cache.groups(ROOT).find(row=>row.category==='active');
    if(!current)throw Error('No complete active shader cache is available.');
    return current.id.slice(7);
  }
  ipcMain.handle('launcher:cache-snapshot',async()=>{
    if(!optionsWindow||optionsWindow.isDestroyed())throw Error('Open Shader Cache from Options.');
    ensureCacheIdle();
    const game=currentCacheGame();
    const row=cache.groups(ROOT).find(item=>item.id==='active:'+game);
    const answer=await dialog.showMessageBox(optionsWindow,{
      type:'question',title:'Save current shader cache?',
      message:'Save a complete, selectable copy of the current cache?',
      detail:'Copies '+(row.bytes/(1024**3)).toFixed(2)+' GiB to _PipelineCache/generations.\n'+
        'Your current in-use cache remains unchanged. Make sure the drive has enough free space.',
      buttons:['Cancel','Save Version'],defaultId:0,cancelId:0,noLink:true
    });
    if(answer.response!==1)return {cancelled:true};
    ensureCacheIdle();
    cacheBusy=true;
    try{return await versions.snapshot(ROOT,game,()=>{
      // During a transfer, check for emulator processes without treating our own lock as busy.
      const prev=cacheBusy;cacheBusy=false;
      try{ensureCacheIdle();}finally{cacheBusy=prev;}
    });}
    finally{cacheBusy=false;}
  });
  ipcMain.handle('launcher:cache-activate',async(_event,id)=>{
    if(!optionsWindow||optionsWindow.isDestroyed())throw Error('Open Shader Cache from Options.');
    ensureCacheIdle();
    if(typeof id!=='string'||!id.startsWith('generation:'))throw Error('Only completed saved cache generations can be activated.');
    const saved=cache.groups(ROOT).find(item=>item.id===id&&item.switchable);
    if(!saved)throw Error('Selected cache is no longer available. Refresh the list.');
    const current=cache.groups(ROOT).find(item=>item.category==='active'&&item.id.slice(7)===saved.game);
    if(!current)throw Error('Active cache is missing for this game version.');
    const answer=await dialog.showMessageBox(optionsWindow,{
      type:'question',title:'Change active shader cache?',
      message:'Use this saved shader cache for the next game launch?',
      detail:'Switch '+saved.title+' ('+(saved.bytes/(1024**3)).toFixed(2)+' GiB).\n'+
        'The existing in-use cache will be preserved as a selectable previous version.\n'+
        'GPU/driver compatibility will be checked; if invalid, the original cache is restored.',
      buttons:['Cancel','Use This Version'],defaultId:0,cancelId:0,noLink:true
    });
    if(answer.response!==1)return {cancelled:true};
    ensureCacheIdle();cacheBusy=true;
    try{
      const assertIdleDuring=()=>{
        const prior=cacheBusy;cacheBusy=false;try{ensureCacheIdle();}finally{cacheBusy=prior;}
      };
      return versions.activate(ROOT,id.slice(11),saved.game,logic.findPrecompiler(ROOT),currentSettings(),assertIdleDuring);
    }finally{cacheBusy=false;}
  });
  ipcMain.handle('launcher:cache-list',()=>{
    const cfg=currentSettings();
    return {items:cache.groups(ROOT),inputs:shaderInputs.inventory(ROOT),compatibility:cache.cacheStatus(ROOT,cfg,logic.findPrecompiler(ROOT))};
  });
  ipcMain.handle('launcher:input-delete',async(_event,ids)=>{
    if(!optionsWindow||optionsWindow.isDestroyed())throw Error('Open Shader Cache to manage compilation inputs.');
    ensureCacheIdle();
    const all=new Map(shaderInputs.inventory(ROOT).map(x=>[x.id,x]));
    if(!Array.isArray(ids)||!ids.length||ids.some(id=>!all.has(id)||!all.get(id).deletable))
      throw Error('Required shader input files are locked or the selection changed.');
    const selection=ids.map(id=>all.get(id));
    const size=selection.reduce((sum,item)=>sum+item.bytes,0)/(1024*1024);
    const decision=await dialog.showMessageBox(optionsWindow,{
      type:'warning',title:'Remove regenerated shader inputs?',
      message:'Remove '+selection.length+' selected compilation input(s)?',
      detail:selection.map(item=>item.title+' — '+item.cleanupLabel+'\n'+item.cleanupReason).join('\n\n')+
        '\n\nTotal '+size.toFixed(1)+' MiB. These files may need to be rebuilt later. Recycle Bin can restore them.',
      buttons:['Cancel','Move to Recycle Bin'],defaultId:0,cancelId:0,noLink:true
    });
    if(decision.response!==1)return {cancelled:true};
    return shaderInputs.remove(ROOT,ids,shell,ensureCacheIdle);
  });
  ipcMain.handle('launcher:cache-delete',async(_event,ids)=>{
    if(!optionsWindow||optionsWindow.isDestroyed())throw Error('Open Options to manage shader caches.');
    const inventory=cache.groups(ROOT);
    const selected=Array.isArray(ids)?inventory.filter(item=>ids.includes(item.id)):[];
    if(!selected.length||selected.length!==ids.length)throw Error('Invalid selection. Refresh the cache list.');
    const selectedSize=selected.reduce((sum,item)=>sum+item.bytes,0);
    const protectedItem=selected.find(item=>!item.deletable);
    if(protectedItem)throw Error('This cache is protected from deletion: '+protectedItem.title+'. '+protectedItem.cleanupReason);
    const requiresReview=selected.some(item=>item.cleanupLevel==='review');
    const size=(selectedSize/(1024**3)).toFixed(2)+' GiB';
    const warning=selected.map(s=>s.cleanupLabel+' — '+s.title+'\n'+s.cleanupReason).join('\n\n')+
      '\n\nTotal: '+size+'\n\nFiles will be moved to Windows Recycle Bin, not permanently erased.';
    const answer=await dialog.showMessageBox(optionsWindow,{type:'warning',title:'Confirm cache removal',
      message:requiresReview?'You selected saved shader backups — review carefully':'Remove unused archived shader data?',
      detail:warning,buttons:['Cancel',requiresReview?'Remove Backups Anyway':'Move to Recycle Bin'],
      defaultId:0,cancelId:0,noLink:true});
    if(answer.response!==1)return {cancelled:true};
    const processActive=()=>cacheBusy || Boolean(gameProcess) || ['running','stopping'].includes(shaderProgress.snapshot().status) || require('node:child_process').spawnSync('powershell.exe',[
      '-NoProfile','-Command',"@((Get-Process kyty_emulator,kyty_shader_precompile -ErrorAction SilentlyContinue)).Count"
    ],{encoding:'utf8',windowsHide:true,timeout:5000}).stdout.trim()!=='0';
    return cache.trashSelected(ROOT,ids,shell,processActive);
  });
  ipcMain.handle('launcher:quit',()=>{app.quit();return true;});
  createWindow();
  if(steamGameMode){
    // Steam tracks this top-level EXE while the -Follow PowerShell session runs.
    // Do not show the idle launcher or change launcher-settings.json.
    try{
      startGame(currentSettings(),{steam:true});
      console.log('STEAM_NON_STEAM_GAME_SESSION_STARTED');
    }catch(error){
      console.error('STEAM_GAME_LAUNCH_FAILED '+error.message);
      dialog.showErrorBox('Steam launch unavailable',error.message);
      app.quit();
    }
  }else startIdlePresence();
  if (process.argv.includes('--smoke-ui')) {
    // GUI integration test: render both native Electron windows and capture review images.
    (async()=>{
      const waitLoad = win => new Promise((resolve,reject)=>{
        if (!win || win.isDestroyed()) return reject(Error('Window not created'));
        if (!win.webContents.isLoading()) return resolve();
        win.webContents.once('did-finish-load',resolve);
        win.webContents.once('did-fail-load',(_evt,code,desc)=>reject(Error(desc+' ('+code+')')));
      });
      try{
        await waitLoad(mainWindow);
        const m=await mainWindow.webContents.executeJavaScript(
          "({play:!!document.querySelector('#play'),options:!!document.querySelector('#options'),quit:!!document.querySelector('#quit'),image:document.querySelector('.hero img').naturalWidth>0,menuHeight:document.querySelector('.start-bottom').getBoundingClientRect().height})");
        if (!m.play || !m.options || !m.quit || !m.image || m.menuHeight<120) throw Error('Main screen failed layout checks: '+JSON.stringify(m));
        const reviewDir=path.join(ROOT,'_Build','launcher-electron');
        fs.mkdirSync(reviewDir,{recursive:true});
        await new Promise(resolve=>setTimeout(resolve,750));
        try { fs.writeFileSync(path.join(reviewDir,'review-menu.png'),(await mainWindow.webContents.capturePage()).toPNG()); }
        catch(e){console.warn('SCREENSHOT_UNAVAILABLE main: '+e.message);}
        openOptions();
        await waitLoad(optionsWindow);
        optionsWindow.show();
        await new Promise(resolve=>setTimeout(resolve,500));
        const o=await optionsWindow.webContents.executeJavaScript(
          "({tabs:document.querySelectorAll('.tab-strip button').length,cols:document.querySelectorAll('#tab-display .field-col').length,footer:!!document.querySelector('#ok')&&!!document.querySelector('#cancel'),rows:document.querySelectorAll('#tab-display .field').length,uniqueSettings:(()=>{const a=[...document.querySelectorAll('select[id],input[id]')].filter(el=>!['preset','language','game-path','sdk-path'].includes(el.id));return new Set(a.map(el=>el.id)).size===a.length})(),artwork:document.querySelector('.options-banner img').naturalWidth>0,rendered:document.querySelector('#tab-display').getBoundingClientRect().height})");
        if(o.tabs!==5 || o.cols!==2 || !o.footer || !o.uniqueSettings || !o.artwork || o.rows<6 || o.rendered<300) throw Error('Options screen failed layout checks: '+JSON.stringify(o));
        const discordHidden=await optionsWindow.webContents.executeJavaScript(
          "({tab:!document.querySelector('[data-tab=discord]'),panel:!document.querySelector('#tab-discord'),inputs:!document.querySelector('#discord-presence, #discord-app-id, #discord-image, #discord-dev-portal')})");
        if(Object.values(discordHidden).some(value=>!value))
          throw Error('Discord JSON-only controls leaked into the Settings UI: '+JSON.stringify(discordHidden));
        console.log('ELECTRON_DISCORD_JSON_ONLY_PASS '+JSON.stringify(discordHidden));
        await optionsWindow.webContents.executeJavaScript("document.querySelector('[data-tab=advanced]').click()");
        const steamUi=await optionsWindow.webContents.executeJavaScript(
          "({setup:!!document.querySelector('#steam-setup'),bridge:typeof window.launcher.setupSteam==='function',"+
          "mode:document.querySelector('#steam-hint').textContent.includes('Non-Steam'),"+
          "visible:(()=>{const b=document.querySelector('#steam-setup').getBoundingClientRect();"+
          "const p=document.querySelector('#tab-advanced').getBoundingClientRect();return b.height>0&&b.top>=p.top&&b.bottom<=p.bottom;})()})");
        if(Object.values(steamUi).some(v=>!v))throw Error('Steam setup UI smoke failed: '+JSON.stringify(steamUi));
        console.log('ELECTRON_STEAM_SETUP_UI_PASS '+JSON.stringify(steamUi));
        try { fs.writeFileSync(path.join(reviewDir,'review-options.png'),(await optionsWindow.webContents.capturePage()).toPNG()); }
        catch(e){console.warn('SCREENSHOT_UNAVAILABLE options: '+e.message);}
        // Review the Graphics and Shader Cache screens, not only the default Display tab.
        await optionsWindow.webContents.executeJavaScript("document.querySelector('[data-tab=graphics]').click()");
        await new Promise(resolve=>setTimeout(resolve,250));
        const shaderModeUi=await optionsWindow.webContents.executeJavaScript(
          "(async()=>({select:!!document.querySelector('#shader-mode'),restore:!!document.querySelector('#shader-mode-restore'),"+
          "status:!!document.querySelector('#shader-mode-status'),bridge:typeof window.launcher.shaderTrialStatus==='function',"+
          "trial:await window.launcher.shaderTrialStatus(document.querySelector('#game-path').value)}))()");
        if(!shaderModeUi.select||!shaderModeUi.restore||!shaderModeUi.status||!shaderModeUi.bridge||
           typeof shaderModeUi.trial.ready!=='boolean')throw Error('Shader Translation Mode UI failed: '+JSON.stringify(shaderModeUi));
        console.log('ELECTRON_SHADER_MODE_UI_PASS '+JSON.stringify(shaderModeUi));
        const modeInteraction=await optionsWindow.webContents.executeJavaScript(
          "(()=>{const select=document.querySelector('#shader-mode');select.value='experimental';"+
          "select.dispatchEvent(new Event('change',{bubbles:true}));"+
          "document.querySelector('#shader-mode-restore').click();"+
          "return {mode:select.value,restoreDisabled:document.querySelector('#shader-mode-restore').disabled};})()");
        if(modeInteraction.mode!=='standard'||!modeInteraction.restoreDisabled)
          throw Error('Shader Standard rollback UI failed: '+JSON.stringify(modeInteraction));
        console.log('ELECTRON_SHADER_MODE_ROLLBACK_UI_PASS '+JSON.stringify(modeInteraction));
        fs.writeFileSync(path.join(reviewDir,'review-graphics.png'),(await optionsWindow.webContents.capturePage()).toPNG());
        await optionsWindow.webContents.executeJavaScript("document.querySelector('[data-tab=mods]').click()");
        const modUi=await optionsWindow.webContents.executeJavaScript(
          "({panel:document.querySelector('#tab-mods').classList.contains('active'),folder:!!document.querySelector('#mod-import-folder'),zip:!!document.querySelector('#mod-import-zip'),list:!!document.querySelector('#mod-list'),inspection:!!document.querySelector('#mod-inspection'),inspectBridge:typeof window.launcher.inspectMod==='function',previewDisabled:document.querySelector('#mod-preview').disabled,toggleDisabled:document.querySelector('#mod-toggle').disabled,repairDisabled:document.querySelector('#mod-repair').disabled})");
        if(Object.values(modUi).some(x=>!x))throw Error('Mods Manager GUI smoke failed: '+JSON.stringify(modUi));
        console.log('ELECTRON_MODS_UI_PASS '+JSON.stringify(modUi));
        const inspectionUi=await optionsWindow.webContents.executeJavaScript(
          "(async()=>{const row=document.querySelector('.mod-item');if(!row)return {skipped:true};"+
          "row.click();document.querySelector('#mod-preview').click();"+
          "for(let i=0;i<60;i++){if(document.querySelector('.mod-file'))break;await new Promise(r=>setTimeout(r,100));}"+
          "return {selected:!!document.querySelector('.mod-item.selected'),files:document.querySelectorAll('.mod-file').length,"+
          "message:document.querySelector('#mod-status').textContent};})()");
        if(!inspectionUi.skipped&&(!inspectionUi.selected||inspectionUi.files===0||
           !inspectionUi.message.includes('Read-only inspection passed')))
          throw Error('Mods Inspect Files UI failed: '+JSON.stringify(inspectionUi));
        console.log('ELECTRON_MODS_INSPECT_PASS '+JSON.stringify(inspectionUi));
        fs.writeFileSync(path.join(reviewDir,'review-mods.png'),(await optionsWindow.webContents.capturePage()).toPNG());
        await optionsWindow.webContents.executeJavaScript("document.querySelector('[data-tab=cache]').click()");
        await new Promise(resolve=>setTimeout(resolve,450));
        const cacheScreen=await optionsWindow.webContents.executeJavaScript(
          "({rows:document.querySelectorAll('.cache-entry').length,selected:document.querySelectorAll('.cache-check:checked').length,deleteDisabled:document.querySelector('#cache-delete').disabled,locked:document.querySelectorAll('.cache-entry.cache-locked').length,safeBadges:document.querySelectorAll('.cache-policy-safe').length,protectedBadges:document.querySelectorAll('.cache-policy-protected').length,protectedSelectable:!!document.querySelector('.cache-entry.cache-protected .cache-check'),safeSelectable:!!document.querySelector('.cache-entry.cache-safe .cache-check'),snapshot:!!document.querySelector('#cache-snapshot'),sections:document.querySelectorAll('.cache-group-heading').length,activeSelectable:!!document.querySelector('.cache-entry.cache-locked input[type=checkbox]'),text:document.querySelector('#cache-list').textContent.includes('PPSA01341')})");
        if(cacheScreen.rows<1 || cacheScreen.selected!==0 || !cacheScreen.deleteDisabled || cacheScreen.locked<1 || cacheScreen.protectedBadges<1 || cacheScreen.protectedSelectable || !cacheScreen.snapshot || cacheScreen.activeSelectable || cacheScreen.sections<2 || !cacheScreen.text)
          throw Error('Shader Cache UI did not list current vs archived caches safely: '+JSON.stringify(cacheScreen));
        fs.writeFileSync(path.join(reviewDir,'review-cache.png'),(await optionsWindow.webContents.capturePage()).toPNG());
        const inputUi=await optionsWindow.webContents.executeJavaScript("({rows:document.querySelectorAll('.input-entry').length,protected:[...document.querySelectorAll('.cache-title-line')].some(el=>el.textContent.includes('KEEP — BASE SEEDS')),fingerprint:[...document.querySelectorAll('.cache-group-heading')].some(el=>el.textContent.includes('SHADER COMPILATION INPUTS')),removeDisabled:document.querySelector('#inputs-remove').disabled})");
        if(!inputUi.protected||!inputUi.fingerprint||!inputUi.removeDisabled||inputUi.rows<1)throw Error('Shader compilation inputs view failed: '+JSON.stringify(inputUi));
        console.log('ELECTRON_INPUTS_UI_PASS '+JSON.stringify(inputUi));
        console.log('ELECTRON_CACHE_SCREEN_PASS '+JSON.stringify(cacheScreen));
        openProgressWindow();
        await waitLoad(progressWindow);
        progressWindow.show();
        const progressChecks=await progressWindow.webContents.executeJavaScript(
          "({phase:!!document.querySelector('#shader-phase'),shards:!!document.querySelector('#shader-shards'),output:!!document.querySelector('#shader-output'),stop:!!document.querySelector('#shader-stop'),log:!!document.querySelector('#shader-open-log')})");
        if(Object.values(progressChecks).some(v=>!v))throw Error('Shader progress window missing controls: '+JSON.stringify(progressChecks));
        try {fs.writeFileSync(path.join(reviewDir,'review-shader-progress.png'),(await progressWindow.webContents.capturePage()).toPNG());}
        catch(e){console.warn('SCREENSHOT_UNAVAILABLE shader progress: '+e.message);}
        console.log('ELECTRON_PROGRESS_WINDOW_PASS '+JSON.stringify(progressChecks));
        progressWindow.close();
        // G2 measurement window smoke is UI-only: no game, no live session,
        // no shader/caches/save mutation and no synthetic command execution.
        openBenchmarkWindow();
        await waitLoad(benchmarkWindow);
        const benchUi=await benchmarkWindow.webContents.executeJavaScript(
          "(async()=>({capture:!!document.querySelector('#bench-measure'),cpuCensus:!!document.querySelector('#bench-census'),"+
          "disabled:document.querySelector('#bench-measure').disabled,censusDisabled:document.querySelector('#bench-census').disabled,"+
          "mode:!!document.querySelector('#bench-mode'),"+
          "bridge:typeof window.launcher.benchmarkCapture==='function'&&typeof window.launcher.benchmarkCensus==='function',"+
          "status:await window.launcher.benchmarkStatus()}))()");
        if(!benchUi.capture||!benchUi.cpuCensus||!benchUi.disabled||!benchUi.censusDisabled||!benchUi.mode||!benchUi.bridge||benchUi.status.enabled)
          throw Error('Scene Benchmark UI smoke failed: '+JSON.stringify(benchUi));
        console.log('ELECTRON_SCENE_BENCHMARK_UI_PASS '+JSON.stringify(benchUi));
        try{fs.writeFileSync(path.join(reviewDir,'review-scene-benchmark.png'),
          (await benchmarkWindow.webContents.capturePage()).toPNG());}
        catch(e){console.warn('SCREENSHOT_UNAVAILABLE benchmark: '+e.message);}
        benchmarkWindow.close();
        // Real renderer IPC: select a graphics preset, confirm its JSON and then Cancel.
        const original=currentSettings();
        const requested=original.quality==='standard' ? 'Ultra Performance' : 'Quality';
        await optionsWindow.webContents.executeJavaScript(
          "document.querySelector('[data-tab=graphics]').click();"+
          "const p=document.querySelector('#preset');p.value='"+requested+"';p.dispatchEvent(new Event('change',{bubbles:true}));");
        await new Promise(resolve=>setTimeout(resolve,400));
        const applied=currentSettings();
        const wanted=logic.applyPreset(original,requested);
        if (applied.render_dlss!==wanted.render_dlss || applied.quality!==wanted.quality ||
            applied.framegen!==original.framegen || applied.ram16_backing!==original.ram16_backing)
          throw Error('Preset did not persist actual configuration: '+JSON.stringify(applied));
        console.log('ELECTRON_PRESET_APPLIED_PASS '+requested+' '+applied.render_dlss+'p '+applied.quality);
        await optionsWindow.webContents.executeJavaScript("document.querySelector('#cancel').click()");
        await new Promise(resolve=>setTimeout(resolve,250));
        if (JSON.stringify(currentSettings())!==JSON.stringify(original)) throw Error('Cancel did not restore original settings.');
        console.log('ELECTRON_CANCEL_ROLLBACK_PASS RAM16='+original.ram16_backing);
        // Cache inventory is read-only by default and includes archived 2026-10-22 shards separately.
        const inventory=cache.groups(ROOT);
        if (!inventory.some(i=>i.category==='active'))
          throw Error('Active shader generation was not identified.');
        const cacheUI=await mainWindow.webContents.executeJavaScript("document.querySelector('#options').textContent");
        if(!cacheUI)throw Error('Menu lost the Options action');
        console.log('ELECTRON_CACHE_INVENTORY_PASS '+JSON.stringify(inventory.map(i=>({id:i.id,bytes:i.bytes,category:i.category}))));
        console.log('ELECTRON_UI_SMOKE_PASS '+JSON.stringify({main:m,options:o,root:ROOT}));
      } catch(error) {
        console.error('ELECTRON_UI_SMOKE_FAIL '+error.stack);
        process.exitCode=1;
      } finally {
        optionsCommitted=true;
        app.quit();
      }
    })();
  }
});
app.on('before-quit',()=>{discordClosing=true;stopIdlePresence();});
app.on('window-all-closed',()=>{if (process.platform !== 'darwin')app.quit();});
