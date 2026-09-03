const express=require("express"),http=require("http"),path=require("path"),crypto=require("crypto");
const {Server}=require("socket.io");
const app=express(),server=http.createServer(app),io=new Server(server,{pingTimeout:20000,pingInterval:10000});
app.use(express.json());app.use(express.static(__dirname));
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||"change-me",adminTokens=new Set(),rooms=new Map();

app.post("/api/admin-login",(req,res)=>{
  if(String(req.body?.password||"")!==ADMIN_PASSWORD)return res.status(401).json({ok:false,message:"密碼錯誤"});
  const token=crypto.randomBytes(24).toString("hex");adminTokens.add(token);
  setTimeout(()=>adminTokens.delete(token),12*60*60*1000);
  res.json({ok:true,token});
});

const makeRoom=()=>({
  status:"waiting",players:{},startedAt:null,endsAt:null,countdownEndsAt:null,
  settings:{
    category:"math",subcategory:"mixed",difficulty:"normal",playMode:"falling",fixedAnswerCount:4,fallSpeed:"medium",
    readingSeconds:0,questionSeconds:15,answerCount:6,wrongAction:"continue",
    correctPoints:10,wrongPoints:-5,timeoutPoints:-5,
    finishMode:"time",duration:10,targetCorrect:20,
    startCountdown:10,autoStartPlayers:0,bg:"sky",shape:"star",note:"",startAt:""
  }
});
const ranking=r=>Object.values(r.players).map(p=>({
  name:p.name,score:p.score,correct:p.correct,wrong:p.wrong,timeout:p.timeout
})).sort((a,b)=>b.score-a.score||b.correct-a.correct||a.wrong-b.wrong||a.name.localeCompare(b.name,"zh-Hant"));
const publicRoom=r=>({
  status:r.status,settings:r.settings,startedAt:r.startedAt,endsAt:r.endsAt,
  countdownEndsAt:r.countdownEndsAt,count:Object.keys(r.players).length,ranking:ranking(r)
});
const emitRoom=code=>{const r=rooms.get(code);if(r)io.to(code).emit("room:update",publicRoom(r))};
const endRoom=code=>{
  const r=rooms.get(code);if(!r||r.status==="ended")return;
  r.status="ended";r.countdownEndsAt=null;emitRoom(code);
  io.to(code).emit("game:ended",{ranking:ranking(r)});
};

function beginCountdown(code,r){
  if(!r||r.status!=="waiting")return false;
  const sec=Math.max(10,Math.min(60,+r.settings.startCountdown||10));
  r.status="countdown";r.countdownEndsAt=Date.now()+sec*1000;emitRoom(code);
  io.to(code).emit("game:countdown",{endsAt:r.countdownEndsAt,seconds:sec});
  return sec;
}

setInterval(()=>{
  for(const [code,r] of rooms){
    if(r.status==="countdown"&&r.countdownEndsAt&&Date.now()>=r.countdownEndsAt){
      r.status="playing";r.startedAt=Date.now();r.countdownEndsAt=null;
      r.endsAt=r.settings.finishMode==="time"?r.startedAt+(+r.settings.duration||10)*60000:null;
      emitRoom(code);io.to(code).emit("game:start",publicRoom(r));
    }
    if(r.status==="playing"&&r.endsAt&&Date.now()>=r.endsAt)endRoom(code);
  }
},200);

io.on("connection",socket=>{
  const isAdmin=d=>!!(d&&adminTokens.has(d.adminToken));

  socket.on("admin:create",(d,cb)=>{
    if(!isAdmin(d))return cb?.({ok:false,msg:"主控未登入"});
    let code;do{code=String(Math.floor(100000+Math.random()*900000))}while(rooms.has(code));
    rooms.set(code,makeRoom());socket.join(code);
    cb?.({ok:true,code,room:publicRoom(rooms.get(code))});
  });

  socket.on("admin:save",(d,cb)=>{
    if(!isAdmin(d))return cb?.({ok:false,msg:"主控未登入"});
    const r=rooms.get(String(d.code||""));if(!r)return cb?.({ok:false,msg:"找不到房間"});
    if(r.status==="playing"||r.status==="countdown")return cb?.({ok:false,msg:"遊戲進行中不可修改設定"});
    r.settings={...r.settings,...d.settings};emitRoom(d.code);cb?.({ok:true});
  });

  socket.on("admin:start",(d,cb)=>{
    if(!isAdmin(d))return cb?.({ok:false,msg:"主控未登入"});
    const r=rooms.get(String(d.code||""));if(!r)return cb?.({ok:false,msg:"找不到房間"});
    if(r.status!=="waiting")return cb?.({ok:false,msg:"目前無法開始"});
    const sec=beginCountdown(d.code,r);
    cb?.({ok:true,seconds:sec});
  });

  socket.on("admin:end",(d,cb)=>{if(!isAdmin(d))return cb?.({ok:false,msg:"主控未登入"});endRoom(d.code);cb?.({ok:true})});
  socket.on("admin:delete",(d,cb)=>{
    if(!isAdmin(d))return cb?.({ok:false,msg:"主控未登入"});
    if(!rooms.has(d.code))return cb?.({ok:false,msg:"找不到房間"});
    io.to(d.code).emit("room:deleted");rooms.delete(d.code);cb?.({ok:true});
  });

  socket.on("player:join",(d,cb)=>{
    const code=String(d.code||""),r=rooms.get(code);
    if(!r)return cb?.({ok:false,msg:"找不到這個房間，請重新取得玩家連結"});
    let p=d.token&&r.players[d.token];
    if(p){p.socket=socket.id;socket.join(code);return cb?.({ok:true,token:d.token,room:publicRoom(r),player:p})}
    if(r.status!=="waiting")return cb?.({ok:false,msg:r.status==="countdown"?"房間正在開賽倒數，已停止加入":"比賽已開始，無法加入"});
    const name=String(d.name||"").trim().slice(0,20);if(!name)return cb?.({ok:false,msg:"請輸入玩家名稱"});
    if(Object.values(r.players).some(x=>x.name.toLocaleLowerCase()===name.toLocaleLowerCase()))return cb?.({ok:false,msg:"此玩家名稱已有人使用"});
    const token=crypto.randomBytes(16).toString("hex");
    p=r.players[token]={token,name,score:0,correct:0,wrong:0,timeout:0,socket:socket.id};
    socket.join(code);emitRoom(code);cb?.({ok:true,token,room:publicRoom(r),player:p});
    const need=+r.settings.autoStartPlayers||0;
    if(need>0&&Object.keys(r.players).length>=need&&r.status==="waiting")beginCountdown(code,r);
  });

  socket.on("answer:result",(d,cb)=>{
    const r=rooms.get(String(d.code||"")),p=r?.players[d.token];
    if(!r||!p||r.status!=="playing")return cb?.({ok:false,msg:"目前不可計分"});
    if(d.type==="correct"){p.correct++;p.score+=+r.settings.correctPoints}
    else if(d.type==="wrong"){p.wrong++;p.score+=+r.settings.wrongPoints}
    else if(d.type==="timeout"){p.timeout++;p.score+=+r.settings.timeoutPoints}
    else return cb?.({ok:false,msg:"未知結果"});
    emitRoom(d.code);
    if((r.settings.finishMode==="target"||r.settings.finishMode==="first")&&p.correct>=+r.settings.targetCorrect)endRoom(d.code);
    cb?.({ok:true,player:p});
  });
});
app.get("/",(req,res)=>res.sendFile(path.join(__dirname,"admin.html")));
app.get("/admin",(req,res)=>res.sendFile(path.join(__dirname,"admin.html")));
server.listen(process.env.PORT||3000,()=>console.log("極速答題王 V2.0 running"));
