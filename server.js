const express=require("express"),http=require("http"),path=require("path"),crypto=require("crypto");
const {Server}=require("socket.io");
const app=express(),server=http.createServer(app),io=new Server(server,{pingTimeout:20000,pingInterval:10000});
app.use(express.json()); app.use(express.static(__dirname));
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||"change-me",adminTokens=new Set(),rooms=new Map();
app.post("/api/admin-login",(req,res)=>{if(String(req.body?.password||"")!==ADMIN_PASSWORD)return res.status(401).json({ok:false,message:"密碼錯誤"});const t=crypto.randomBytes(24).toString("hex");adminTokens.add(t);setTimeout(()=>adminTokens.delete(t),12*60*60*1000);res.json({ok:true,token:t})});
const defaults=()=>({status:"waiting",players:{},settings:{category:"math",subcategory:"mixed",difficulty:"normal",fallSpeed:"medium",questionSeconds:15,answerCount:6,wrongAction:"continue",correctPoints:10,wrongPoints:-5,timeoutPoints:-5,duration:10,finishMode:"time",targetCorrect:20,bg:"sky",shape:"star",sound:true,note:"",startAt:""},startedAt:null,endsAt:null});
const ranking=r=>Object.values(r.players).map(p=>({name:p.name,score:p.score,correct:p.correct,wrong:p.wrong,timeout:p.timeout})).sort((a,b)=>b.score-a.score||b.correct-a.correct||a.wrong-b.wrong||a.name.localeCompare(b.name,"zh-Hant"));
const pub=r=>({status:r.status,settings:r.settings,startedAt:r.startedAt,endsAt:r.endsAt,count:Object.keys(r.players).length,ranking:ranking(r)});
const emit=c=>{const r=rooms.get(c);if(r)io.to(c).emit("room:update",pub(r))};
const finish=c=>{const r=rooms.get(c);if(!r||r.status==="ended")return;r.status="ended";emit(c);io.to(c).emit("game:ended",{ranking:ranking(r)})};
setInterval(()=>{for(const[c,r]of rooms)if(r.status==="playing"&&r.endsAt&&Date.now()>=r.endsAt)finish(c)},500);
io.on("connection",s=>{
 const admin=d=>!!(d&&adminTokens.has(d.adminToken));
 s.on("admin:create",(d,cb)=>{if(!admin(d))return cb?.({ok:false,msg:"主控未登入"});let c;do{c=String(Math.floor(100000+Math.random()*900000))}while(rooms.has(c));rooms.set(c,defaults());s.join(c);cb?.({ok:true,code:c,room:pub(rooms.get(c))})});
 s.on("admin:save",(d,cb)=>{if(!admin(d))return cb?.({ok:false,msg:"主控未登入"});const r=rooms.get(d.code);if(!r)return cb?.({ok:false,msg:"找不到房間"});if(r.status==="playing"||r.status==="countdown")return cb?.({ok:false,msg:"遊戲進行中不可修改"});r.settings={...r.settings,...d.settings};emit(d.code);cb?.({ok:true})});
 s.on("admin:start",(d,cb)=>{if(!admin(d))return cb?.({ok:false,msg:"主控未登入"});const r=rooms.get(d.code);if(!r||r.status!=="waiting")return cb?.({ok:false,msg:"目前無法開始"});r.status="countdown";emit(d.code);io.to(d.code).emit("game:countdown",{seconds:3});setTimeout(()=>{const x=rooms.get(d.code);if(!x||x.status!=="countdown")return;x.status="playing";x.startedAt=Date.now();x.endsAt=x.settings.finishMode==="time"?x.startedAt+(+x.settings.duration||10)*60000:null;emit(d.code);io.to(d.code).emit("game:start",pub(x))},3000);cb?.({ok:true})});
 s.on("admin:end",(d,cb)=>{if(!admin(d))return cb?.({ok:false});finish(d.code);cb?.({ok:true})});
 s.on("admin:delete",(d,cb)=>{if(!admin(d))return cb?.({ok:false});if(!rooms.has(d.code))return cb?.({ok:false});io.to(d.code).emit("room:deleted");rooms.delete(d.code);cb?.({ok:true})});
 s.on("player:join",(d,cb)=>{const r=rooms.get(String(d.code||""));if(!r)return cb?.({ok:false,msg:"找不到這個房間，請重新取得玩家連結"});let p=d.token&&r.players[d.token];if(p){p.socket=s.id;s.join(d.code);return cb?.({ok:true,token:d.token,room:pub(r),player:p})}
   if(r.status!=="waiting"&&r.status!=="countdown")return cb?.({ok:false,msg:"比賽已開始，無法加入"});
   const name=String(d.name||"").trim().slice(0,20);if(!name)return cb?.({ok:false,msg:"請輸入玩家名稱"});
   if(Object.values(r.players).some(x=>x.name.toLocaleLowerCase()===name.toLocaleLowerCase()))return cb?.({ok:false,msg:"此玩家名稱已有人使用"});
   const token=crypto.randomBytes(16).toString("hex");p=r.players[token]={token,name,score:0,correct:0,wrong:0,timeout:0,socket:s.id};s.join(d.code);emit(d.code);cb?.({ok:true,token,room:pub(r),player:p})
 });
 s.on("answer:result",(d,cb)=>{const r=rooms.get(d.code),p=r?.players[d.token];if(!r||!p||r.status!=="playing")return cb?.({ok:false});if(d.type==="correct"){p.correct++;p.score+=+r.settings.correctPoints}else if(d.type==="wrong"){p.wrong++;p.score+=+r.settings.wrongPoints}else if(d.type==="timeout"){p.timeout++;p.score+=+r.settings.timeoutPoints}emit(d.code);if((r.settings.finishMode==="target"||r.settings.finishMode==="first")&&p.correct>=+r.settings.targetCorrect)finish(d.code);cb?.({ok:true,player:p})});
});
app.get("/admin",(q,res)=>res.sendFile(path.join(__dirname,"admin.html")));
server.listen(process.env.PORT||3000,()=>console.log("極速答題王 V1.3 running"));
