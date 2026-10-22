'use strict';
// Local Discord RPC IPC, deliberately no third-party package or Discord access token.
// Each game session owns its own detached agent: closing Electron does not clear Discord.
const net=require('node:net');
const {EventEmitter}=require('node:events');
const {randomUUID}=require('node:crypto');

const APP_ID_RE=/^[0-9]{17,20}$/;
const IMAGE_RE=/^[a-z0-9][a-z0-9_-]{0,63}$/i;
const MAX_FRAME=1024*1024;
const RETRY_MS=15000;
const READY_MS=6000;

function validConfig(value){
  return {enabled:value?.discord_presence===true,
    appId:typeof value?.discord_app_id==='string'?value.discord_app_id.trim():'',
    image:typeof value?.discord_large_image==='string'?value.discord_large_image.trim():''};
}
function isConfigured(value){
  const c=validConfig(value);
  return c.enabled&&APP_ID_RE.test(c.appId)&&(!c.image||IMAGE_RE.test(c.image));
}
function frame(opcode,data){
  const bytes=Buffer.from(JSON.stringify(data),'utf8');
  const header=Buffer.allocUnsafe(8);
  header.writeUInt32LE(opcode,0);
  header.writeUInt32LE(bytes.length,4);
  return Buffer.concat([header,bytes]);
}
class FrameDecoder{
  constructor(callback){this.buffer=Buffer.alloc(0);this.callback=callback;}
  feed(chunk){
    if(chunk.length>MAX_FRAME)throw Error('Discord IPC payload too large');
    this.buffer=Buffer.concat([this.buffer,chunk]);
    if(this.buffer.length>MAX_FRAME+8)throw Error('Discord IPC buffer exceeded limit');
    while(this.buffer.length>=8){
      const opcode=this.buffer.readUInt32LE(0),length=this.buffer.readUInt32LE(4);
      if(length>MAX_FRAME)throw Error('Discord IPC frame too large');
      if(this.buffer.length<8+length)return;
      const message=this.buffer.subarray(8,8+length);
      this.buffer=this.buffer.subarray(8+length);
      this.callback(opcode,message.length?JSON.parse(message.toString('utf8')):{});
    }
  }
}
function pipePath(index){return String.raw`\\?\pipe\discord-ipc-`+index;}
function readGamePid(output){
  const match=String(output).match(/(?:^|[\r\n])pid\s+(\d+);\s*logs:/);
  const pid=match?Number(match[1]):0;
  return Number.isSafeInteger(pid)&&pid>0&&pid<=0x7fffffff?pid:null;
}
function activityForLauncher(startedAt,image){
  const activity={
    type:0,
    details:'Running KytyPS5',
    state:'In launcher • Ready to play',
    timestamps:{start:Math.floor(startedAt/1000)}
  };
  if(image)activity.assets={large_image:image,large_text:"Demon's Souls Remake • KytyPS5"};
  return activity;
}
function activityForGame(startedAt,image){
  const activity={
    type:0,
    details:"Running KytyPS5",
    state:"Playing Demon's Souls Remake",
    timestamps:{start:Math.floor(startedAt/1000)}
  };
  if(image)activity.assets={large_image:image,large_text:"Demon's Souls Remake • KytyPS5"};
  return activity;
}
// A single connection retries while the owning game process exists, even if Discord starts later.
class DiscordPresence extends EventEmitter{
  constructor({appId,image='',mode='game',startedAt=Date.now(),connect=net.createConnection,retryMs=RETRY_MS}){
    super();
    if(!APP_ID_RE.test(appId))throw Error('Invalid Discord Application ID');
    if(image&&!IMAGE_RE.test(image))throw Error('Invalid Discord image asset key');
    if(!['launcher','game'].includes(mode))throw Error('Invalid Discord activity mode');
    this.appId=appId;this.image=image;this.mode=mode;this.startedAt=startedAt;this.connect=connect;
    this.retryMs=retryMs;this.active=false;this.socket=null;this.timer=null;
    this.readyTimer=null;this.connected=false;this.generation=0;
    this.lastError=null;
  }
  start(){if(this.active)return;this.active=true;this._try();}
  _try(){
    if(!this.active)return;
    const generation=++this.generation;
    let index=0;
    const attempt=()=>{
      if(!this.active||generation!==this.generation)return;
      if(index>=10){this._schedule();return;}
      const pipe=pipePath(index++);
      let socket;
      try{socket=this.connect(pipe);}
      catch(e){this.lastError=e;attempt();return;}
      this.socket=socket;
      let reachedReady=false,finished=false,activityNonce=null;
      const next=()=>{
        if(finished)return;finished=true;
        clearTimeout(this.readyTimer);this.readyTimer=null;
        this.connected=false;
        if(this.socket===socket)this.socket=null;
        socket.destroy();
        if(!this.active||generation!==this.generation)return;
        if(reachedReady)this._schedule();
        else attempt();
      };
      const decoder=new FrameDecoder((opcode,payload)=>{
        if(opcode===3){socket.write(frame(4,payload));return;}
        if(opcode===2){next();return;}
        if(opcode!==1)return;
        if(payload.evt==='ERROR'){this.lastError=new Error(payload.data?.message||'Discord RPC error');this.emit('rejected',this.lastError.message);next();return;}
        if(payload.cmd==='SET_ACTIVITY'&&activityNonce&&payload.nonce===activityNonce){
          this.emit('published',this.mode);
          activityNonce=null;
          return;
        }
        if(payload.evt==='READY'&&!reachedReady){
          reachedReady=true;this.connected=true;
          clearTimeout(this.readyTimer);this.readyTimer=null;
          activityNonce=randomUUID();
          socket.write(frame(1,{
            cmd:'SET_ACTIVITY',
            nonce:activityNonce,
            args:{pid:process.pid,activity:this.mode==='launcher'?
              activityForLauncher(this.startedAt,this.image):activityForGame(this.startedAt,this.image)}
          }));
          this.emit('connected');
        }
      });
      socket.on('connect',()=>{
        socket.write(frame(0,{v:1,client_id:this.appId}));
        this.readyTimer=setTimeout(()=>{this.lastError=new Error('Discord IPC ready timeout');next();},READY_MS);
      });
      socket.on('data',data=>{try{decoder.feed(data);}catch(e){this.lastError=e;next();}});
      socket.on('error',e=>{this.lastError=e;next();});
      socket.on('close',()=>next());
    };
    attempt();
  }
  _schedule(){
    if(!this.active)return;
    this.emit('retrying',this.lastError?.code||this.lastError?.message||'Discord IPC endpoint unavailable');
    clearTimeout(this.timer);
    this.timer=setTimeout(()=>{this.timer=null;this._try();},this.retryMs);
  }
  stop(){
    this.active=false;this.generation++;
    clearTimeout(this.timer);clearTimeout(this.readyTimer);
    this.timer=null;this.readyTimer=null;
    if(this.socket){
      const socket=this.socket;this.socket=null;
      if(this.connected){
        try{socket.write(frame(1,{cmd:'SET_ACTIVITY',nonce:randomUUID(),args:{pid:process.pid,activity:null}}));}catch{}
      }
      socket.end();setTimeout(()=>socket.destroy(),250).unref();
    }
    this.connected=false;
  }
}
module.exports={DiscordPresence,APP_ID_RE,IMAGE_RE,validConfig,isConfigured,frame,FrameDecoder,activityForGame,activityForLauncher,pipePath,readGamePid};
