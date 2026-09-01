
const express=require("express"), http=require("http"), {Server}=require("socket.io"), path=require("path");
const app=express(), server=http.createServer(app), io=new Server(server,{pingTimeout:20000,pingInterval:10000});
app.use(express.json());
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD || "change-me";
const adminTokens=new Set();
app.post("/api/admin-login",(req,res)=>{
 const pw=String(req.body?.password||"");
 if(pw!==ADMIN_PASSWORD) return res.status(401).json({ok:false,message:"密碼錯誤"});
 const token=require("crypto").randomBytes(24).toString("hex");
 adminTokens.add(token);
 setTimeout(()=>adminTokens.delete(token),12*60*60*1000);
 res.json({ok:true,token});
});
app.use(express.static(__dirname));
const rooms=new Map();
const def=()=>({status:"waiting",players:{},settings:{category:"math",sub:"mixed",difficulty:"normal",fallSpeed:"medium",questionSeconds:15,answerCount:6,wrongAction:"continue",correctPoints:10,wrongPoints:-5,timeoutPoints:-5,duration:10,finishMode:"time",targetCorrect:20,bg:"sky",shape:"star",sound:true,note:"",startAt:""},startedAt:null,endsAt:null});
const publicRoom=r=>({status:r.status,settings:r.settings,startedAt:r.startedAt,endsAt:r.endsAt,count:Object.keys(r.players).length,ranking:rank(r)});
function rank(r){return Object.values(r.players).map(p=>({name:p.name,score:p.score,correct:p.correct,wrong:p.wrong,timeout:p.timeout})).sort((a,b)=>b.score-a.score||b.correct-a.correct||a.wrong-b.wrong||a.name.localeCompare(b.name));}
function emitRoom(code){const r=rooms.get(code); if(r) io.to(code).emit("room:update",publicRoom(r));}
function finish(code){const r=rooms.get(code); if(!r||r.status==="ended")return;r.status="ended";emitRoom(code);io.to(code).emit("game:ended",{ranking:rank(r)});}
setInterval(()=>{const now=Date.now(); for(const [c,r] of rooms) if(r.status==="playing"&&r.endsAt&&now>=r.endsAt) finish(c)},500);
io.on("connection",s=>{
 const isAdmin=data=>!!(data&&adminTokens.has(data.adminToken));
 s.on("admin:create",(data,cb)=>{
  if(!isAdmin(data)) return cb?.({ok:false,msg:"主控未登入"});
  let c;
  do{ c=String(Math.floor(100000+Math.random()*900000)); }while(rooms.has(c));
  rooms.set(c,def());
  s.join(c);
  cb?.({ok:true,code:c,room:publicRoom(rooms.get(c))});
 });
 s.on("admin:join",(data,cb)=>{if(!isAdmin(data))return cb?.({ok:false,msg:"主控未登入"});const {code}=data;const r=rooms.get(code);if(!r)return cb?.({ok:false});s.join(code);cb?.({ok:true,room:publicRoom(r)})});
 s.on("admin:save",(data,cb)=>{if(!isAdmin(data))return cb?.({ok:false,msg:"主控未登入"});const {code,settings}=data;const r=rooms.get(code);if(!r||r.status==="playing")return cb?.({ok:false});r.settings={...r.settings,...settings};emitRoom(code);cb?.({ok:true})});
 s.on("admin:start",(data,cb)=>{if(!isAdmin(data))return cb?.({ok:false,msg:"主控未登入"});const {code}=data;const r=rooms.get(code);if(!r||r.status!=="waiting")return cb?.({ok:false});r.status="countdown";emitRoom(code);io.to(code).emit("game:countdown",{seconds:3});setTimeout(()=>{if(!rooms.has(code))return;r.status="playing";r.startedAt=Date.now();r.endsAt=r.settings.finishMode==="time"?r.startedAt+r.settings.duration*60000:null;emitRoom(code);io.to(code).emit("game:start",publicRoom(r));},3000);cb?.({ok:true})});
 s.on("admin:end",(data)=>{if(!isAdmin(data))return;finish(data.code)});
 s.on("admin:delete",(data,cb)=>{if(!isAdmin(data))return cb?.({ok:false,msg:"主控未登入"});const {code}=data;if(!rooms.has(code))return cb?.({ok:false});io.to(code).emit("room:deleted");rooms.delete(code);cb?.({ok:true})});
 s.on("player:join",({code,name,token},cb)=>{const r=rooms.get(code);if(!r)return cb?.({ok:false,msg:"找不到房間"});let p=token&&r.players[token];if(p){p.socket=s.id;s.join(code);return cb?.({ok:true,token,room:publicRoom(r),player:p});}
   if(r.status!=="waiting"&&r.status!=="countdown")return cb?.({ok:false,msg:"比賽已開始，無法加入"});
   name=(name||"").trim().slice(0,20);if(!name)return cb?.({ok:false,msg:"請輸入玩家名稱"});
   if(Object.values(r.players).some(x=>x.name.toLowerCase()===name.toLowerCase()))return cb?.({ok:false,msg:"此玩家名稱已有人使用"});
   token=Math.random().toString(36).slice(2)+Date.now().toString(36);p=r.players[token]={token,name,score:0,correct:0,wrong:0,timeout:0,socket:s.id};s.join(code);emitRoom(code);cb?.({ok:true,token,room:publicRoom(r),player:p});
 });
 s.on("answer:result",({code,token,type},cb)=>{const r=rooms.get(code),p=r?.players[token];if(!r||!p||r.status!=="playing")return cb?.({ok:false});if(type==="correct"){p.correct++;p.score+=+r.settings.correctPoints}else if(type==="wrong"){p.wrong++;p.score+=+r.settings.wrongPoints}else if(type==="timeout"){p.timeout++;p.score+=+r.settings.timeoutPoints}emitRoom(code);if(r.settings.finishMode==="target"&&p.correct>=+r.settings.targetCorrect)finish(code);cb?.({ok:true,player:p})});
});
app.get("/admin",(q,res)=>res.sendFile(path.join(__dirname,"admin.html")));
server.listen(process.env.PORT||3000,()=>console.log("極速答題王啟動"));
