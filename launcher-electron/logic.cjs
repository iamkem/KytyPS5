'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const defaults = Object.freeze({
  game: '', resolution: '2560x1440', fullscreen: false, aspect: true, language: 1,
  redzone: true, cheats: false, ecores: false, fps120: false, render: 1440,
  ratio: '16:9', quality: 'standard', distance_detail: 'original', distance_tessellation: 'original', vsync: false, hdr: false, framegen: 0,
  hud: 1, streamline: '', safegpu: false, upscaler: 'dlss', render_dlss: 1152,
  fsr: false, output: '4k', shader_mode: 'standard', scene_benchmark: false, lowlatency: true, present_direct: false, antilag: false,
  fps30: false, dlss_model: 'auto', gpu: '',
  ram_diet: true, ram16_backing: true, ram_safety: true, vram_budget_mb: 0,
  discord_presence: false, discord_app_id: '', discord_large_image: ''
});
// Actual internal render resolution at 16:9. Display resolution is independent.
const presets = Object.freeze({
  'Ultra Performance': Object.freeze({render_dlss:720,quality:'lowest',fsr:false,output:'4k',upscaler:'dlss'}),
  Performance: Object.freeze({render_dlss:1080,quality:'lowest',fsr:false,output:'4k',upscaler:'dlss'}),
  Balanced: Object.freeze({render_dlss:1152,quality:'low',fsr:false,output:'4k',upscaler:'dlss'}),
  Quality: Object.freeze({render_dlss:1440,quality:'standard',fsr:false,output:'4k',upscaler:'dlss'})
});
const booleanKeys = ['fullscreen','aspect','redzone','cheats','ecores','fps120','vsync','hdr','fsr','safegpu','lowlatency','present_direct','antilag','ram_diet','ram16_backing','ram_safety','fps30','discord_presence','scene_benchmark'];
const numericKeys = ['language','render','render_dlss','framegen','hud','vram_budget_mb'];
function clean(candidate = {}) {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) throw Error('Invalid settings object');
  const result = {...defaults};
  for (const key of Object.keys(defaults)) {
    if (!Object.prototype.hasOwnProperty.call(candidate, key)) continue;
    const value = candidate[key];
    if (booleanKeys.includes(key)) result[key] = Boolean(value);
    else if (numericKeys.includes(key)) {
      if (Number.isInteger(value) && value >= 0 && value <= 65536) result[key] = value;
    } else if (typeof value === 'string' && value.length < 4096) result[key] = value;
  }
  if (!['standard','low','lowest'].includes(result.quality)) result.quality = 'standard';
  if (!['standard','experimental'].includes(result.shader_mode)) result.shader_mode = 'standard';
  if (!['original','balanced','performance','aggressive'].includes(result.distance_detail)) result.distance_detail = 'original';
  if (!['original','early'].includes(result.distance_tessellation)) result.distance_tessellation = 'original';
  if (!['16:9','21:9','32:9'].includes(result.ratio)) result.ratio = '16:9';
  if (!['dlss','fsr',''].includes(result.upscaler)) result.upscaler = '';
  if (!['auto','K','E'].includes(result.dlss_model)) result.dlss_model = 'auto';
  if (!/^[a-zA-Z0-9 ._-]{0,80}$/.test(result.gpu)) result.gpu = '';
  if (!['4k','1440p','1080p'].includes(result.output)) result.output = '4k';
  if (!['1280x720','1920x1080','2560x1440','3840x2160','2560x1080','3440x1440','3840x1600','5120x2160','3840x1080','5120x1440','7680x2160'].includes(result.resolution)) result.resolution = '2560x1440';
  if (![0,4096,6144,8192,10240].includes(result.vram_budget_mb)) result.vram_budget_mb = 0;
  if (result.render_dlss < (result.output === '1080p' ? 360 : 720) || result.render_dlss > 2160) result.render_dlss = 1152;
  if (result.render < 720 || result.render > 2160) result.render = 1440;
  // The HD game output cannot render above its own 1080-line output.
  if (result.output === '1080p') {
    result.render = Math.min(result.render, 1080);
    result.render_dlss = Math.min(result.render_dlss, 1080);
  }
  if (result.framegen > 6) result.framegen = 0;
  if (result.hud > 2) result.hud = 0;
  if (result.language > 29) result.language = 1;
  if (!/^\d{17,20}$/.test(result.discord_app_id)) result.discord_app_id = '';
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(result.discord_large_image)) result.discord_large_image = '';
  return result;
}
function loadSettings(root) {
  const file = process.env.KYTY_LAUNCHER_SMOKE_CONFIG || path.join(root, 'launcher-settings.json');
  let user = {};
  if (fs.existsSync(file)) {
    user = JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
  }
  const settings = clean(user);
  if (!settings.game) {
    const last = path.join(root,'game-path.txt');
    if (fs.existsSync(last)) settings.game = fs.readFileSync(last,'utf8').trim();
  }
  return settings;
}
function saveSettings(root, raw) {
  const cleanSettings = clean(raw);
  const file = process.env.KYTY_LAUNCHER_SMOKE_CONFIG || path.join(root,'launcher-settings.json');
  const temp = file + '.electron.tmp';
  fs.writeFileSync(temp,JSON.stringify(cleanSettings,null,2) + '\n','utf8');
  fs.renameSync(temp,file);
  return cleanSettings;
}
function applyPreset(settings, name) {
  if (!(name in presets)) throw Error('Unknown preset: '+name);
  return clean({...settings, ...presets[name]});
}
function activePreset(settings) {
  const s = clean(settings);
  for (const [name, desired] of Object.entries(presets)) {
    if (Object.keys(desired).every(k => s[k] === desired[k])) return name;
  }
  return 'Custom';
}
function findEmulator(root) {
  return path.join(root,'_Build','latest','native-build','kyty_emulator.exe');
}
function findPrecompiler(root) {
  return path.join(root,'_Build','latest','native-build','kyty_shader_precompile.exe');
}
function findStreamline(settings,root) {
  const candidates = [settings.streamline, path.join(root,'streamline'), path.join(root,'_Build','deps','streamline','sdk')].filter(Boolean);
  for (const base of candidates) {
    for (const dir of [base,path.join(base,'bin','x64')]) {
      if (fs.existsSync(path.join(dir,'sl.interposer.dll'))) return dir;
    }
  }
  return '';
}
function gameImagePath(settings, filename='pic0.png') {
  const pathTo = path.join(settings.game,'sce_sys',filename);
  return fs.existsSync(pathTo) ? pathTo : '';
}
function gameValid(settings) {
  return Boolean(settings.game && (fs.existsSync(path.join(settings.game,'eboot.bin')) ||
    (settings.game.toLowerCase().endsWith('.zar') && fs.existsSync(settings.game))));
}
function buildPlayArgs(root, raw, {inspectTrial = require('./shader-trial.cjs').inspect} = {}) {
  const s = clean(raw);
  if (s.fps30 && s.fps120) throw Error('Choose either 30 FPS lock or up to 120 FPS, not both.');
  const exe = findEmulator(root);
  if (!fs.existsSync(exe)) throw Error('Latest Kyty native build is missing (_Build/latest/native-build/kyty_emulator.exe).');
  if (!gameValid(s)) throw Error('Game not found. Choose a folder containing eboot.bin and sce_sys.');
  if (s.shader_mode === 'experimental') {
    const trial = inspectTrial(root, s.game, exe);
    if (!trial.ready) {
      const error = Error('Experimental shader 0x3 unavailable: ' + trial.reason);
      error.code = 'SHADER_TRIAL_NOT_READY';
      throw error;
    }
  }
  const [width,height] = s.resolution.split('x');
  const args = ['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'run-windows.ps1'),
    '-Follow','-Exe',exe,'-Game',s.game,'-Width',width,'-Height',height,'-Language',String(s.language)];
  if (s.shader_mode === 'experimental') args.push('-ShaderFeatureTrial');
  // No inherited/configured native live-control command source in ordinary or Steam Play.
  args.push('-DisableLiveControl');
  if (s.fullscreen) { args.push('-Fullscreen'); if (s.aspect && s.ratio === '16:9') args.push('-AspectFit'); }
  if (!s.redzone) args.push('-NoRedZone');
  if (s.fps120) args.push('-Fps120');
  if (s.vsync) args.push('-PresentMode','Fifo');
  if (s.lowlatency || s.antilag) args.push('-LowLatency');
  if (s.hdr) args.push('-Hdr');
  if (s.ratio !== '16:9') args.push('-Aspect',s.ratio);
  const upscale = s.upscaler === 'dlss' && Boolean(findStreamline(s,root));
  const fsrUpscale = s.upscaler === 'fsr';
  const rh = (upscale || fsrUpscale) ? s.render_dlss : s.render;
  args.push('-RenderHeight',String(rh));
  if (s.quality === 'low' || s.quality === 'lowest') {
    args.push('-Quality',s.quality,'-TextureReduce',s.quality === 'lowest' ? '2' : '1');
  }
  if (s.fsr) args.push('-Fsr');
  if (!s.fsr && s.framegen >= 2) args.push('-FrameGen',String(s.framegen-1));
  if (upscale) args.push('-Upscaler','dlss');
  // FSR 3 uses KYTY_UPSCALER=fsr with the source-matched Windows runner.
  // The upstream PS5 Pro path supports DLSS directly into the game's 1080p output.
  // A 1080p game output is 16:9 only; 4K remains the default for existing settings.
  if (s.output === '1080p') {
    if (s.ratio !== '16:9') throw Error('Game Output 1080p supports 16:9 only. Choose 4K for ultrawide.');
    args.push('-HdOutput');
  }
  if ((upscale || (!s.fsr && s.framegen >= 2))) {
    const dir = findStreamline(s,root);
    if (!dir) throw Error('NVIDIA Streamline runtime not found.');
    args.push('-StreamlineDir',dir);
  }
  if (s.cheats) {
    const param = path.join(s.game,'sce_sys','param.json');
    if (fs.existsSync(param)) {
      const id = JSON.parse(fs.readFileSync(param,'utf8').replace(/^\uFEFF/,'')).titleId;
      const patch = path.join(root,'_Patches',id + '.json');
      if (fs.existsSync(patch)) args.push('-Patch',patch);
    }
  }
  const vars = [];
  if (s.hud) vars.push('KYTY_FPS_HUD='+s.hud);
  if (s.safegpu) vars.push('KYTY_COMPUTE_CHAIN=0');
  if (s.present_direct) vars.push('KYTY_PRESENT_DIRECT=1');
  if (s.antilag) vars.push('KYTY_ANTI_LAG=1');
  if (s.ram_diet) vars.push('KYTY_RAM_DIET=1');
  // Always pass Original explicitly too: it clears a stale KYTY_DISTANCE_DETAIL
  // inherited from Windows/the runner's JSON. Do not add a new PowerShell
  // parameter: packaged launchers use the unchanged main run-windows.ps1.
  vars.push('KYTY_DISTANCE_DETAIL='+s.distance_detail);
  // Disabled explicitly by default; opt-in source-profile experiment only.
  // Native additionally restricts this to PPSA01341 v1.07 with an exact source line.
  vars.push('KYTY_DISTANCE_TESSELLATION='+s.distance_tessellation);
  // Use chenxiao's native PAGE_GUARD policy by physical RAM capacity (<=20 GiB).
  // Do not force KYTY_READ_GUARD=1 on machines with more than 20 GiB RAM.
  // The failed texture offload experiment is disabled, without destructive discard.
  vars.push('KYTY_TEXTURE_OFFLOAD=0','KYTY_TEXTURE_OFFLOAD_PROBE=0');
  if (fsrUpscale) vars.push('KYTY_UPSCALER=fsr');
  if (s.gpu) vars.push('KYTY_GPU='+s.gpu);
  if (s.fps30) vars.push('KYTY_FLIP_RATE=1');
  if (upscale && s.dlss_model !== 'auto') vars.push('KYTY_DLSS_PRESET='+s.dlss_model);
  if (s.output === '1440p') vars.push('KYTY_OUTPUT_HEIGHT=1440');
  if (s.ram16_backing) vars.push('KYTY_BACKING_FILE=1','KYTY_BACKING_ON_DEMAND=1');
  if (s.ram_safety) {
    // Guard only background shader work; on-demand gameplay shader compilation still runs.
    // The native prefetch worker already observes available physical RAM at each group boundary.
    vars.push('KYTY_ADAPTIVE_RAM=1','KYTY_PREFETCH_MIN_AVAIL_MB=4096',
      'KYTY_SHADER_PREFETCH_THREADS=1','KYTY_SHADER_FOLLOW_THREADS=1');
  }
  if (s.vram_budget_mb) vars.push('KYTY_VRAM_BUDGET_MB='+s.vram_budget_mb);
  if (vars.length) args.push('-Set',vars.join(','));
  return {command:path.join(process.env.SystemRoot || 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),args};
}
function buildPrecompileArgs(root,raw,option='-Incremental') {
  const s = clean(raw);
  if (!gameValid(s)) throw Error('Select your installed game first.');
  const exe = findPrecompiler(root);
  if (!fs.existsSync(exe)) throw Error('Latest shader precompile utility is missing.');
  return { command: path.join(process.env.SystemRoot || 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),
    args:['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'precompile-windows.ps1'), option,'-Exe',exe,'-Game',s.game,...(s.gpu?['-Gpu',s.gpu]:[])] };
}
module.exports = {defaults,presets,clean,loadSettings,saveSettings,applyPreset,activePreset,findEmulator,findPrecompiler,findStreamline,gameImagePath,gameValid,buildPlayArgs,buildPrecompileArgs};
