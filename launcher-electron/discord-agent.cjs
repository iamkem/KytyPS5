'use strict';
// Independent game-scoped Discord Rich Presence helper.
// When the launcher quits, this stays alive only as long as the actual game process is alive.
const fs=require('node:fs');
const path=require('node:path');
const {DiscordPresence,APP_ID_RE,IMAGE_RE}=require('./discord-presence.cjs');

function getOptions(argv){
  const values={};
  for(let i=0;i<argv.length;i+=2){
    if(!/^--[a-z-]+$/.test(argv[i])||typeof argv[i+1]!=='string')
      throw Error('Invalid agent argument');
    values[argv[i].slice(2)]=argv[i+1];
  }
  const watchPid=Number(values['watch-pid']);
  if(!Number.isSafeInteger(watchPid)||watchPid<=0||watchPid>0x7FFFFFFF)
    throw Error('Invalid game supervisor PID');
  const appId=values['app-id'];
  if(!APP_ID_RE.test(appId))throw Error('Discord Application ID must be 17–20 digits');
  const image=values.image||'';
  if(image&&!IMAGE_RE.test(image))throw Error('Invalid Discord image key');
  return {watchPid,appId,image};
}
function pidAlive(pid){
  try{process.kill(pid,0);return true;}
  catch(e){return e.code==='EPERM';}
}
function startAgent(argv){
  const options=getOptions(argv);
  // Only the game supervisor process PID, game title and session timer are sent to Discord.
  if(!pidAlive(options.watchPid))return false;
  const service=new DiscordPresence({...options,startedAt:Date.now()});
  const timer=setInterval(()=>{
    if(!pidAlive(options.watchPid)){
      clearInterval(timer);
      service.stop();
      setTimeout(()=>process.exit(0),350).unref();
    }
  },2000);
  timer.unref?.();
  // Keep this process alive while monitoring even when Discord is not currently running.
  // Unref socket retry timer is intentionally not used: this timeout guarantees an agent heartbeat.
  const hold=setInterval(()=>{},60000);
  const close=()=>{clearInterval(hold);clearInterval(timer);service.stop();};
  process.once('SIGTERM',close);
  process.once('SIGINT',close);
  service.start();
  return true;
}
if(require.main===module){
  try{if(!startAgent(process.argv.slice(2)))process.exit(0);}
  catch(e){console.error('Discord agent:',e.message);process.exit(1);}
}
module.exports={getOptions,pidAlive,startAgent};
