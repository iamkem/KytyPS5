'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const lib=require('../logic.cjs');
const root=process.env.KYTY_TEST_ROOT || path.resolve(__dirname,'..','..');
const localReady=fs.existsSync(lib.findEmulator(root)) && lib.gameValid(lib.loadSettings(root));
test('RAM Safety Mode is opt-in and preserves the known-good defaults',{skip:!localReady},()=>{
  const original=lib.loadSettings(root);
  const baseline=lib.buildPlayArgs(root,{...original,ram_safety:false});
  assert.ok(!baseline.args.join(' ').includes('KYTY_PREFETCH_MIN_AVAIL_MB='));
  assert.equal(lib.clean({}).ram_safety,false);
  const candidate=path.join(root,'_Build','windows-ram-offload','kyty_emulator.exe');
  if (!fs.existsSync(candidate)) {
    assert.throws(()=>lib.buildPlayArgs(root,{...original,ram_safety:true}),/Stage 5 Offload emulator is missing/);
    return;
  }
  const safety=lib.buildPlayArgs(root,{...original,ram_safety:true});
  const vars=safety.args[safety.args.indexOf('-Set')+1];
  assert.match(vars,/KYTY_ADAPTIVE_RAM=1/);
  assert.match(vars,/KYTY_PREFETCH_MIN_AVAIL_MB=4096/);
  assert.match(vars,/KYTY_SHADER_PREFETCH_THREADS=1/);
  assert.match(vars,/KYTY_SHADER_FOLLOW_THREADS=1/);
  assert.match(safety.args[safety.args.indexOf('-Exe')+1],/windows-ram-offload.*kyty_emulator\.exe$/i);
  assert.notEqual(safety.args[safety.args.indexOf('-Exe')+1],baseline.args[baseline.args.indexOf('-Exe')+1]);
  assert.deepEqual(lib.applyPreset({...original,ram_safety:true},'Balanced').ram_safety,true);
  const probe=spawnSync(safety.command,[...safety.args,'-DryRun'],
    {cwd:root,encoding:'utf8',windowsHide:true,timeout:40000});
  assert.equal(probe.status,0,probe.stderr||probe.stdout);
  assert.match(probe.stdout,/KYTY_ADAPTIVE_RAM=1/);
  assert.match(probe.stdout,/KYTY_PREFETCH_MIN_AVAIL_MB=4096/);
  assert.match(probe.stdout,/KYTY_SHADER_PREFETCH_THREADS=1/);
  assert.match(probe.stdout,/KYTY_SHADER_FOLLOW_THREADS=1/);
});
test('Texture Residency Probe is separately opt-in and never enables destructive offload',{skip:!localReady},()=>{
  assert.equal(lib.clean({}).texture_offload,false);
  const prior=lib.loadSettings(root);
  const rootBase={...prior,ram_safety:true,ram16_backing:true,texture_offload:true};
  const native=path.join(root,'_Build','windows-ram-offload','kyty_emulator.exe');
  if(!fs.existsSync(native)){
    assert.throws(()=>lib.buildPlayArgs(root,rootBase),/Stage 5 Offload emulator is missing/);
    return;
  }
  const active=lib.buildPlayArgs(root,rootBase);
  const vars=active.args[active.args.indexOf('-Set')+1];
  assert.match(vars,/KYTY_TEXTURE_OFFLOAD=0/);
  assert.match(vars,/KYTY_TEXTURE_OFFLOAD_PROBE=1/);
  assert.match(vars,/KYTY_TEXTURE_OFFLOAD_ADAPTIVE=1/);
  assert.doesNotMatch(vars,/KYTY_TEXTURE_OFFLOAD=1/);
  assert.throws(()=>lib.buildPlayArgs(root,{...rootBase,ram16_backing:false}),/requires Extended Memory Mode/);
  const disabled=lib.buildPlayArgs(root,{...rootBase,texture_offload:false});
  assert.doesNotMatch(disabled.args[disabled.args.indexOf('-Set')+1],/KYTY_TEXTURE_OFFLOAD=/);
  const legacy=lib.buildPlayArgs(root,{...rootBase,ram_safety:false});
  assert.doesNotMatch(legacy.args[legacy.args.indexOf('-Set')+1],/KYTY_TEXTURE_OFFLOAD=/);
  assert.equal(lib.applyPreset(rootBase,'Balanced').texture_offload,true);
});
test('Chenxiao07 PAGE_GUARD BSOD mitigation uses a separate, opt-in native candidate',{skip:!localReady},()=>{
  const base=lib.loadSettings(root);
  assert.equal(lib.clean({}).chenxiao_guard,false);
  const trialSettings={...base,ram_safety:true,ram16_backing:true,stage7_ram:false,texture_offload:false,chenxiao_guard:true};
  const trial=lib.buildPlayArgs(root,trialSettings);
  assert.match(trial.args[trial.args.indexOf('-Exe')+1],/windows-chenxiao-guard.*kyty_emulator\.exe$/i);
  const env=trial.args[trial.args.indexOf('-Set')+1];
  assert.match(env,/KYTY_READ_GUARD=1/);
  assert.match(env,/KYTY_ADAPTIVE_RAM=1/);
  assert.match(env,/KYTY_BACKING_FILE=1/);
  assert.match(env,/KYTY_TEXTURE_OFFLOAD_PROBE=0/);
  assert.doesNotMatch(env,/KYTY_STAGE7_RAM=1/);
  assert.throws(()=>lib.buildPlayArgs(root,{...trialSettings,ram_safety:false}),/Chenxiao BSOD Guard requires/);
  assert.throws(()=>lib.buildPlayArgs(root,{...trialSettings,ram16_backing:false}),/Chenxiao BSOD Guard requires/);
  assert.throws(()=>lib.buildPlayArgs(root,{...trialSettings,texture_offload:true}),/Chenxiao BSOD Guard requires/);
  assert.throws(()=>lib.buildPlayArgs(root,{...trialSettings,stage7_ram:true}),/Chenxiao BSOD Guard requires/);
  const off=lib.buildPlayArgs(root,{...trialSettings,chenxiao_guard:false});
  assert.doesNotMatch(off.args[off.args.indexOf('-Set')+1],/KYTY_READ_GUARD=/);
  assert.match(off.args[off.args.indexOf('-Exe')+1],/windows-ram-offload.*kyty_emulator\.exe$/i);
  assert.equal(lib.applyPreset(trialSettings,'Balanced').chenxiao_guard,true);
  const probe=spawnSync(trial.command,[...trial.args,'-DryRun'],
    {cwd:root,encoding:'utf8',windowsHide:true,timeout:40000});
  assert.equal(probe.status,0,probe.stderr||probe.stdout);
  assert.match(probe.stdout,/KYTY_READ_GUARD=1/);
  assert.match(probe.stdout,/windows-chenxiao-guard/i);
});
test('Stage 7 residency mode is isolated and stays opt-in',{skip:!localReady},()=>{
  const base=lib.loadSettings(root);
  assert.equal(lib.clean({}).stage7_ram,false);
  const candidate={...base,ram_safety:true,ram16_backing:true,texture_offload:false,stage7_ram:true};
  const trial=lib.buildPlayArgs(root,candidate);
  assert.match(trial.args[trial.args.indexOf('-Exe')+1],/windows-stage7-resource.*kyty_emulator\.exe$/i);
  const env=trial.args[trial.args.indexOf('-Set')+1];
  assert.match(env,/KYTY_STAGE7_RAM=1/);
  assert.match(env,/KYTY_TEXTURE_OFFLOAD_PROBE=0/);
  assert.match(env,/KYTY_BACKING_FILE=1/);
  assert.match(env,/KYTY_ADAPTIVE_RAM=1/);
  assert.doesNotMatch(env,/KYTY_TEXTURE_OFFLOAD=1/);
  assert.throws(()=>lib.buildPlayArgs(root,{...candidate,ram_safety:false}),/Stage 7 requires/);
  assert.throws(()=>lib.buildPlayArgs(root,{...candidate,ram16_backing:false}),/Stage 7 requires/);
  assert.throws(()=>lib.buildPlayArgs(root,{...candidate,texture_offload:true}),/Stage 7 requires/);
  const old=lib.buildPlayArgs(root,{...candidate,stage7_ram:false});
  assert.doesNotMatch(old.args[old.args.indexOf('-Set')+1],/KYTY_STAGE7_RAM=/);
  assert.match(old.args[old.args.indexOf('-Exe')+1],/windows-ram-offload.*kyty_emulator\.exe$/i);
  assert.equal(lib.applyPreset(candidate,'Balanced').stage7_ram,true);
  const probe=spawnSync(trial.command,[...trial.args,'-DryRun'],
    {cwd:root,encoding:'utf8',windowsHide:true,timeout:40000});
  assert.equal(probe.status,0,probe.stderr||probe.stdout);
  assert.match(probe.stdout,/KYTY_STAGE7_RAM=1/);
  assert.match(probe.stdout,/windows-stage7-resource/i);
});
test('Chenxiao v20261023b isolated runtime exposes safe FSR3, DLSS model and 30 FPS',{skip:!localReady},()=>{
  const base={...lib.loadSettings(root),upstream_latest:true,chenxiao_guard:false,ram_safety:true,ram16_backing:true,
    stage7_ram:false,texture_offload:false,fps120:false,fps30:false,fsr:false,framegen:0,dlss_model:'auto'};
  assert.equal(lib.clean({}).upstream_latest,false);
  assert.throws(()=>lib.buildPlayArgs(root,{...base,stage7_ram:true}),/Chenxiao v20261023b requires/);
  assert.throws(()=>lib.buildPlayArgs(root,{...base,texture_offload:true}),/Chenxiao v20261023b requires/);
  assert.throws(()=>lib.buildPlayArgs(root,{...base,ram16_backing:false}),/Chenxiao v20261023b requires/);
  assert.throws(()=>lib.buildPlayArgs(root,{...base,ram_safety:false}),/Chenxiao v20261023b requires/);
  assert.throws(()=>lib.buildPlayArgs(root,{...base,fps30:true,fps120:true}),/not both/);
  assert.throws(()=>lib.buildPlayArgs(root,{...base,upstream_latest:false,upscaler:'fsr'}),/require Chenxiao v20261023b/);
  const native=path.join(root,'_Build','windows-chenxiao-v15','kyty_emulator.exe');
  if(!fs.existsSync(native)){
    assert.throws(()=>lib.buildPlayArgs(root,base),/v20261023b native is missing/);
    return;
  }
  const fsrSettings={...base,upscaler:'fsr',output:'1080p',render_dlss:540,fps30:true};
  const fsr=lib.buildPlayArgs(root,fsrSettings);
  const env=fsr.args[fsr.args.indexOf('-Set')+1];
  assert.equal(fsr.args[fsr.args.indexOf('-RenderHeight')+1],'540');
  assert.ok(fsr.args.includes('-HdOutput'));
  assert.match(fsr.args[fsr.args.indexOf('-Exe')+1],/windows-chenxiao-v15.*kyty_emulator\.exe$/i);
  assert.match(env,/KYTY_UPSCALER=fsr/);
  assert.equal(lib.clean({...base,gpu:'NVIDIA RTX 5070;invalid'}).gpu,'');
  const gpu=lib.buildPlayArgs(root,{...fsrSettings,gpu:'RTX 5070'});
  assert.match(gpu.args[gpu.args.indexOf('-Set')+1],/KYTY_GPU=RTX 5070/);
  assert.match(env,/KYTY_FLIP_RATE=1/);
  assert.match(env,/KYTY_READ_GUARD=1/);
  assert.match(env,/KYTY_TEXTURE_OFFLOAD=0/);
  assert.ok(!fsr.args.includes('-StreamlineDir'));
  assert.ok(!fsr.args.includes('-Upscaler'));
  assert.equal(lib.clean({...base,upscaler:'fsr',output:'1080p',render_dlss:360}).render_dlss,360);
  const dlss=lib.buildPlayArgs(root,{...base,upscaler:'dlss',output:'4k',dlss_model:'K'});
  assert.match(dlss.args[dlss.args.indexOf('-Set')+1],/KYTY_DLSS_PRESET=K/);
  assert.equal(lib.applyPreset(base,'Balanced').upstream_latest,true);
  const pre=lib.buildPrecompileArgs(root,base);
  assert.match(pre.args[pre.args.indexOf('-Exe')+1],/windows-chenxiao-v15.*kyty_shader_precompile\.exe$/i);
  assert.ok(pre.args.includes('-Incremental'));
  // Merely planning precompile is safe; this test does NOT execute it.
  const dry=spawnSync(fsr.command,[...fsr.args,'-DryRun'],
    {cwd:root,encoding:'utf8',windowsHide:true,timeout:45000});
  assert.equal(dry.status,0,dry.stderr||dry.stdout);
  assert.match(dry.stdout,/KYTY_UPSCALER=fsr/);
  assert.match(dry.stdout,/KYTY_READ_GUARD=1/);
});
test('Presets are actual graphics settings and preserve RAM16',()=>{
  const base={...lib.defaults,ram16_backing:true,ram_diet:true,lowlatency:true};
  for(const [name,p] of Object.entries(lib.presets)){
    const next=lib.applyPreset(base,name);
    for(const key of Object.keys(p))assert.equal(next[key],p[key],name+':'+key);
    assert.equal(next.ram16_backing,true);
    assert.equal(next.ram_diet,true);
    assert.equal(lib.activePreset(next),name);
    const fg=lib.applyPreset({...base,framegen:2},name);
    assert.equal(fg.framegen,2,'Selecting '+name+' must not turn off frame generation');
    assert.equal(lib.activePreset(fg),name);
  }
  assert.equal(lib.activePreset({...base,upscaler:'dlss',framegen:3}),lib.activePreset({...base,upscaler:'dlss'}));
});
test('Settings migrate from PowerShell JSON and round-trip without touching real config',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kyty-electron-test-'));
  try{
    const s=lib.clean({...lib.defaults,game:'C:\\Games\\DMSR',ram16_backing:true,ram_diet:true,render_dlss:1152});
    lib.saveSettings(dir,s);
    assert.deepEqual(lib.loadSettings(dir),s);
    fs.writeFileSync(path.join(dir,'launcher-settings.json'),'\uFEFF'+JSON.stringify(s));
    assert.deepEqual(lib.loadSettings(dir),s);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('Four resolution-based presets change the actual emulator command',{skip:!localReady},()=>{
  // Validate the graphics presets independently of the player's saved Frame Generation mode.
  // A real user can have framegen=2 (DLSS-G 2x); preset selection must not silently disable it.
  const base=lib.clean({...lib.loadSettings(root),framegen:0,ram_safety:false});
  for(const [name,p] of Object.entries(lib.presets)){
    const s=lib.applyPreset(base,name);
    const cmd=lib.buildPlayArgs(root,s);
    const a=cmd.args;
    assert.equal(a[a.indexOf('-RenderHeight')+1],String(p.render_dlss),name);
    assert.ok(a.includes('-Upscaler'),name+' DLSS');
    if(name==='Performance'||name==='Ultra Performance') {
      assert.equal(a[a.indexOf('-Quality')+1],'lowest');
      assert.equal(a[a.indexOf('-TextureReduce')+1],'2');
    } else if(name==='Balanced') {
      assert.equal(a[a.indexOf('-Quality')+1],'low');
      assert.equal(a[a.indexOf('-TextureReduce')+1],'1');
    } else {
      assert.equal(a.includes('-Quality'),false);
      assert.equal(a.includes('-TextureReduce'),false);
    }
    assert.equal(a.includes('-FrameGen'),false,name);
    assert.equal(a.includes('-Fsr'),false,name);
    assert.match(a[a.indexOf('-Set')+1],/KYTY_BACKING_FILE=1/);
    assert.match(a[a.indexOf('-Set')+1],/KYTY_RAM_DIET=1/);
    assert.match(cmd.command.toLowerCase(),/powershell\.exe$/);
    assert.ok(a.includes('-Follow'));
  }
});
test('chenxiao07 1080p game output works with DLSS and preserves explicit 4K output',{skip:!localReady},()=>{
  const base={...lib.loadSettings(root),ram_safety:false};
  const hd=lib.clean({...base,upscaler:'dlss',output:'1080p',render_dlss:720,framegen:2});
  const args=lib.buildPlayArgs(root,hd).args;
  assert.equal(args[args.indexOf('-RenderHeight')+1],'720');
  assert.equal(args[args.indexOf('-Upscaler')+1],'dlss');
  assert.equal(args[args.indexOf('-FrameGen')+1],'1');
  assert.ok(args.includes('-HdOutput'),'DLSS and HD output may be enabled together');
  assert.match(args[args.indexOf('-Exe')+1],/windows-chenxiao.*kyty_emulator\.exe$/i,
    'Experimental HD+DLSS must use the isolated emulator');
  assert.equal(lib.clean({...hd,render_dlss:1440}).render_dlss,1080,'HD output clamps rendering to 1080');
  assert.throws(()=>lib.buildPlayArgs(root,{...hd,ratio:'21:9'}),/16:9 only/);
  const normal=lib.buildPlayArgs(root,{...base,upscaler:'dlss',output:'4k',render_dlss:1152});
  assert.ok(!normal.args.includes('-HdOutput'),'1440p window retains 4K game output by default');
  assert.equal(normal.args[normal.args.indexOf('-RenderHeight')+1],'1152');
  assert.equal(lib.applyPreset({...base,framegen:2},'Ultra Performance').render_dlss,720);
});
test('DLSS-G 2x survives graphics preset and reaches PowerShell as -FrameGen 1',{skip:!localReady},()=>{
  const cfg=lib.applyPreset({...lib.loadSettings(root),framegen:2,ram_safety:false},'Performance');
  const spec=lib.buildPlayArgs(root,cfg);
  assert.equal(spec.args[spec.args.indexOf('-FrameGen')+1],'1');
  assert.equal(spec.args[spec.args.indexOf('-Upscaler')+1],'dlss');
  assert.equal(spec.args[spec.args.indexOf('-RenderHeight')+1],'1080');
  assert.ok(spec.args.includes('-StreamlineDir'));
  const result=spawnSync(spec.command,[...spec.args,'-DryRun'],{cwd:root,encoding:'utf8',timeout:40000,windowsHide:true});
  assert.equal(result.status,0,result.stderr||result.stdout);
  assert.match(result.stdout,/KYTY_FRAMEGEN=1/);
  assert.match(result.stdout,/KYTY_UPSCALER=dlss/);
  assert.match(result.stdout,/KYTY_STREAMLINE_DIR=/);
});
test('Missing emulator or missing game does not falsely report success',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kyty-noexe-'));
  try{assert.throws(()=>lib.buildPlayArgs(dir,lib.defaults),/executable not found/);}
  finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('Real run-windows.ps1 accepts Electron Play settings in DryRun',{skip:!localReady},()=>{
  const s=lib.applyPreset({...lib.loadSettings(root),ram_safety:false},'Performance');
  const spec=lib.buildPlayArgs(root,s);
  const result=spawnSync(spec.command,[...spec.args,'-DryRun'],{cwd:root,encoding:'utf8',windowsHide:true,timeout:40000});
  assert.equal(result.status,0,result.stderr || result.error?.message || result.stdout);
  assert.match(result.stdout,/KYTY_RAM_DIET=1/);
  assert.match(result.stdout,/KYTY_BACKING_FILE=1/);
  assert.match(result.stdout,/--screen-width 2560/);
  assert.match(result.stdout,/KYTY_RENDER_HEIGHT=1080/);
  assert.match(result.stdout,/KYTY_UPSCALER=dlss/);
  assert.match(result.stdout,/KYTY_TEXTURE_REDUCE=2/);
});
test('Shader updater is explicitly incremental and reuses the existing utility',{skip:!localReady},()=>{
  const s=lib.loadSettings(root);
  const {args}=lib.buildPrecompileArgs(root,s);
  assert.ok(args.includes('-Incremental'));
  assert.ok(args.includes('-Exe'));
  assert.equal(args.includes('-ReplaceCache'),false);
  assert.equal(args.includes('-RefreshSeeds'),false);
});
