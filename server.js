const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3000;
app.use(express.static("public"));
app.get("/health", (_req,res)=>res.json({ok:true,players:players.size}));

const WORLD={w:2200,h:1500}, players=new Map(), bullets=new Map();
const COLORS=["#48c7a5","#e6b34c","#65a6ff","#ed7b62","#b18cff","#f08bc1"];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function send(ws,d){if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(d))}
function broadcast(d,except=null){const s=JSON.stringify(d);for(const [id,p] of players)if(id!==except&&p.ws.readyState===WebSocket.OPEN)p.ws.send(s)}
function publicPlayer(p){return {id:p.id,name:p.name,x:p.x,y:p.y,angle:p.angle,hp:p.hp,color:p.color,alive:p.alive,kills:p.kills,ammo:p.ammo,reserve:p.reserve}}
function cleanName(v){return String(v||"محارب").replace(/[<>]/g,"").trim().slice(0,18)||"محارب"}
function spawn(p){p.x=150+Math.random()*(WORLD.w-300);p.y=150+Math.random()*(WORLD.h-300);p.hp=100;p.ammo=30;p.reserve=120;p.alive=true}
function hitCheck(b){
  for(const p of players.values()){
    if(!p.alive||p.id===b.owner)continue;
    if(Math.hypot(p.x-b.x,p.y-b.y)<22){
      p.hp-=b.damage;
      if(p.hp<=0){p.hp=0;p.alive=false;const killer=players.get(b.owner);if(killer)killer.kills++;}
      broadcast({type:"hit",id:p.id,hp:p.hp,alive:p.alive,killer:b.owner});
      return true;
    }
  }
  return false;
}
function onMessage(p,raw){
  let m;try{m=JSON.parse(raw.toString())}catch{return}
  if(!m||typeof m.type!=="string")return;
  if(m.type==="move"&&p.alive){
    const x=Number(m.x),y=Number(m.y),a=Number(m.angle);
    if(![x,y,a].every(Number.isFinite))return;
    const now=Date.now(),dt=clamp((now-p.lastMove)/1000,0,.12),max=270*dt+12;
    const dx=x-p.x,dy=y-p.y,d=Math.hypot(dx,dy);
    if(d>max&&d>0){p.x+=dx/d*max;p.y+=dy/d*max}else{p.x=clamp(x,20,WORLD.w-20);p.y=clamp(y,20,WORLD.h-20)}
    p.angle=a;p.lastMove=now;
  }else if(m.type==="shoot"&&p.alive){
    const now=Date.now(),a=Number(m.angle);
    if(now-p.lastShot<190||p.ammo<=0||!Number.isFinite(a))return;
    p.lastShot=now;p.ammo--;
    const b={id:crypto.randomUUID(),owner:p.id,x:p.x+Math.cos(a)*20,y:p.y+Math.sin(a)*20,vx:Math.cos(a)*640,vy:Math.sin(a)*640,damage:25,life:1.15};
    bullets.set(b.id,b);broadcast({type:"bullet",bullet:b});send(p.ws,{type:"ammo",ammo:p.ammo,reserve:p.reserve});
  }else if(m.type==="reload"){
    const n=Math.min(30-p.ammo,p.reserve);p.ammo+=n;p.reserve-=n;send(p.ws,{type:"ammo",ammo:p.ammo,reserve:p.reserve});
  }else if(m.type==="respawn"&&!p.alive){spawn(p);send(p.ws,{type:"respawned",player:publicPlayer(p)})}
  else if(m.type==="name"){p.name=cleanName(m.name);broadcast({type:"playerUpdate",player:publicPlayer(p)})}
}
wss.on("connection",ws=>{
  let p=null;
  ws.on("message",raw=>{
    if(!p){let m={};try{m=JSON.parse(raw.toString())}catch{}p={id:crypto.randomUUID(),ws,name:cleanName(m.name),x:0,y:0,angle:0,hp:100,color:COLORS[Math.floor(Math.random()*COLORS.length)],alive:true,kills:0,ammo:30,reserve:120,lastShot:0,lastMove:Date.now()};spawn(p);players.set(p.id,p);send(ws,{type:"welcome",id:p.id,world:WORLD,player:publicPlayer(p),players:[...players.values()].filter(q=>q.id!==p.id).map(publicPlayer)});broadcast({type:"join",player:publicPlayer(p)},p.id);return}
    onMessage(p,raw);
  });
  ws.on("close",()=>{if(p){players.delete(p.id);broadcast({type:"leave",id:p.id})}});
});
setInterval(()=>{
  for(const [id,b] of bullets){
    const dt=.066;b.x+=b.vx*dt;b.y+=b.vy*dt;b.life-=dt;
    if(hitCheck(b)||b.life<=0||b.x<0||b.y<0||b.x>WORLD.w||b.y>WORLD.h)bullets.delete(id);
  }
  broadcast({type:"state",players:[...players.values()].map(publicPlayer),bullets:[...bullets.values()]});
},66);
server.listen(PORT,()=>console.log(`Desert Warriors Online: http://localhost:${PORT}`));
