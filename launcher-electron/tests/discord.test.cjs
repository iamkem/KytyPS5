'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const net=require('node:net');
const {spawnSync}=require('node:child_process');
const {DiscordPresence,frame,FrameDecoder,activityForGame,activityForLauncher,pipePath,isConfigured,readGamePid}=require('../discord-presence.cjs');
const {getOptions,pidAlive}=require('../discord-agent.cjs');
const logic=require('../logic.cjs');
function waitUntil(fn,ms=3000){
  return new Promise((resolve,reject)=>{
    const until=Date.now()+ms;
    const loop=()=>{
      const result=fn();
      if(result)return resolve(result);
      if(Date.now()>until)return reject(Error('Discord test did not reach expected state'));
      setTimeout(loop,15);
    };
    loop();
  });
}
test('Discord is opt-in, keeps a valid Application ID and can be switched off',()=>{
  const s=logic.clean({...logic.defaults,discord_presence:true,discord_app_id:'123456789012345678',
    discord_large_image:'demons_souls'});
  assert.equal(isConfigured(s),true);
  assert.equal(s.discord_presence,true);
  assert.equal(s.discord_app_id,'123456789012345678');
  assert.equal(isConfigured({...s,discord_presence:false}),false);
  assert.equal(isConfigured({...s,discord_app_id:'not_an_id'}),false);
  assert.equal(logic.clean({...s,discord_app_id:'fake'}).discord_app_id,'');
});
test('Discord configuration is JSON-only: saved graphics changes preserve Presence settings',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kyty-presence-json-'));
  try{
    const config={
      ...logic.defaults,
      game:'C:\\Games\\DMSR',
      discord_presence:true,
      discord_app_id:'123456789012345678',
      discord_large_image:'demons_souls',
      render_dlss:1152
    };
    fs.writeFileSync(path.join(dir,'launcher-settings.json'),JSON.stringify(config,null,2));
    const loaded=logic.loadSettings(dir);
    assert.equal(isConfigured(loaded),true);
    const changed=logic.applyPreset(loaded,'Performance');
    logic.saveSettings(dir,changed);
    const saved=JSON.parse(fs.readFileSync(path.join(dir,'launcher-settings.json'),'utf8'));
    assert.equal(saved.discord_presence,true);
    assert.equal(saved.discord_app_id,config.discord_app_id);
    assert.equal(saved.discord_large_image,config.discord_large_image);
    assert.equal(saved.render_dlss,1080);
    saved.discord_presence=false;
    fs.writeFileSync(path.join(dir,'launcher-settings.json'),JSON.stringify(saved));
    assert.equal(isConfigured(logic.loadSettings(dir)),false);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('No Discord tab, form, or settings controls remain in Electron UI',()=>{
  const base=path.resolve(__dirname,'..');
  const html=fs.readFileSync(path.join(base,'options.html'),'utf8');
  const js=fs.readFileSync(path.join(base,'options.js'),'utf8');
  const preload=fs.readFileSync(path.join(base,'preload.cjs'),'utf8');
  assert.doesNotMatch(html,/(?:data-tab="discord"|id="tab-discord"|id="discord-(?:presence|app-id|image|dev-portal)")/);
  assert.doesNotMatch(js,/(?:discordHint|discordValidated|discord-presence|discord-app-id|discord-dev-portal)/);
  assert.doesNotMatch(preload,/openDiscordDevelopers/);
  assert.equal((html.match(/class="(?:current\s+)?(?:tab-strip)/g)||[]).length,1);
  assert.equal((html.match(/data-tab="/g)||[]).length,4);
});
test('Rich Presence displays KytyPS5 and Demons Souls with session timer',()=>{
  const a=activityForGame(1729600000500,'demons_souls');
  assert.equal(a.details,'Running KytyPS5');
  assert.equal(a.state,"Playing Demon's Souls Remake");
  assert.equal(a.timestamps.start,1729600000);
  assert.equal(a.assets.large_image,'demons_souls');
  assert.equal(activityForGame(1729600000500,'').assets,undefined);
  assert.match(pipePath(0),/discord-ipc-0$/);
});
test('Opening the launcher publishes KytyPS5 idle status; Play status is distinct',()=>{
  const idle=activityForLauncher(1729600000500,'playstation');
  const game=activityForGame(1729600000500,'playstation');
  assert.equal(idle.details,'Running KytyPS5');
  assert.match(idle.state,/In launcher/);
  assert.equal(game.state,"Playing Demon's Souls Remake");
  assert.equal(idle.assets.large_image,'playstation');
  assert.equal(idle.timestamps.start,1729600000);
});
test('Launcher process receives confirmed Discord activity before game launch',async()=>{
  const requests=[];const sockets=new Set();
  const server=net.createServer(socket=>{
    sockets.add(socket);
    const decoder=new FrameDecoder((op,data)=>{
      if(op===0)socket.write(frame(1,{evt:'READY',data:{}}));
      if(op===1&&data.cmd==='SET_ACTIVITY'){
        requests.push(data);
        socket.write(frame(1,{cmd:'SET_ACTIVITY',nonce:data.nonce,data:{}}));
      }
    });
    socket.on('data',buffer=>decoder.feed(buffer));
    socket.on('close',()=>sockets.delete(socket));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const client=new DiscordPresence({appId:'123456789012345678',mode:'launcher',image:'playstation',
    connect:()=>net.createConnection(server.address().port,'127.0.0.1'),retryMs:100});
  const statuses=[];
  client.on('published',mode=>statuses.push(mode));
  try{
    client.start();
    await waitUntil(()=>statuses.includes('launcher'));
    assert.equal(requests[0].args.activity.details,'Running KytyPS5');
    assert.match(requests[0].args.activity.state,/In launcher/);
    client.stop();
    await waitUntil(()=>requests.some(p=>p.args.activity===null));
  }finally{
    client.stop();for(const socket of sockets)socket.destroy();
    await new Promise(resolve=>server.close(resolve));
  }
});
test('RPC wire format handles fragmented frames and rejects malformed frames',()=>{
  const seen=[];
  const d=new FrameDecoder((op,payload)=>seen.push({op,payload}));
  const bytes=frame(0,{v:1,client_id:'123456789012345678'});
  d.feed(bytes.subarray(0,3));d.feed(bytes.subarray(3,9));d.feed(bytes.subarray(9));
  assert.deepEqual(seen,[{op:0,payload:{v:1,client_id:'123456789012345678'}}]);
  const huge=Buffer.alloc(8);huge.writeUInt32LE(1,0);huge.writeUInt32LE(1024*1024+1,4);
  assert.throws(()=>d.feed(huge),/too large/);
});
test('Presence waits for real KytyPS5 emulator PID in startup output',()=>{
  assert.equal(readGamePid('startup: loading game\r\npid 33977; logs: _Build\\run-logs\\game.log\r\n'),33977);
  assert.equal(readGamePid('startup only, game failed'),null);
  assert.equal(readGamePid('pid x; logs: crash'),null);
  assert.equal(readGamePid('loading\r\npid 12345; logs: game started'),12345);
});
test('Agent validates supervising PID and presence settings',()=>{
  const cfg=getOptions(['--watch-pid',String(process.pid),'--app-id','123456789012345678','--image','demons_souls']);
  assert.equal(cfg.watchPid,process.pid);
  assert.equal(pidAlive(process.pid),true);
  assert.throws(()=>getOptions(['--watch-pid','abc','--app-id',cfg.appId]),/PID/);
  assert.throws(()=>getOptions(['--watch-pid','55','--app-id','no']),/Application ID/);
});
test('Discord RPC connection sets activity and clears on stop; no network or real Discord needed',async()=>{
  const requests=[];const sockets=new Set();
  const server=net.createServer(socket=>{
    sockets.add(socket);const decoder=new FrameDecoder((opcode,payload)=>{
      requests.push({opcode,payload});
      if(opcode===0)socket.write(frame(1,{evt:'READY',data:{}}));
      if(opcode===1&&payload.cmd==='SET_ACTIVITY'){
        socket.write(frame(1,{cmd:'SET_ACTIVITY',nonce:payload.nonce,data:{}}));
      }
    });
    socket.on('data',chunk=>decoder.feed(chunk));
    socket.on('close',()=>sockets.delete(socket));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const client=new DiscordPresence({appId:'123456789012345678',image:'demons_souls',
    connect:()=>net.createConnection(server.address().port,'127.0.0.1'),
    retryMs:100});
  try{
    client.start();
    const activity=await waitUntil(()=>requests.find(x=>x.payload?.args?.activity?.details==='Running KytyPS5'));
    assert.equal(activity.payload.args.activity.state,"Playing Demon's Souls Remake");
    assert.equal(activity.payload.args.pid,process.pid);
    client.stop();
    await waitUntil(()=>requests.find(x=>x.payload?.args?.activity===null));
  }finally{
    client.stop();for(const socket of sockets)socket.destroy();
    await new Promise(resolve=>server.close(resolve));
  }
});
