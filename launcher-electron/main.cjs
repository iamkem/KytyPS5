'use strict';
const {app,BrowserWindow,ipcMain,dialog,screen,net,protocol,shell} = require('electron');
const {pathToFileURL} = require('node:url');
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const logic = require('./logic.cjs');
const cache = require('./cache.cjs');
const versions=require('./cache-generations.cjs');
const {ShaderProgress}=require('./shader-progress.cjs');
const shaderInputs=require('./shader-inputs.cjs');
const {isConfigured,validConfig,readGamePid}=require('./discord-presence.cjs');
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
let mainWindow=null,optionsWindow=null,progressWindow=null,gameProcess=null,optionsSnapshot=null,optionsCommitted=false;
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
function createWindow() {
  mainWindow = new BrowserWindow({
    width:728,height:458,useContentSize:true,resizable:false,maximizable:false,
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
  });
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
      env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});
    child.on('error',error=>console.warn('Discord Presence helper failed to launch:',error.message));
    child.unref();
    return true;
  }catch(error){
    console.warn('Discord Presence unavailable:',error.message);
    return false;
  }
}
function launchCommand(spec,{restore=false,visible=false,onGamePid=null}={}) {
  const child=spawn(spec.command,spec.args,{cwd:ROOT,windowsHide:!visible,
    stdio:onGamePid?['ignore','pipe','pipe']:'ignore'});
  if(onGamePid){
    let recent='',recognized=false;
    child.stdout.on('data',data=>{
      if(recognized)return;
      recent=(recent+data.toString('utf8')).slice(-900);
      const pid=readGamePid(recent);
      if(pid){recognized=true;onGamePid(pid);}
    });
    child.stderr.on('data',()=>{});
  }
  child.on('error',err=>{gameProcess=null;mainWindow?.show();mainWindow?.webContents.send('launcher:game-exit');dialog.showErrorBox('Unable to start KytyPS5',err.message);});
  child.on('exit',()=>{if (restore&&mainWindow) {mainWindow.show();mainWindow.focus();mainWindow.webContents.send('launcher:game-exit');}});
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
  ipcMain.handle('launcher:options',()=>{openOptions();return true;});
  ipcMain.handle('launcher:close-options',(_event,commit=false)=>{optionsCommitted=Boolean(commit);optionsWindow?.close();return true;});
  ipcMain.handle('launcher:play',(_event,data)=>{
    if(cacheBusy)throw Error('Cache backup/switch in progress. Finish it before launching the game.');
    if(['running','stopping'].includes(shaderProgress.snapshot().status))throw Error('Shader update is still running. Finish it before playing.');
    const cfg=logic.clean(data);
    const spec=logic.buildPlayArgs(ROOT,cfg);
    logic.saveSettings(ROOT,cfg);
    if (gameProcess) throw Error('KytyPS5 is already running.');
    gameProcess=launchCommand(spec,{restore:true,onGamePid:isConfigured(cfg)?pid=>startDiscordAgent(cfg,pid):null});
    gameProcess.on('exit',()=>{gameProcess=null;});
    mainWindow?.hide();
    return true;
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
  ipcMain.handle('launcher:discord-developers',()=>shell.openExternal('https://discord.com/developers/applications'));
  ipcMain.handle('launcher:logs',()=>{
    const p=path.join(ROOT,'_Build','run-logs');fs.mkdirSync(p,{recursive:true});shell.openPath(p);
    return true;
  });
  let cacheBusy=false;
  const ensureCacheIdle=()=>{
    if(cacheBusy)throw Error('Another cache operation is in progress.');
    if(gameProcess)throw Error('Close the running game before switching shader caches.');
    if(['running','stopping'].includes(shaderProgress.snapshot().status))throw Error('Shader update is running — do not modify shader caches.');
    const probe=require('node:child_process').spawnSync('powershell.exe',[
      '-NoProfile','-Command',"@((Get-Process kyty_emulator,kyty_shader_precompile -ErrorAction SilentlyContinue)).Count"
    ],{encoding:'utf8',windowsHide:true,timeout:6500});
    if(probe.error||probe.status!==0||probe.stdout.trim()!=='0')
      throw Error('Close KytyPS5 and shader precompile before changing cache versions.');
  };
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
        await optionsWindow.webContents.executeJavaScript("document.querySelector('[data-tab=discord]').click()");
        const discordUI=await optionsWindow.webContents.executeJavaScript(
          "({enable:!!document.querySelector('#discord-presence'),appId:!!document.querySelector('#discord-app-id'),asset:!!document.querySelector('#discord-image'),preview:document.querySelector('.discord-preview')?.textContent.includes('Playing Demon'),developer:!!document.querySelector('#discord-dev-portal')})");
        if(Object.values(discordUI).some(v=>!v))throw Error('Discord settings UI failed: '+JSON.stringify(discordUI));
        console.log('ELECTRON_DISCORD_UI_PASS '+JSON.stringify(discordUI));
        try { fs.writeFileSync(path.join(reviewDir,'review-options.png'),(await optionsWindow.webContents.capturePage()).toPNG()); }
        catch(e){console.warn('SCREENSHOT_UNAVAILABLE options: '+e.message);}
        // Review the Graphics and Shader Cache screens, not only the default Display tab.
        await optionsWindow.webContents.executeJavaScript("document.querySelector('[data-tab=graphics]').click()");
        await new Promise(resolve=>setTimeout(resolve,250));
        fs.writeFileSync(path.join(reviewDir,'review-graphics.png'),(await optionsWindow.webContents.capturePage()).toPNG());
        await optionsWindow.webContents.executeJavaScript("document.querySelector('[data-tab=cache]').click()");
        await new Promise(resolve=>setTimeout(resolve,450));
        const cacheScreen=await optionsWindow.webContents.executeJavaScript(
          "({rows:document.querySelectorAll('.cache-entry').length,selected:document.querySelectorAll('.cache-check:checked').length,deleteDisabled:document.querySelector('#cache-delete').disabled,locked:document.querySelectorAll('.cache-entry.cache-locked').length,safeBadges:document.querySelectorAll('.cache-policy-safe').length,protectedBadges:document.querySelectorAll('.cache-policy-protected').length,protectedSelectable:!!document.querySelector('.cache-entry.cache-protected .cache-check'),safeSelectable:!!document.querySelector('.cache-entry.cache-safe .cache-check'),snapshot:!!document.querySelector('#cache-snapshot'),sections:document.querySelectorAll('.cache-group-heading').length,activeSelectable:!!document.querySelector('.cache-entry.cache-locked input[type=checkbox]'),text:document.querySelector('#cache-list').textContent.includes('PPSA01341')})");
        if(cacheScreen.rows<1 || cacheScreen.selected!==0 || !cacheScreen.deleteDisabled || cacheScreen.locked<1 || cacheScreen.protectedBadges<1 || cacheScreen.protectedSelectable || !cacheScreen.snapshot || cacheScreen.activeSelectable || cacheScreen.sections<2 || !cacheScreen.text)
          throw Error('Shader Cache UI did not list current vs archived caches safely: '+JSON.stringify(cacheScreen));
        fs.writeFileSync(path.join(reviewDir,'review-cache.png'),(await optionsWindow.webContents.capturePage()).toPNG());
        const inputUi=await optionsWindow.webContents.executeJavaScript("({rows:document.querySelectorAll('.input-check').length,protected:[...document.querySelectorAll('.cache-title-line')].some(el=>el.textContent.includes('KEEP — BASE SEEDS')),fingerprint:[...document.querySelectorAll('.cache-group-heading')].some(el=>el.textContent.includes('SHADER COMPILATION INPUTS')),removeDisabled:document.querySelector('#inputs-remove').disabled})");
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
            applied.framegen!==0 || applied.ram16_backing!==original.ram16_backing)
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
app.on('window-all-closed',()=>{if (process.platform !== 'darwin')app.quit();});
