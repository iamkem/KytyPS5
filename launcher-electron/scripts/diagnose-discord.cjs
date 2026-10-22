'use strict';
const net=require('node:net');
const path=require('node:path');
const {frame,FrameDecoder,pipePath,isConfigured,activityForGame,activityForLauncher}=require('../discord-presence.cjs');
const logic=require('../logic.cjs');
const root=path.resolve(__dirname,'..','..');
const cfg=logic.loadSettings(root);
if(!isConfigured(cfg)){console.error('CONFIG_NOT_READY');process.exit(2);}
const send=process.argv.includes('--activity');
const noImage=process.argv.includes('--no-image');
const name=send?'DISCORD_ACTIVITY_PROBE':'DISCORD_HANDSHAKE_PROBE';
async function pipe(index){
 return new Promise(resolve=>{
  const socket=net.createConnection(pipePath(index));
  let ended=false,ready=false,settled=false;
  const finish=(msg)=>{
   if(ended)return;ended=true;
   console.log(name+' '+msg);
   socket.destroy();
   resolve(msg);
  };
  const timer=setTimeout(()=>finish('TIMEOUT index='+index),2500);
  const done=(msg)=>{clearTimeout(timer);finish(msg);};
  const decoder=new FrameDecoder((opcode,payload)=>{
   if(opcode===2){done('REJECT index='+index+' '+JSON.stringify(payload));return;}
   if(opcode!==1)return;
   if(payload.evt==='ERROR'){
    done('ERROR index='+index+' '+JSON.stringify(payload));return;
   }
   if(payload.evt==='READY'&&!ready){
    ready=true;
    if(!send){done('READY index='+index);return;}
    const activity=process.argv.includes('--launcher')?activityForLauncher(Date.now(),''):activityForGame(Date.now(),'');
    if(!noImage&&cfg.discord_large_image)
       activity.assets={large_image:cfg.discord_large_image,large_text:"Demon's Souls Remake"};
    const nonce='diagnose-'+process.pid;
    socket.write(frame(1,{cmd:'SET_ACTIVITY',nonce,args:{pid:process.pid,activity}}));
    return;
   }
   if(payload.cmd==='SET_ACTIVITY'&&!settled){
    settled=true;
    const status=payload.evt==='ERROR'?'ERROR':'OK';
    const response='SET_ACTIVITY_'+status+' index='+index+' '+JSON.stringify(payload.data||{});
    // Clear our temporary test activity and then disconnect, never leave a fake running game.
    socket.write(frame(1,{cmd:'SET_ACTIVITY',nonce:'clear-'+process.pid,args:{pid:process.pid,activity:null}}));
    setTimeout(()=>done(response),450);
    return;
   }
  });
  socket.on('connect',()=>socket.write(frame(0,{v:1,client_id:cfg.discord_app_id})));
  socket.on('data',data=>{try{decoder.feed(data);}catch(e){done('DECODE_ERROR '+e.message);}});
  socket.on('error',e=>done('CONNECT_'+e.code+' index='+index));
  socket.on('close',()=>{if(!ended)done('CLOSED index='+index);});
 });
}
(async()=>{
 for(let i=0;i<10;i++){
  const result=await pipe(i);
  if(result.includes('READY')||result.includes('SET_ACTIVITY_')||result.includes('REJECT'))break;
 }
})().catch(e=>{console.error(e.stack);process.exitCode=2;});
