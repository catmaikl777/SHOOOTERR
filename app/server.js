// Shoot'n'cats — authoritative game server
// Node.js + ws
const { WebSocketServer } = require('ws');
const port = process.env.PORT || 3000;
const wss = new WebSocketServer({ port, maxPayload: 4096 });

const CFG = {
  W:1800,H:1200,CELL:40,PLAYER_R:18,SPEED:240,
  BULLET_SPEED:780,BULLET_R:5,BULLET_LIFE:1.4,FIRE_CD:150,
  MAX_HP:100,DAMAGE:25,RESPAWN:2500,
  PICKUP_INTERVAL:3500,PICKUP_MAX:6,PICKUP_RADIUS:24,
  BONUS_DURATION:20000,BONUS_HP_AMOUNT:40,BONUS_FIRE_MUL:.5,
  BONUS_HOMING_TURN:.12,BONUS_HOMING_NOISE:.4,BONUS_RICOCHET_MAX:2,
  BONUS_HOMING_FIRE_CD:2000,BONUS_SPRAYER_FIRE_CD:700,
  BONUS_SPRAYER_PELLETS:7,BONUS_SPRAYER_SPREAD_DEG:30,BONUS_SPRAYER_DAMAGE_MUL:.5,
  DASH_SPEED:720,DASH_DURATION:160,DASH_CD:1400,
  GRENADE_SPEED:750,GRENADE_R:10,GRENADE_FUSE:1500,GRENADE_CD:1800,
  GRENADE_RADIUS:140,GRENADE_DAMAGE:1000,GRENADE_SELF_DAMAGE_MUL:1,GRENADE_DRAG_K:1.2,
  GRENADE_MIN_FORCE:.3, STATE_MS:66
};

const SPAWNS=[
  {x:120,y:120},
  {x:CFG.W-120,y:120},
  {x:120,y:CFG.H-120},
  {x:CFG.W-120,y:CFG.H-120},
  {x:CFG.W/2,y:120},
  {x:CFG.W/2,y:CFG.H-120}
];

const KING_OF_HILL={x:CFG.W/2,y:CFG.H/2,r:150,scorePerSecond:1};
const ROOM_TYPES=new Set(['basic','portals','moving_walls','king_of_hill']);

function generateKingOfHillWalls(){
  const cs=CFG.CELL;
  const cols=Math.floor(CFG.W/cs);
  const rows=Math.floor(CFG.H/cs);
  const used=new Set();
  const out=[];
  const push=(c,r)=>{
    const k=c+','+r;
    if(used.has(k))return;
    used.add(k);
    out.push({x:c*cs,y:r*cs,w:cs,h:cs});
  };
  const rect=(x,y,w,h)=>{
    const c0=Math.round(x/cs);
    const r0=Math.round(y/cs);
    const c1=Math.round((x+w)/cs);
    const r1=Math.round((y+h)/cs);
    for(let c=c0;c<c1;c++)for(let r=r0;r<r1;r++)push(c,r);
  };
  for(let c=0;c<cols;c++){push(c,0);push(c,rows-1);}
  for(let r=0;r<rows;r++){push(0,r);push(cols-1,r);}
  const symmetric=(x,y,w,h)=>{
    rect(x,y,w,h);
    rect(CFG.W-x-w,y,w,h);
    rect(x,CFG.H-y-h,w,h);
    rect(CFG.W-x-w,CFG.H-y-h,w,h);
  };
  symmetric(80,280,240,40);
  symmetric(360,360,160,40);
  symmetric(480,400,40,200);
  symmetric(640,400,40,160);
  symmetric(800,280,40,160);
  symmetric(680,480,80,40);
  symmetric(520,680,40,120);
  symmetric(120,600,160,40);
  symmetric(280,760,120,40);
  return out;
}

const rooms=new Map();
const clients=new Map();
const roomMeta=new Map();

const MAX_PLAYERS=12;
const MAX_MSG_PER_SEC=100;
const MAX_ROOMS=64;

function hashStr(s){
  let h=2166136261>>>0;
  for(let i=0;i<s.length;i++){
    h^=s.charCodeAt(i);
    h=Math.imul(h,16777619);
  }
  return h>>>0;
}

function mulberry32(a){
  return()=>{
    a|=0;
    a=a+0x6D2B79F5|0;
    let t=Math.imul(a^a>>>15,1|a);
    t=t+Math.imul(t^t>>>7,61|t)^t;
    return((t^t>>>14)>>>0)/4294967296;
  };
}

function generateWalls(seed, type){
  if(type==='king_of_hill')return generateKingOfHillWalls();
  const rng=mulberry32(hashStr(seed));
  const cs=CFG.CELL;
  const cols=Math.floor(CFG.W/cs);
  const rows=Math.floor(CFG.H/cs);
  const used=new Set();
  const out=[];

  const push=(c,r)=>{
    const k=c+','+r;
    if(used.has(k))return;
    used.add(k);
    out.push({x:c*cs,y:r*cs,w:cs,h:cs});
  };

  for(let c=0;c<cols;c++){
    push(c,0);
    push(c,rows-1);
  }

  for(let r=0;r<rows;r++){
    push(0,r);
    push(cols-1,r);
  }

  const near=(x,y)=>
    SPAWNS.some(s=>Math.abs(s.x-x)<140&&Math.abs(s.y-y)<140);

  for(let i=0;i<60;i++){
    const c=2+Math.floor(rng()*(cols-4));
    const r=2+Math.floor(rng()*(rows-4));
    const len=1+Math.floor(rng()*3);
    const hor=rng()<.5;

    for(let j=0;j<len;j++){
      const cc=hor?c+j:c;
      const rr=hor?r:r+j;

      if(cc>=cols-1||rr>=rows-1)break;
      if(!near(cc*cs+cs/2,rr*cs+cs/2)){
        push(cc,rr);
      }
    }
  }

  // Дополнительные стены для особых типов комнат
  if(type === 'moving_walls'){
    // Добавляем дополнительные стены, которые будут двигаться/вращаться
    for(let i=0;i<15;i++){
      const c=3+Math.floor(rng()*(cols-6));
      const r=3+Math.floor(rng()*(rows-6));
      const len=1+Math.floor(rng()*4);
      const hor=rng()<.5;
      for(let j=0;j<len;j++){
        const cc=hor?c+j:c, rr=hor?r:r+j;
        if(cc>=cols-1||rr>=rows-1)break;
        if(!near(cc*cs+cs/2,rr*cs+cs/2)){
          push(cc,rr);
        }
      }
    }
  } else if(type === 'portals'){
    // Добавляем чуть больше стен для портальной комнаты
    for(let i=0;i<10;i++){
      const c=3+Math.floor(rng()*(cols-6));
      const r=3+Math.floor(rng()*(rows-6));
      const len=1+Math.floor(rng()*2);
      const hor=rng()<.5;
      for(let j=0;j<len;j++){
        const cc=hor?c+j:c, rr=hor?r:r+j;
        if(cc>=cols-1||rr>=rows-1)break;
        if(!near(cc*cs+cs/2,rr*cs+cs/2)){
          push(cc,rr);
        }
      }
    }
  }

  return out;
}

function clamp(v,a,b){
  return Math.max(a,Math.min(b,v));
}

function segIntersectsRect(x1,y1,x2,y2,r){
  const dx=x2-x1;
  const dy=y2-y1;

  let t0=0;
  let t1=1;

  const P=[-dx,dx,-dy,dy];
  const Q=[
    x1-r.x,
    r.x+r.w-x1,
    y1-r.y,
    r.y+r.h-y1
  ];

  for(let i=0;i<4;i++){
    if(P[i]===0){
      if(Q[i]<0)return false;
      continue;
    }

    const t=Q[i]/P[i];

    if(P[i]<0){
      if(t>t1)return false;
      if(t>t0)t0=t;
    }else{
      if(t<t0)return false;
      if(t<t1)t1=t;
    }
  }

  return true;
}

function lineOfSight(x1,y1,x2,y2,walls){
  for(const w of walls){
    if(segIntersectsRect(x1,y1,x2,y2,w))return false;
  }
  return true;
}


// =========================
// FOG OF WAR
// =========================

const FOG_RADIUS=430;

function canSee(room,viewer,target){
  if(!viewer||!target)return false;

  if(viewer.id===target.id)return true;

  const dx=target.x-viewer.x;
  const dy=target.y-viewer.y;

  if(dx*dx+dy*dy>FOG_RADIUS*FOG_RADIUS){
    return false;
  }

  return lineOfSight(
    viewer.x,
    viewer.y,
    target.x,
    target.y,
    room.walls
  );
}

function visibleTo(room,viewerId,x,y){
  const viewer=room.players.get(viewerId);

  if(!viewer)return false;

  const dx=x-viewer.x;
  const dy=y-viewer.y;

  if(dx*dx+dy*dy>FOG_RADIUS*FOG_RADIUS){
    return false;
  }

  return lineOfSight(
    viewer.x,
    viewer.y,
    x,
    y,
    room.walls
  );
}

function sendVisible(room,obj,x,y,ownerId=null){
  const raw=typeof obj==='string'
    ?obj
    :JSON.stringify(obj);

  for(const ws of room.clients){
    if(
      ws.readyState!==1 ||
      ws.bufferedAmount>96*1024
    )continue;

    const viewer=room.players.get(ws.peerId);

    const allowed=
      (ownerId&&viewer&&viewer.id===ownerId) ||
      visibleTo(room,ws.peerId,x,y);

    if(!allowed)continue;

    try{
      ws.send(raw);
    }catch{}
  }
}


// =========================
// COLLISION
// =========================

function resolveCircleRect(x,y,r,R){
  const cx=clamp(x,R.x,R.x+R.w);
  const cy=clamp(y,R.y,R.y+R.h);

  const dx=x-cx;
  const dy=y-cy;
  const d2=dx*dx+dy*dy;

  if(d2>=r*r)return null;

  if(d2>0){
    const d=Math.sqrt(d2);
    const k=(r-d)/d;

    return{
      x:x+dx*k,
      y:y+dy*k
    };
  }

  const dl=Math.abs(x-R.x);
  const dr=Math.abs(R.x+R.w-x);
  const dt=Math.abs(y-R.y);
  const db=Math.abs(R.y+R.h-y);

  const m=Math.min(dl,dr,dt,db);

  if(m===dl)return{x:R.x-r,y};
  if(m===dr)return{x:R.x+R.w+r,y};
  if(m===dt)return{x,y:R.y-r};

  return{x,y:R.y+R.h+r};
}


// =========================
// PLAYER
// =========================

function movePlayer(p,dt){
  let mx=p.input.m[0]||0;
  let my=p.input.m[1]||0;

  let speed=CFG.SPEED;

  if(p.dashUntil>Date.now()){
    mx=p.dashX;
    my=p.dashY;
    speed=CFG.DASH_SPEED;
  }

  p.vx=mx*speed;
  p.vy=my*speed;

  let x=p.x+p.vx*dt;
  let y=p.y+p.vy*dt;

  x=clamp(
    x,
    CFG.PLAYER_R,
    CFG.W-CFG.PLAYER_R
  );

  y=clamp(
    y,
    CFG.PLAYER_R,
    CFG.H-CFG.PLAYER_R
  );

  for(const r of p.room.walls){
    const q=resolveCircleRect(
      x,
      y,
      CFG.PLAYER_R,
      r
    );

    if(q){
      x=q.x;
      y=q.y;
    }
  }

  p.x=x;
  p.y=y;
}

function resetBonuses(p){
  p.bonuses={
    rapidUntil:0,
    homingUntil:0,
    ricochetUntil:0,
    shieldHits:0,
    sprayerUntil:0
  };
}

function fireBehavior(p,now){
  const b=p.bonuses;

  const rapid=b.rapidUntil>now;
  const homing=b.homingUntil>now;
  const ric=b.ricochetUntil>now;
  const spr=b.sprayerUntil>now;

  if(spr){
    return{
      cd:CFG.BONUS_SPRAYER_FIRE_CD,
      homing:false,
      ricochet:0,
      sprayer:true
    };
  }

  let cd=CFG.FIRE_CD;

  if(rapid){
    cd*=CFG.BONUS_FIRE_MUL;
  }

  if(homing){
    cd=Math.max(
      cd,
      CFG.BONUS_HOMING_FIRE_CD
    );
  }

  return{
    cd,
    homing,
    ricochet:ric?CFG.BONUS_RICOCHET_MAX:0,
    sprayer:false
  };
}

function insideWall(room,x,y,r){
  return room.walls.some(
    w=>
      x>w.x-r &&
      x<w.x+w.w+r &&
      y>w.y-r &&
      y<w.y+w.h+r
  );
}

function insideHill(room,x,y){
  const h=room.hill;
  const r=h.r+CFG.PLAYER_R;
  const dx=x-h.x;
  const dy=y-h.y;
  return dx*dx+dy*dy<=r*r;
}

function updateKingOfHill(room,now){
  const h=room.hill;
  const occupants=[];
  for(const p of room.players.values()){
    if(!p.dead&&insideHill(room,p.x,p.y))occupants.push(p.id);
  }
  const contested=occupants.length>1;
  const owner=occupants.length===1?occupants[0]:null;
  if(owner!==h.owner)h.lastScoredAt=now;
  if(owner){
    const p=room.players.get(owner);
    const elapsed=now-(h.lastScoredAt||now);
    if(p&&elapsed>=1000){
      const seconds=Math.floor(elapsed/1000);
      p.score+=seconds*KING_OF_HILL.scorePerSecond;
      h.lastScoredAt+=seconds*1000;
    }
  }
  h.owner=owner;
  h.contested=contested;
}


// =========================
// PICKUPS
// =========================

function spawnPickup(room){
  if(room.pickups.length>=CFG.PICKUP_MAX)return;

  const weights={
    hp:1.2,
    rapid:1,
    homing:1,
    ricochet:1,
    shield:1,
    sprayer:1.5
  };

  const used=new Set(
    room.pickups.map(p=>p.type)
  );

  const cand=Object.keys(weights)
    .filter(x=>!used.has(x));

  if(!cand.length)return;

  let total=cand.reduce(
    (s,x)=>s+weights[x],
    0
  );

  let r=Math.random()*total;
  let type=cand[0];

  for(const x of cand){
    r-=weights[x];

    if(r<=0){
      type=x;
      break;
    }
  }

  let x,y,tries=0;

  do{
    x=100+Math.random()*(CFG.W-200);
    y=100+Math.random()*(CFG.H-200);
    tries++;
  }while(
    insideWall(room,x,y,40) &&
    tries<40
  );

  if(tries>=40)return;

  room.pickups.push({
    id:'pk_'+(++room.pickupSeq),
    type,
    x,
    y
  });
}

function applyPickup(p,type,now){
  if(type==='hp'){
    p.hp=Math.min(
      CFG.MAX_HP,
      p.hp+CFG.BONUS_HP_AMOUNT
    );
  }
  else if(type==='rapid'){
    p.bonuses.rapidUntil=
      now+CFG.BONUS_DURATION;
  }
  else if(type==='homing'){
    p.bonuses.homingUntil=
      now+CFG.BONUS_DURATION;
  }
  else if(type==='ricochet'){
    p.bonuses.ricochetUntil=
      now+CFG.BONUS_DURATION;
  }
  else if(type==='shield'){
    p.bonuses.shieldHits++;
  }
  else if(type==='sprayer'){
    p.bonuses.sprayerUntil=
      now+CFG.BONUS_DURATION;
  }
}


// =========================
// NETWORK
// =========================

function send(ws,obj){
  if(
    !ws ||
    ws.readyState!==1 ||
    ws.bufferedAmount>96*1024
  )return false;

  try{
    ws.send(
      typeof obj==='string'
        ?obj
        :JSON.stringify(obj)
    );

    return true;
  }catch{
    return false;
  }
}

function broadcast(room,obj){
  const raw=
    typeof obj==='string'
      ?obj
      :JSON.stringify(obj);

  for(const ws of room.clients){
    if(
      ws.readyState===1 &&
      ws.bufferedAmount<=96*1024
    ){
      try{
        ws.send(raw);
      }catch{}
    }
  }
}


// =========================
// PLAYER STATE
// =========================

function playerPack(room,now,viewerId){
  const p={};

  const viewer=room.players.get(viewerId);

  for(const [id,v] of room.players){
    if(!viewer)continue;

    if(
      id!==viewerId &&
      !canSee(room,viewer,v)
    )continue;

    const b=v.bonuses;

    p[id]=[
      Math.round(v.x),
      Math.round(v.y),
      Math.round(v.aimX*100)/100,
      Math.round(v.aimY*100)/100,
      Math.round(v.hp),
      v.dead?1:0,
      [
        Math.max(
          0,
          Math.round(b.rapidUntil-now)
        ),
        Math.max(
          0,
          Math.round(b.homingUntil-now)
        ),
        Math.max(
          0,
          Math.round(b.ricochetUntil-now)
        ),
        b.shieldHits||0,
        Math.max(
          0,
          Math.round(b.sprayerUntil-now)
        )
      ]
    ];
  }

  const scores={};
  const names={};

  for(const [id,v] of room.players){
    scores[id]=Math.round(v.score||0);
    names[id]=v.name||id.slice(0,6);
  }

  const pickups=
    room.pickups
      .filter(
        k=>visibleTo(
          room,
          viewerId,
          k.x,
          k.y
        )
      )
      .map(x=>[
        x.id,
        x.type,
        Math.round(x.x),
        Math.round(x.y)
      ]);

  return{
    p,
    scores,
    names,
    pickups,
    roomData: {
      type: room.type || 'basic',
      portals: room.portals.map(p => ({x:Math.round(p.x), y:Math.round(p.y), pair:p.pair, active:p.active})),
      movingWalls: room.movingWalls.map(mw => ({
        wallIndex: mw.wallIndex,
        kind: mw.kind,
        angle: Math.round(mw.angle * 1000) / 1000,
        offset: Math.round(mw.offset * 100) / 100,
      })),
      hill: room.hill ? {
        x: room.hill.x,
        y: room.hill.y,
        r: room.hill.r,
        owner: room.hill.owner,
        contested: room.hill.contested,
        progress: 0
      } : null
    }
  };
}


// =========================
// BULLETS
// =========================

function spawnBullet(room,p,now){
  const len=
    Math.hypot(
      p.aimX,
      p.aimY
    )||1;

  const ax=p.aimX/len;
  const ay=p.aimY/len;

  const fb=fireBehavior(p,now);

  const count=
    fb.sprayer
      ?CFG.BONUS_SPRAYER_PELLETS
      :1;

  const base=Math.atan2(ay,ax);

  const spread=
    CFG.BONUS_SPRAYER_SPREAD_DEG*
    Math.PI/180;

  for(let i=0;i<count;i++){
    let ang=base;

    if(fb.sprayer){
      const t=
        count===1
          ?.5
          :i/(count-1);

      ang=
        base-
        spread/2+
        spread*t+
        (Math.random()-.5)*.04;
    }

    const vx=
      Math.cos(ang)*
      CFG.BULLET_SPEED;

    const vy=
      Math.sin(ang)*
      CFG.BULLET_SPEED;

    const id=
      p.id+'-'+(++p.shotSeq);

    const b={
      id,
      x:p.x+Math.cos(ang)*(CFG.PLAYER_R+6),
      y:p.y+Math.sin(ang)*(CFG.PLAYER_R+6),
      vx,
      vy,
      owner:p.id,
      born:now,
      homing:fb.homing,
      bouncesLeft:fb.ricochet,
      damage:fb.sprayer
        ?CFG.DAMAGE*CFG.BONUS_SPRAYER_DAMAGE_MUL
        :CFG.DAMAGE,
      sprayer:fb.sprayer
    };

    room.bullets.push(b);

    sendVisible(
      room,
      {
        a:'bl',
        d:{
          id:b.id,
          x:b.x,
          y:b.y,
          vx:b.vx,
          vy:b.vy,
          owner:b.owner,
          homing:b.homing,
          ricochet:b.bouncesLeft,
          sprayer:b.sprayer
        }
      },
      b.x,
      b.y,
      b.owner
    );
  }
}


// =========================
// GRENADES
// =========================

function spawnGrenade(room,p,now){
  const len=
    Math.hypot(
      p.aimX,
      p.aimY
    )||1;

  const ax=p.aimX/len;
  const ay=p.aimY/len;

  const force=clamp(
    p.input.af??1,
    CFG.GRENADE_MIN_FORCE,
    1
  );

  const id=
    p.id+'-g'+(++p.grenadeSeq);

  const b={
    id,
    x:p.x+ax*(CFG.PLAYER_R+6),
    y:p.y+ay*(CFG.PLAYER_R+6),
    vx:ax*CFG.GRENADE_SPEED*force,
    vy:ay*CFG.GRENADE_SPEED*force,
    owner:p.id,
    born:now,
    explodeAt:now+CFG.GRENADE_FUSE,
    isGrenade:true
  };

  room.bullets.push(b);

  sendVisible(
    room,
    {
      a:'bl',
      d:{
        id:b.id,
        x:b.x,
        y:b.y,
        vx:b.vx,
        vy:b.vy,
        owner:b.owner,
        grenade:true
      }
    },
    b.x,
    b.y,
    b.owner
  );
}


// =========================
// GRENADE EXPLOSION
// =========================

function explode(room,b,now){
  const hits=[];

  for(const t of room.players.values()){
    if(t.dead)continue;

    const dx=t.x-b.x;
    const dy=t.y-b.y;
    const d=Math.hypot(dx,dy);

    if(d>CFG.GRENADE_RADIUS)continue;

    let dmg=Math.round(
      CFG.GRENADE_DAMAGE*
      (1-d/CFG.GRENADE_RADIUS)
    );

    if(t.id===b.owner){
      dmg=Math.round(
        dmg*
        CFG.GRENADE_SELF_DAMAGE_MUL
      );
    }

    if(dmg<1)continue;

    let blocked=false;

    if(t.bonuses.shieldHits>0){
      t.bonuses.shieldHits--;
      blocked=true;
    }else{
      t.hp-=dmg;
    }

    let killed=false;

    if(
      !blocked &&
      t.hp<=0
    ){
      t.hp=0;
      t.dead=true;
      t.respawnAt=now+CFG.RESPAWN;
      t.dashUntil=0;

      resetBonuses(t);

      killed=true;

      const s=room.players.get(b.owner);
      if(s)s.score++;
    }

    hits.push({
      tid:t.id,
      hp:t.hp,
      dead:t.dead?1:0,
      blocked,
      killed,
      dmg
    });
  }

  sendVisible(
    room,
    {
      a:'gex',
      d:{
        id:b.id,
        owner:b.owner,
        x:Math.round(b.x),
        y:Math.round(b.y),
        r:CFG.GRENADE_RADIUS,
        hits
      }
    },
    b.x,
    b.y,
    b.owner
  );
}


// =========================
// MAIN SIMULATION
// =========================

function tickRoom(room,now,dt){

  // Обновление движущихся стен
  for(const mw of room.movingWalls){
    if(mw.kind === 'rotate'){
      mw.angle += mw.angleSpeed;
    } else {
      mw.offset += mw.offsetSpeed * dt;
      if(Math.abs(mw.offset) > mw.offsetRange) mw.offsetSpeed *= -1;
    }
  }

  // Порталы: телепортация игроков
  if(room.portals.length > 0){
    for(const p of room.players.values()){
      if(p.dead) continue;
      for(const portal of room.portals){
        const dx = p.x - portal.x;
        const dy = p.y - portal.y;
        if(dx*dx + dy*dy < 60*60){
          // Найти портал-пару
          const pair = portal.pair === 'a' ? 'b' : 'a';
          const target = room.portals.find(pt => pt.pair === pair && pt !== portal);
          if(target){
            p.x = target.x;
            p.y = target.y;
            p.vx = 0;
            p.vy = 0;
            break;
          }
        }
      }
    }
  }

  // Players
  for(const p of room.players.values()){

    if(p.dead){
      if(now>=p.respawnAt){
        const s=
          SPAWNS[
            p.spawnIndex%
            SPAWNS.length
          ];

        p.x=s.x;
        p.y=s.y;
        p.hp=CFG.MAX_HP;
        p.dead=false;
        p.vx=p.vy=0;

        resetBonuses(p);
      }

      continue;
    }

    movePlayer(p,dt);

    p.aimX=
      p.input.a[0]||1;

    p.aimY=
      p.input.a[1]||0;


    // DASH
    if(p.input.dseq>p.lastDseq){
      p.lastDseq=p.input.dseq;

      let dx=p.input.m[0];
      let dy=p.input.m[1];

      if(Math.hypot(dx,dy)<.2){
        dx=p.aimX;
        dy=p.aimY;
      }

      const l=
        Math.hypot(dx,dy)||1;

      p.dashX=dx/l;
      p.dashY=dy/l;

      p.dashUntil=
        now+CFG.DASH_DURATION;
    }


    // GRENADE
    if(p.input.tseq>p.lastTseq){
      p.lastTseq=p.input.tseq;

      if(
        now-p.lastThrow>=
        CFG.GRENADE_CD*.85
      ){
        p.lastThrow=now;
        spawnGrenade(
          room,
          p,
          now
        );
      }
    }


    // SHOOT
    if(
      p.input.w!==1 &&
      p.input.f
    ){
      const fb=
        fireBehavior(p,now);

      if(
        now-p.fireAt>=fb.cd
      ){
        p.fireAt=now;
        spawnBullet(
          room,
          p,
          now
        );
      }
    }


    // PICKUPS
    for(
      let i=room.pickups.length-1;
      i>=0;
      i--
    ){
      const k=room.pickups[i];

      const dx=p.x-k.x;
      const dy=p.y-k.y;

      const rr=
        CFG.PLAYER_R+
        CFG.PICKUP_RADIUS;

      if(
        dx*dx+
        dy*dy<
        rr*rr
      ){
        applyPickup(
          p,
          k.type,
          now
        );

        room.pickups.splice(
          i,
          1
        );
      }
    }
  }

  if(room.type==='king_of_hill')updateKingOfHill(room,now);


  // Pickup spawning
  if(
    now-room.lastPickup>
    CFG.PICKUP_INTERVAL
  ){
    room.lastPickup=now;
    spawnPickup(room);
  }


  // =========================
  // PROJECTILES
  // =========================

  for(
    let i=room.bullets.length-1;
    i>=0;
    i--
  ){

    const b=room.bullets[i];


    // GRENADE
    if(b.isGrenade){

      const drag=
        Math.exp(
          -CFG.GRENADE_DRAG_K*
          dt
        );

      b.vx*=drag;
      b.vy*=drag;

      let nx=
        b.x+
        b.vx*dt;

      let ny=
        b.y+
        b.vy*dt;

      let hit=false;

      for(const r of room.walls){

        if(
          nx>r.x-CFG.GRENADE_R &&
          nx<r.x+r.w+CFG.GRENADE_R &&
          ny>r.y-CFG.GRENADE_R &&
          ny<r.y+r.h+CFG.GRENADE_R
        ){
          hit=true;

          const q=
            resolveCircleRect(
              nx,
              ny,
              CFG.GRENADE_R,
              r
            );

          if(q){
            nx=q.x;
            ny=q.y;
          }

          break;
        }
      }

      if(hit){
        b.vx=0;
        b.vy=0;
      }

      b.x=nx;
      b.y=ny;

      if(now>=b.explodeAt){
        explode(
          room,
          b,
          now
        );

        room.bullets.splice(
          i,
          1
        );
      }

      continue;
    }


    // HOMING
    if(b.homing){

      let near=null;
      let nd=Infinity;

      for(const t of room.players.values()){
        if(
          t.id===b.owner ||
          t.dead
        )continue;

        const d=
          (t.x-b.x)**2+
          (t.y-b.y)**2;

        if(d<nd){
          nd=d;
          near=t;
        }
      }

      if(near){

        const target=
          Math.atan2(
            near.y-b.y,
            near.x-b.x
          );

        const cur=
          Math.atan2(
            b.vy,
            b.vx
          );

        const want=
          target+
          (Math.random()-.5)*
          CFG.BONUS_HOMING_NOISE;

        let diff=
          want-cur;

        while(diff>Math.PI)
          diff-=2*Math.PI;

        while(diff<-Math.PI)
          diff+=2*Math.PI;

        const turn=
          clamp(
            diff,
            -CFG.BONUS_HOMING_TURN,
            CFG.BONUS_HOMING_TURN
          );

        const sp=
          Math.hypot(
            b.vx,
            b.vy
          );

        const a=cur+turn;

        b.vx=Math.cos(a)*sp;
        b.vy=Math.sin(a)*sp;
      }
    }


    // BULLET MOVEMENT
    let nx=
      b.x+
      b.vx*dt;

    let ny=
      b.y+
      b.vy*dt;

    let hit=null;

    for(const r of room.walls){

      if(
        nx>r.x-CFG.BULLET_R &&
        nx<r.x+r.w+CFG.BULLET_R &&
        ny>r.y-CFG.BULLET_R &&
        ny<r.y+r.h+CFG.BULLET_R
      ){
        hit=r;
        break;
      }
    }


    // RICOCHET
    if(hit){

      if(b.bouncesLeft>0){

        b.bouncesLeft--;

        const cx=
          hit.x+
          hit.w/2;

        const cy=
          hit.y+
          hit.h/2;

        const dx=nx-cx;
        const dy=ny-cy;

        const ow=
          hit.w/2+
          CFG.BULLET_R;

        const oh=
          hit.h/2+
          CFG.BULLET_R;

        const ox=
          ow-
          Math.abs(dx);

        const oy=
          oh-
          Math.abs(dy);

        if(ox<oy){
          b.vx=-b.vx;

          nx=
            b.x+
            Math.sign(dx||1)*
            ox;
        }else{
          b.vy=-b.vy;

          ny=
            b.y+
            Math.sign(dy||1)*
            oy;
        }

      }else{

        room.bullets.splice(
          i,
          1
        );

        continue;
      }
    }


    b.x=nx;
    b.y=ny;


    // Lifetime
    if(
      now-b.born>
      CFG.BULLET_LIFE*1000
    ){
      room.bullets.splice(
        i,
        1
      );

      continue;
    }


    // PLAYER HIT
    let hitPlayer=false;

    for(const t of room.players.values()){

      if(
        t.id===b.owner ||
        t.dead
      )continue;

      const dx=t.x-b.x;
      const dy=t.y-b.y;

      const rr=
        CFG.PLAYER_R+
        CFG.BULLET_R;

      if(
        dx*dx+
        dy*dy<
        rr*rr
      ){

        let blocked=false;

        if(t.bonuses.shieldHits>0){
          t.bonuses.shieldHits--;
          blocked=true;
        }else{
          t.hp-=b.damage;
        }

        let killed=false;

        if(
          !blocked &&
          t.hp<=0
        ){
          t.hp=0;
          t.dead=true;
          t.respawnAt=
            now+CFG.RESPAWN;

          t.dashUntil=0;

          resetBonuses(t);

          killed=true;

          const s=
            room.players.get(
              b.owner
            );

          if(s)s.score++;
        }

        broadcast(
          room,
          {
            a:'hit',
            d:{
              bid:b.id,
              target:t.id,
              by:b.owner,
              hp:t.hp,
              dead:t.dead,
              killed,
              blocked,
              sprayer:!!b.sprayer
            }
          }
        );

        room.bullets.splice(
          i,
          1
        );

        hitPlayer=true;
        break;
      }
    }

    if(hitPlayer)continue;
  }


  // =========================
  // STATE SYNC
  // =========================

  if(
    now-room.lastState>=
    CFG.STATE_MS
  ){

    /*
      Projectiles are not part of the player
      state snapshot.

      Re-send their current position to every
      client that can currently see them.

      This fixes the fog-of-war case where:
      - shooter is hidden;
      - shooter fires;
      - bullet starts outside visibility;
      - bullet later enters the viewer's visibility.

      The viewer then receives the bullet with
      its current server-authoritative position.
    */

    for(const b of room.bullets){

      sendVisible(
        room,
        {
          a:'bu',
          d:{
            id:b.id,
            x:b.x,
            y:b.y,
            vx:b.vx,
            vy:b.vy,
            owner:b.owner,
            homing:b.homing,
            ricochet:b.bouncesLeft,
            sprayer:b.sprayer,
            grenade:!!b.grenade
          }
        },
        b.x,
        b.y,
        b.owner
      );
    }

    room.lastState=now;

    // Player state
    for(const ws of room.clients){

      if(
        ws.readyState!==1 ||
        ws.bufferedAmount>96*1024
      )continue;

      send(
        ws,
        {
          a:'st',
          d:playerPack(
            room,
            now,
            ws.peerId
          )
        }
      );
    }
  }
}


// =========================
// PLAYER CREATION
// =========================

function createPlayer(room,id,ws){

  const n=room.players.size;

  const s=
    SPAWNS[
      n%SPAWNS.length
    ];

  const p={
    id,
    ws,
    room,

    x:s.x,
    y:s.y,

    vx:0,
    vy:0,

    aimX:1,
    aimY:0,

    hp:CFG.MAX_HP,
    dead:false,
    score:0,

    spawnIndex:n,

    name:id.slice(0,6),

    input:{
      m:[0,0],
      a:[1,0],
      f:0,
      w:0,
      af:1,
      dseq:0,
      tseq:0
    },

    dseq:0,
    lastDseq:0,
    lastTseq:0,

    lastThrow:0,
    fireAt:0,

    shotSeq:0,
    grenadeSeq:0,

    dashUntil:0,
    dashX:1,
    dashY:0,

    respawnAt:0
  };

  resetBonuses(p);

  room.players.set(
    id,
    p
  );

  return p;
}


// =========================
// LEAVE
// =========================

function leave(ws){

  const c=
    clients.get(
      ws.peerId
    );

  if(!c)return;

  const room=c.room;

  if(room){

    room.players.delete(
      ws.peerId
    );

    room.clients.delete(ws);

    broadcast(
      room,
      {
        type:'peer-leave',
        peerId:ws.peerId
      }
    );

    if(room.clients.size===0){
      rooms.delete(room.id);
      roomMeta.delete(room.id);
    }
  }

  broadcastLobbyList();

  clients.delete(
    ws.peerId
  );
}


// =========================
// LOBBY
// =========================

function cleanLobbyName(v){
  return String(v||'')
    .replace(/[<>]/g,'')
    .trim()
    .slice(0,24);
}

function makeRoomId(name){

  const base=
    cleanLobbyName(name)
      .toLowerCase()
      .replace(
        /[^a-z0-9а-яё_-]+/gi,
        '-'
      )
      .replace(
        /^-+|-+$/g,
        ''
      )
      .slice(0,18)||'room';

  let id=base;
  let n=2;

  while(
    rooms.has(id)||
    roomMeta.has(id)
  ){
    id=base+'-'+n++;

    if(n>9999){
      id=
        'room-'+
        Math.random()
          .toString(36)
          .slice(2,8);
    }
  }

  return id;
}

function lobbyList(){

  const out=[];

  for(const [id,meta] of roomMeta){

    const room=
      rooms.get(id);

    const players=
      room?
      room.clients.size:
      0;

    if(players<=0)continue;

    out.push({
      id,
      name:meta.name||id,
      private:!!meta.private,
      players,
      maxPlayers:MAX_PLAYERS,
      type: meta.type || 'basic'
    });
  }

  out.sort(
    (a,b)=>
      a.name.localeCompare(b.name)
  );

  return out.slice(
    0,
    MAX_ROOMS
  );
}

function sendLobbyList(ws){
  send(
    ws,
    {
      type:'lobbies',
      lobbies:lobbyList()
    }
  );
}

function broadcastLobbyList(){

  const raw=
    JSON.stringify({
      type:'lobbies',
      lobbies:lobbyList()
    });

  for(const ws of wss.clients){

    if(
      ws.readyState===1 &&
      ws.bufferedAmount<64*1024
    ){
      try{
        ws.send(raw);
      }catch{}
    }
  }
}

function ensureRoom(
  roomId,
  meta={
    name:roomId,
    private:false,
    password:'',
    type:'basic'
  }
){

  let room=
    rooms.get(roomId);

  if(!room){

    const type = meta.type || 'basic';

    room={
      id:roomId,
      clients:new Set(),
      players:new Map(),
      bullets:[],
      pickups:[],
      pickupSeq:0,
      walls:generateWalls(roomId, type),
      lastPickup:Date.now(),
      lastState:0,
      lastTick:Date.now(),
      type:type,
      portals:[],
      movingWalls:[],
      hill:{...KING_OF_HILL,owner:null,contested:false,lastScoredAt:Date.now()},
    };

    if(type === 'portals'){
      const prng=mulberry32(hashStr(roomId+'_portals'));
      for(let i=0;i<4;i++){
        const px = 150 + Math.floor(prng()*(CFG.W-300));
        const py = 150 + Math.floor(prng()*(CFG.H-300));
        room.portals.push({x:px, y:py, pair: i%2===0?'a':'b', active:true});
      }
    } else if(type === 'moving_walls'){
      const mrng=mulberry32(hashStr(roomId+'_moving'));
      const movableWalls = room.walls.filter(w => !(w.w===CFG.CELL && (w.x===0||w.y===0||w.x+w.w===CFG.W||w.y+w.h===CFG.H)));
      const count = Math.min(8, movableWalls.length);
      const usedWalls = new Set();
      for(let i=0;i<count;i++){
        let idx = Math.floor(mrng()*movableWalls.length);
        let attempts = 0;
        while(usedWalls.has(idx) && attempts < 20){
          idx = Math.floor(mrng()*movableWalls.length);
          attempts++;
        }
        if(usedWalls.has(idx)) continue;
        usedWalls.add(idx);
        const w = movableWalls[idx];
        if(!w) continue;
        room.movingWalls.push({
          wallIndex: idx,
          wall: w,
          kind: mrng() < 0.5 ? 'rotate' : 'translate',
          angle: 0,
          angleSpeed: (mrng()-0.5)*0.02,
          offset: 0,
          offsetSpeed: (mrng()-0.5)*2,
          offsetRange: 20 + mrng()*30,
        });
      }
    }

    rooms.set(
      roomId,
      room
    );
  }

  if(!roomMeta.has(roomId)){
    roomMeta.set(
      roomId,
      meta
    );
  }

  return room;
}


// =========================
// CONNECTION
// =========================

wss.on(
  'connection',
  (ws,req)=>{

    if(ws._socket?.setNoDelay)
      ws._socket.setNoDelay(true);

    if(ws._socket?.setKeepAlive)
      ws._socket.setKeepAlive(
        true,
        15000
      );

    ws.peerId=
      'peer_'+
      Math.random()
        .toString(36)
        .slice(2,10);

    ws.isAlive=true;

    const c={
      ws,
      peerId:ws.peerId,
      room:null,
      times:[]
    };

    clients.set(
      ws.peerId,
      c
    );

    ws.on(
      'pong',
      ()=>{
        ws.isAlive=true;
      }
    );

    ws.on(
      'message',
      raw=>{

        if(raw.length>4096)return;

        const now=Date.now();

        c.times.push(now);

        while(
          c.times.length &&
          now-c.times[0]>1000
        ){
          c.times.shift();
        }

        if(
          c.times.length>
          MAX_MSG_PER_SEC
        )return;

        let msg;

        try{
          msg=JSON.parse(raw);
        }catch{
          return;
        }


        // Lobby list
        if(msg.type==='list'){
          sendLobbyList(ws);
          return;
        }


        // Create lobby
        if(msg.type==='create'){

          const name=
            cleanLobbyName(
              msg.name
            );

          if(!name){
            send(
              ws,
              {
                type:'error',
                msg:'lobby name required'
              }
            );

            return;
          }

          const priv=!!msg.private;
          const roomType = ROOM_TYPES.has(msg.roomType)
            ? msg.roomType
            : 'basic';

          const password=
            String(
              msg.password||''
            ).slice(0,32);

          if(priv&&!password){
            send(
              ws,
              {
                type:'error',
                msg:'password required'
              }
            );

            return;
          }

          const id=
            makeRoomId(name);

          ensureRoom(
            id,
            {
              name,
              private:priv,
              password,
              type: roomType
            }
          );

          send(
            ws,
            {
              type:'created',
              room:id,
              name,
              private:priv,
              roomType: roomType
            }
          );

          broadcastLobbyList();

          return;
        }


        // Join lobby
        if(msg.type==='join'){

          const rid=
            String(
              msg.room||''
            ).slice(0,32);

          if(!rid){
            send(
              ws,
              {
                type:'error',
                msg:'room required'
              }
            );

            return;
          }

          const meta=
            roomMeta.get(rid)||{
              name:rid,
              private:false,
              password:'',
              type:'basic'
            };

          const room=
            ensureRoom(rid, meta);

          if(
            meta.private &&
            String(msg.password||'')!==
            String(meta.password||'')
          ){
            send(
              ws,
              {
                type:'error',
                msg:'wrong lobby password'
              }
            );

            return;
          }

          if(
            room.clients.size>=
            MAX_PLAYERS
          ){
            send(
              ws,
              {
                type:'error',
                msg:'room full'
              }
            );

            return;
          }

          c.room=room;

          room.clients.add(ws);

          createPlayer(
            room,
            ws.peerId,
            ws
          );

          send(
            ws,
            {
              type:'welcome',
              peerId:ws.peerId,
              peers:[
                ...room.clients
              ]
                .filter(
                  x=>x!==ws
                )
                .map(
                  x=>x.peerId
                ),
              host:[
                ...room.clients
              ][0]?.peerId||
                ws.peerId,
              authoritative:true,
              roomType: room.type || 'basic',
              lobby:{
                id:rid,
                name:meta.name,
                private:!!meta.private,
                type: meta.type || 'basic'
              }
            }
          );

          for(
            const peer of room.clients
          ){
            if(peer!==ws){
              send(
                peer,
                {
                  type:'peer-join',
                  peerId:ws.peerId
                }
              );
            }
          }

          broadcastLobbyList();

          return;
        }


        if(!c.room)return;

        const room=c.room;


        // Game input
        if(msg.data){

          const a=msg.data.a;
          const d=msg.data.d||{};


          // Input
          if(
            a==='in' &&
            d &&
            typeof d.seq==='number'
          ){

            const p=
              room.players.get(
                ws.peerId
              );

            if(p){

              p.input={
                m:Array.isArray(d.m)
                  ?d.m
                  :[0,0],

                a:Array.isArray(d.a)
                  ?d.a
                  :[1,0],

                f:d.f?1:0,

                w:d.w?1:0,

                af:Number.isFinite(d.af)
                  ?d.af
                  :1,

                dseq:
                  Number(d.dseq)||0,

                tseq:
                  Number(d.tseq)||0
              };

              p.name=
                p.name||
                ws.peerId.slice(0,6);
            }
          }


          // Name
          else if(
            a==='id' &&
            d.name
          ){

            const p=
              room.players.get(
                ws.peerId
              );

            if(p){
              p.name=
                String(
                  d.name
                ).slice(0,24);
            }
          }


          // Ping
          else if(
            a==='png' &&
            d.pong
          ){

            send(
              ws,
              {
                a:'png',
                d:{
                  t:d.t,
                  pong:1
                },
                from:'server'
              }
            );
          }


          // Vote
          else if(a==='vote'){

            broadcast(
              room,
              {
                a:'vote',
                d,
                from:ws.peerId
              }
            );
          }
        }
      }
    );


    ws.on(
      'close',
      ()=>{
        leave(ws);
      }
    );

    ws.on(
      'error',
      ()=>{
        leave(ws);
      }
    );
  }
);


// =========================
// GAME LOOP
// =========================

setInterval(
  ()=>{
    const now=Date.now();

    for(
      const room of rooms.values()
    ){

      const dt=
        Math.min(
          .05,
          (
            now-
            (
              room.lastTick||
              now
            )
          )/1000
        );

      room.lastTick=now;

      tickRoom(
        room,
        now,
        dt
      );
    }
  },
  16
);


// =========================
// WEBSOCKET HEARTBEAT
// =========================

setInterval(
  ()=>{
    for(
      const ws of wss.clients
    ){

      if(ws.isAlive===false){

        try{
          ws.terminate();
        }catch{}

        continue;
      }

      ws.isAlive=false;

      try{
        ws.ping();
      }catch{}
    }
  },
  10000
);


console.log(
  'Authoritative server listening on',
  port
);
