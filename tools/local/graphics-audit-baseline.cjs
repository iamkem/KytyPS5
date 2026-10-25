'use strict';
// Read-only audit of existing emulator run logs. SLOW Frame events are a
// threshold-filtered sample, NOT all presented frames or valid average FPS/1% low.
// No exec, writes, subprocesses, cache access, or emulator launches.
const fs=require('node:fs');
const path=require('node:path');
function parseSlowLine(line){
  const found=line.match(/\bSLOW Frame\s+(\d+(?:\.\d+)?)\s+ms\b/);
  if(!found) return null;
  const metrics={ms:Number(found[1])};
  for(const key of ['idle','cpu','compile','gpu_wait','record_wait','upload_wait']){
    const match=line.match(new RegExp('(?:^|\\s)'+key+'=(\\d+(?:\\.\\d+)?)\\b'));
    metrics[key]=match?Number(match[1]):null;
  }
  return metrics;
}
function rounded(value){return value==null?null:Math.round(value*10)/10;}
function percentile(data,fraction){
  if(!data.length)return null;
  const sorted=data.slice().sort((a,b)=>a-b);
  const index=Math.max(0,Math.ceil(sorted.length*fraction)-1);
  return rounded(sorted[index]);
}
function summarize(content){
  const lines=String(content).split(/\r?\n/);
  const frames=lines.map(parseSlowLine).filter(Boolean);
  const values=key=>frames.map(f=>f[key]).filter(v=>v!==null);
  const highIdle=frames.filter(f=>f.idle!==null&&f.idle/f.ms>=0.80).length;
  const compiled=frames.filter(f=>f.compile!==null&&f.compile>=10).length;
  const waits=frames.filter(f=>f.gpu_wait!==null&&f.gpu_wait>=10).length;
  const absent=frames.filter(f=>f.gpu_wait===null).length;
  const modes=lines.filter(x=>/Model\/Instance distance fading: EXPERIMENTAL|Graphics audit: tessellation density/.test(x)).slice(0,4).map(x=>x.trim().slice(0,120));
  return {
    slow_events:frames.length,
    median_slow_ms:percentile(values('ms'),0.5),
    p95_slow_ms:percentile(values('ms'),0.95),
    worst_slow_ms:percentile(values('ms'),1),
    high_idle_events_80pct:highIdle,
    compile_events_ge_10ms:compiled,
    gpu_wait_events_ge_10ms:waits,
    gpu_wait_not_reported_events:absent,
    max_compile_ms:percentile(values('compile'),1),
    observed_experiment_markers:modes,
    fps_average:null,
    fps_1pct_low:null,
    gpu_busy_ms:null
  };
}
function recentLogs(dir, limit=12){
  if(!Number.isInteger(limit)||limit<1||limit>200)throw Error('limit must be 1..200');
  return fs.readdirSync(dir,{withFileTypes:true})
    .filter(x=>x.isFile()&&/^\d{8}-\d{6}-\d{3}\.out\.log$/.test(x.name))
    .map(x=>x.name).sort().slice(-limit).map(x=>path.join(dir,x));
}
function audit(files){
  return {scope:'threshold-filtered SLOW Frame events only; NOT frame FPS, 1% low, or GPU utilization',
    sessions:files.map(name=>({file:path.basename(name),...summarize(fs.readFileSync(name,'utf8'))}))};
}
if(require.main===module){
  const args=process.argv.slice(2);
  if(args.some(x=>x==='--help')){
    process.stdout.write('Read-only usage: node tools/local/graphics-audit-baseline.cjs [--logs-dir DIR] [--recent 12]\n');
    process.exit(0);
  }
  function flag(key,fallback){
    const i=args.indexOf(key);
    if(i===-1)return fallback;
    if(i===args.length-1)throw Error('missing value for '+key);
    return args[i+1];
  }
  const dir=flag('--logs-dir',path.resolve(__dirname,'..','..','_Build','run-logs'));
  const count=Number(flag('--recent','12'));
  const report=audit(recentLogs(dir,count));
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
}
module.exports={parseSlowLine,percentile,summarize,recentLogs,audit};
