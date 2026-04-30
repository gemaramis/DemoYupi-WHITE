/**
 * YUPI AR PENALTY SHOOTOUT v2 — game.js
 * Swipe-to-shoot | GLB assets | Three.js ES modules
 */
"use strict";

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { registerPlayer, saveScore, fetchLeaderboard, PlayerState } from './firebase-db.js';

/* ── CONFIG ── */
const CFG = {
  TIME_LIMIT: 15, POINTS_PER_GOAL: 100,
  GOAL_W: 1.8, GOAL_H: 0.9, GOAL_Z: -2.0,
  BALL_Y: 0.1, BALL_Z: 0.55,
  KEEPER_PATROL: 0.65, KEEPER_CYCLE: 2.2,
  SHOOT_MS: 750, MAX_SWIPE: 180, TRAJ_DOTS: 7,
};

/* ── STATE ── */
const S = { goals:0, saves:0, points:0, timeRemaining:CFG.TIME_LIMIT, shooting:false, active:false };

/* ── DOM ── */
const $ = id => document.getElementById(id);
const El = {
  splash:$('splash'), splashBar:$('splash-bar'), splashHint:$('splash-hint'),
  start:$('start-screen'), hud:$('hud'),
  feedback:$('feedback'), fbEmoji:$('feedback-emoji'), fbText:$('feedback-text'),
  gameover:$('gameover'), scoreYou:$('score-you'), scoreCandy:$('score-candy'),
  goGoals:$('go-goals'), goTotal:$('go-total'), goTitle:$('go-title'), goRating:$('go-rating'),
  hudTimer:$('hud-timer'),
  regScreen:$('registration-screen'), btnReg:$('btn-submit-reg'), regName:$('reg-name'),
  lbScreen:$('leaderboard-screen'), lbList:$('lb-list'), lbMyRow:$('lb-my-row'), btnCloseLb:$('btn-close-lb'),
  swipeHint:$('swipe-hint'), powerCanvas:$('power-canvas'),
};

/* ── THREE SCENE ── */
let renderer, scene, camera, clock;
let ballMesh=null, keeperMesh=null, gawangMesh=null, mixer=null;
let trajDots=[], powerCtx=null, touch0=null, keeperPhase=0, gameTimerInterval=null;
let confettiParticles=[];
let gameGroup = new THREE.Group(); // pre-created; added to scene in onStart
let reticleMesh=null, gamePlaced=false;

/* ── Audio Engine (synthesized, no files) ── */
let audioCtx=null;
function getAudio(){ if(!audioCtx) audioCtx=new (window.AudioContext||window.webkitAudioContext)(); return audioCtx; }
function playTone({freq=220,freq2=freq,type='sine',dur=0.3,vol=0.4,delay=0}={}){  try{
  const ac=getAudio(), g=ac.createGain(), o=ac.createOscillator();
  o.type=type; o.frequency.setValueAtTime(freq,ac.currentTime+delay);
  o.frequency.exponentialRampToValueAtTime(freq2,ac.currentTime+delay+dur);
  g.gain.setValueAtTime(vol,ac.currentTime+delay);
  g.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+delay+dur);
  o.connect(g); g.connect(ac.destination);
  o.start(ac.currentTime+delay); o.stop(ac.currentTime+delay+dur);
  }catch(e){}
}
const Snd={
  kick:()=>{ playTone({freq:180,freq2:60,type:'sine',dur:0.18,vol:0.6}); playTone({freq:2400,freq2:800,type:'square',dur:0.05,vol:0.08}); },
  goal:()=>{ [0,0.12,0.24].forEach((d,i)=>playTone({freq:440*(i+1)*0.8,freq2:880*(i+1)*0.8,type:'sine',dur:0.35,vol:0.35,delay:d})); },
  save:()=>{ playTone({freq:300,freq2:180,type:'sawtooth',dur:0.25,vol:0.3}); },
  miss:()=>{ playTone({freq:220,freq2:100,type:'triangle',dur:0.4,vol:0.25}); },
  tick:()=>{ playTone({freq:880,type:'square',dur:0.05,vol:0.15}); },
};

/* ════════════════════════════════════════
   FBX HELPERS
════════════════════════════════════════ */
/** Load a GLB/GLTF file. Returns the root Group (gltf.scene). */
function loadGLTF(url, onPct) {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.load(
      url,
      (gltf) => {
        // Attach animations to the scene group for compatibility
        if (gltf.animations && gltf.animations.length > 0) {
          gltf.scene.animations = gltf.animations;
        }
        resolve(gltf.scene);
      },
      (xhr) => onPct && xhr.lengthComputable && onPct(xhr.loaded / xhr.total),
      reject
    );
  });
}

function normalizeFBX(group, targetSize) {
  const box = new THREE.Box3().setFromObject(group);
  const size = new THREE.Vector3();
  box.getSize(size);
  const sc = targetSize / Math.max(size.x, size.y, size.z);
  group.scale.setScalar(sc);
  box.setFromObject(group);
  const center = new THREE.Vector3();
  box.getCenter(center);
  const h = new THREE.Vector3(); box.getSize(h);
  group.position.y -= (center.y - h.y / 2);
}

/** Scale FBX so its HEIGHT = targetH (useful for goals/characters). */
function normalizeFBXByHeight(group, targetH) {
  const box = new THREE.Box3().setFromObject(group);
  const size = new THREE.Vector3();
  box.getSize(size);
  const sc = targetH / size.y;
  group.scale.setScalar(sc);
  box.setFromObject(group);
  const center = new THREE.Vector3();
  box.getCenter(center);
  const h = new THREE.Vector3(); box.getSize(h);
  group.position.y -= (center.y - h.y / 2);
}

/** Fix common FBX material issues. Returns mesh count. */
function fixFBXMaterials(group) {
  let count = 0;
  group.traverse(c => {
    if (!c.isMesh) return;
    count++;
    c.castShadow = true;
    c.receiveShadow = true;
    const mats = Array.isArray(c.material) ? c.material : [c.material];
    mats.forEach(m => {
      m.side = THREE.DoubleSide;
      m.depthWrite = true;
      m.transparent = false;   // force opaque — FBX often exports transparent=true
      m.opacity = 1;
      m.needsUpdate = true;
    });
  });
  return count;
}

/* ════════════════════════════════════════
   8TH WALL AR PIPELINE  (free, no API key)
════════════════════════════════════════ */

/** Called on "TAP TO PLAY" — starts 8th Wall engine on the ar-canvas. */
function startXR8Session() {
  El.start.classList.add('screen-hidden');
  const run = () => {
    try {
      console.log('[XR8] Starting pipeline…');
      XR8.addCameraPipelineModules([
        XR8.GlTextureRenderer.pipelineModule(),
        XR8.Threejs.pipelineModule(),
        XR8.XrController.pipelineModule(),
        buildGamePipelineModule(),
      ]);
      XR8.xrController().configure({ disableWorldTracking: false });
      XR8.run({ canvas: $('ar-canvas') });
      console.log('[XR8] XR8.run() called successfully');
    } catch(e) {
      console.error('[XR8] Pipeline failed, falling back:', e);
      startFallbackSession();
    }
  };
  // Wait for XR8 to be fully ready (fires xrloaded even if script is sync)
  if (window.XR8) { run(); }
  else { window.addEventListener('xrloaded', run, {once:true}); }
}

function buildGamePipelineModule() {
  return {
    name: 'yupi-ar-game',
    onStart: ({ canvas }) => {
      const { scene: xs, camera: xc, renderer: xr } = XR8.Threejs.xrScene();
      scene = xs; camera = xc; renderer = xr;

      // Lighting
      scene.add(new THREE.AmbientLight(0xffffff, 0.85));
      const sun = new THREE.DirectionalLight(0xffffff, 1.3);
      sun.position.set(3,12,4); sun.castShadow=true; sun.shadow.mapSize.set(512,512); scene.add(sun);
      const fill = new THREE.PointLight(0x4488ff,0.5,25); fill.position.set(-3,5,-3); scene.add(fill);
      const rim  = new THREE.PointLight(0xffaa33,0.4,20); rim.position.set(3,4,4);   scene.add(rim);

      // Game group hidden until floor placed
      gameGroup.visible = false; scene.add(gameGroup);
      buildGround(); buildTrajectoryDots(); addYupiBanner(); buildConfettiPool();

      // Gold reticle
      const rg = new THREE.RingGeometry(0.12,0.18,32).rotateX(-Math.PI/2);
      reticleMesh = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({color:0xFFD700,side:THREE.DoubleSide}));
      reticleMesh.matrixAutoUpdate = false; reticleMesh.visible = false; scene.add(reticleMesh);

      // Swipe shoot controls + placement tap
      initSwipeControls(canvas);
      canvas.addEventListener('touchstart', onXR8Place, {passive:false});
      canvas.addEventListener('click', ()=>onXR8Place({touches:[{clientX:innerWidth/2,clientY:innerHeight/2}]}));

      // "Point at floor" hint
      const hint = Object.assign(document.createElement('div'),
        {id:'xr8-hint', textContent:'🎯 Point at the floor — tap gold ring to place goal'});
      hint.style.cssText='position:fixed;bottom:110px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.65);color:#FFD700;font:700 15px Plus Jakarta Sans,sans-serif;padding:10px 22px;border-radius:28px;z-index:200;pointer-events:none;white-space:nowrap';
      document.body.appendChild(hint);
    },

    onUpdate: () => {
      const dt = clock.getDelta();
      if (S.active) { tickKeeper(dt); tickConfetti(); if(ballMesh&&!S.shooting) ballMesh.rotation.y+=0.008; }
      // Live reticle via center-screen hit-test
      if (!gamePlaced) {
        try {
          const hits = XR8.XrController.hitTest(0.5,0.5,['FEATURE_POINT','ESTIMATED_SURFACE']);
          if (hits.length > 0) {
            reticleMesh.visible = true;
            const {position:p, rotation:r} = hits[0];
            reticleMesh.matrix.compose(
              new THREE.Vector3(p.x,p.y,p.z),
              new THREE.Quaternion(r.x,r.y,r.z,r.w),
              new THREE.Vector3(1,1,1)
            );
          } else { reticleMesh.visible = false; }
        } catch(_) {}
      }
    },
  };
}

/** Tap handler — anchors gameGroup to detected floor surface. */
function onXR8Place(e) {
  if (gamePlaced) return;
  e.preventDefault && e.preventDefault();
  const x=(e.touches?.[0]?.clientX??innerWidth/2)/innerWidth;
  const y=(e.touches?.[0]?.clientY??innerHeight/2)/innerHeight;
  try {
    const hits = XR8.XrController.hitTest(x,y,['FEATURE_POINT','ESTIMATED_SURFACE']);
    if (hits.length > 0) {
      const {position:p, rotation:r} = hits[0];
      gameGroup.position.set(p.x,p.y,p.z);
      gameGroup.quaternion.set(r.x,r.y,r.z,r.w);
      gameGroup.visible=true; gamePlaced=true; reticleMesh.visible=false;
      document.getElementById('xr8-hint')?.remove();
      El.hud.classList.remove('screen-hidden');
      El.swipeHint.classList.remove('screen-hidden');
      startGame();
    }
  } catch(ex) { console.error('XR8 place:', ex); }
}

/** Set up Three.js scene + camera stream — call from user gesture (registration). */
async function initScene() {
  if (renderer) return; // already initialized
  renderer = new THREE.WebGLRenderer({antialias:false, alpha:true, powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
  renderer.setSize(innerWidth,innerHeight);
  renderer.shadowMap.enabled=true;
  // Fullscreen canvas behind all UI
  renderer.domElement.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;';
  document.body.prepend(renderer.domElement);

  camera = new THREE.PerspectiveCamera(55,innerWidth/innerHeight,0.1,100);
  camera.position.set(0,0.9,1.8); camera.lookAt(0,0.3,CFG.GOAL_Z);

  scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff,0.85));
  const sun=new THREE.DirectionalLight(0xffffff,1.3); sun.position.set(3,12,4);
  sun.castShadow=true; sun.shadow.mapSize.set(512,512); scene.add(sun);
  const fill = new THREE.PointLight(0x4488ff,0.5,20);
  fill.position.set(-3,5,-3);
  scene.add(fill);

  gameGroup.visible=true; gamePlaced=true; scene.add(gameGroup);
  buildGround(); buildTrajectoryDots(); addYupiBanner(); buildConfettiPool();

  // Request camera permission NOW (inside user gesture context)
  await initCamera();
  initSwipeControls();

  window.addEventListener('resize',()=>{
    camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth,innerHeight);
    if(El.powerCanvas){El.powerCanvas.width=innerWidth;El.powerCanvas.height=innerHeight;}
  });
  // Render loop
  (function loop(){
    requestAnimationFrame(loop);
    const dt=clock.getDelta();
    if(ballMesh&&!S.shooting) ballMesh.rotation.y+=0.008;
    tickKeeper(dt); tickConfetti(); if(mixer) mixer.update(dt);
    renderer.render(scene,camera);
  })();
}

/** Fallback for browsers without XR8 (manual camera stream, fixed camera). */
async function startFallbackSession() {
  El.start.classList.add('screen-hidden');
  El.hud.classList.remove('screen-hidden');
  El.swipeHint.classList.remove('screen-hidden');
  startGame();
}



function buildGround() {
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(30,30),
    new THREE.MeshLambertMaterial({color:0x2d7a27, transparent:true, opacity:0.88})
  );
  grass.rotation.x=-Math.PI/2; grass.receiveShadow=true; gameGroup.add(grass);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.48,0.54,48),
    new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.DoubleSide,transparent:true,opacity:0.4})
  );
  ring.rotation.x=-Math.PI/2; ring.position.set(0,0.01,CFG.BALL_Z); gameGroup.add(ring);

  const lm = new THREE.LineBasicMaterial({color:0xffffff,transparent:true,opacity:0.2});
  const hw = CFG.GOAL_W/2+0.5;
  gameGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-hw,0.01,CFG.GOAL_Z), new THREE.Vector3(-hw,0.01,CFG.BALL_Z+0.8),
    new THREE.Vector3( hw,0.01,CFG.BALL_Z+0.8), new THREE.Vector3( hw,0.01,CFG.GOAL_Z),
  ]), lm));
}

function buildTrajectoryDots() {
  const mat = new THREE.MeshBasicMaterial({color:0xFFD700, transparent:true, opacity:0.8});
  for(let i=0; i<CFG.TRAJ_DOTS; i++){
    const d = new THREE.Mesh(new THREE.SphereGeometry(0.045,8,8), mat.clone());
    d.visible=false; gameGroup.add(d); trajDots.push(d);
  }
}

function addYupiBanner() {
  const cvs=document.createElement('canvas'); cvs.width=1024; cvs.height=256;
  const ctx=cvs.getContext('2d');
  ctx.fillStyle='#F7C948';
  ctx.beginPath(); ctx.roundRect(0,0,1024,256,40); ctx.fill();
  ctx.font='bold 190px Fredoka One,Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  // Colors: Y=red, u=blue, p=WHITE (yellow-on-yellow is invisible!), i=green
  ['#E31E24','#0055B3','#FFFFFF','#00A34A'].forEach((c,i)=>{ ctx.fillStyle=c; ctx.fillText('Yupi'[i],200+i*220,128); });
  const b=new THREE.Mesh(new THREE.PlaneGeometry(4.0,0.95),
    new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(cvs),side:THREE.DoubleSide}));
  b.position.set(0,CFG.GOAL_H+0.7,CFG.GOAL_Z); gameGroup.add(b);
}

/* ── Confetti particles ── */
function buildConfettiPool() {
  const colors=[0xe31b23,0xffc703,0x008540,0x0055b3,0xffffff];
  for(let i=0;i<30;i++){
    const m=new THREE.Mesh(
      new THREE.PlaneGeometry(0.12,0.07),
      new THREE.MeshBasicMaterial({color:colors[i%colors.length],side:THREE.DoubleSide,transparent:true})
    );
    m.visible=false; m.userData={vx:0,vy:0,vz:0,life:0};
    gameGroup.add(m); confettiParticles.push(m);
  }
}

function burstConfetti(x,y,z) {
  confettiParticles.forEach(p=>{
    p.position.set(x+(Math.random()-0.5)*0.5, y+(Math.random()-0.5)*0.3, z);
    p.rotation.set(Math.random()*Math.PI,Math.random()*Math.PI,Math.random()*Math.PI);
    p.userData.vx=(Math.random()-0.5)*0.08;
    p.userData.vy=0.04+Math.random()*0.08;
    p.userData.vz=(Math.random()-0.5)*0.04;
    p.userData.life=1.0;
    p.material.opacity=1; p.visible=true;
  });
}

function tickConfetti() {
  confettiParticles.forEach(p=>{
    if(!p.visible) return;
    p.userData.life-=0.025;
    if(p.userData.life<=0){ p.visible=false; return; }
    p.position.x+=p.userData.vx;
    p.position.y+=p.userData.vy;
    p.position.z+=p.userData.vz;
    p.userData.vy-=0.003; // gravity
    p.rotation.x+=0.08; p.rotation.z+=0.05;
    p.material.opacity=p.userData.life;
  });
}

/* ════════════════════════════════════════
   CAMERA STREAM
════════════════════════════════════════ */
async function initCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video:{facingMode:'environment',width:{ideal:1280},height:{ideal:720}}, audio:false
    });
    const vid = Object.assign(document.createElement('video'),
      {srcObject:stream, playsInline:true, muted:true, autoplay:true});
    await vid.play().catch(e=>console.warn('video play blocked',e));
    const vt = new THREE.VideoTexture(vid);
    vt.minFilter = THREE.LinearFilter;
    scene.background = vt;
  } catch(e) { console.warn('Camera denied:', e); }
}

/* ════════════════════════════════════════
   KEEPER AI
════════════════════════════════════════ */
function tickKeeper(dt) {
  if(!S.active) return;
  keeperPhase += dt;
  if(keeperMesh) keeperMesh.position.x = Math.sin(keeperPhase*(Math.PI*2/CFG.KEEPER_CYCLE))*CFG.KEEPER_PATROL;
  if(mixer) mixer.update(dt);
}

/* ════════════════════════════════════════
   SWIPE CONTROLS
════════════════════════════════════════ */
function initSwipeControls(canvas) {
  const cvs = canvas || renderer?.domElement;
  if (!cvs) return;
  cvs.addEventListener('touchstart', onTS, {passive:false});
  cvs.addEventListener('touchmove',  onTM, {passive:false});
  cvs.addEventListener('touchend',   onTE, {passive:false});
  // Mouse fallback for desktop
  cvs.addEventListener('mousedown', e => onTS({touches:[e],preventDefault:()=>{}}));
  cvs.addEventListener('mousemove', e => { if(e.buttons) onTM({touches:[e],preventDefault:()=>{}}); });
  cvs.addEventListener('mouseup',   e => onTE({changedTouches:[e],preventDefault:()=>{}}));
  // Power canvas
  El.powerCanvas.width=innerWidth; El.powerCanvas.height=innerHeight;
  powerCtx = El.powerCanvas.getContext('2d');
}

function onTS(e) {
  e.preventDefault();
  if(!S.active||S.shooting) return;
  const t=e.touches[0]; touch0={x:t.clientX, y:t.clientY};
  if(El.swipeHint) El.swipeHint.classList.add('screen-hidden');
}

function onTM(e) {
  e.preventDefault();
  if(!S.active||S.shooting||!touch0) return;
  const t=e.touches[0];
  const dx=t.clientX-touch0.x, dy=t.clientY-touch0.y;
  showTrajectory(dx,dy);
  drawPowerRing(Math.min(Math.hypot(dx,dy)/CFG.MAX_SWIPE,1));
}

function onTE(e) {
  if(!S.active||S.shooting||!touch0) return;
  const t=e.changedTouches[0];
  const dx=t.clientX-touch0.x, dy=t.clientY-touch0.y;
  const mag=Math.hypot(dx,dy);
  touch0=null; clearTrajectory(); clearPowerRing();
  if(mag>15) {
    Snd.kick();
    const power=Math.min(mag/CFG.MAX_SWIPE,1);
    const aimX=Math.max(-CFG.GOAL_W/2, Math.min(CFG.GOAL_W/2, (dx/CFG.MAX_SWIPE)*(CFG.GOAL_W*0.6)));
    const aimY=CFG.GOAL_H*(0.2+Math.max(0,-dy/CFG.MAX_SWIPE)*0.8);
    shoot(aimX, Math.min(aimY, CFG.GOAL_H+0.1), power);
  }
}

/* ── Trajectory dots ── */
function showTrajectory(dx, dy) {
  if(!ballMesh) return;
  const power=Math.min(Math.hypot(dx,dy)/CFG.MAX_SWIPE,1);
  if(power<0.05){ clearTrajectory(); return; }
  const aimX=Math.max(-CFG.GOAL_W/2, Math.min(CFG.GOAL_W/2,(dx/CFG.MAX_SWIPE)*(CFG.GOAL_W*0.6)));
  const aimY=CFG.GOAL_H*(0.2+Math.max(0,-dy/CFG.MAX_SWIPE)*0.8);
  const sx=ballMesh.position.x, sy=ballMesh.position.y, sz=ballMesh.position.z;
  trajDots.forEach((dot,i) => {
    const t=(i+1)/(CFG.TRAJ_DOTS+1);
    dot.position.set(
      sx+(aimX-sx)*t,
      sy+(aimY-sy)*t+Math.sin(t*Math.PI)*(0.4+power*0.7),
      sz+(CFG.GOAL_Z-sz)*t
    );
    dot.material.opacity=0.85-t*0.5;
    dot.visible=true;
  });
}
function clearTrajectory(){ trajDots.forEach(d=>d.visible=false); }

/* ── Power ring (2D canvas) ── */
function drawPowerRing(pct) {
  if(!powerCtx||!ballMesh) return;
  const w=El.powerCanvas.width, h=El.powerCanvas.height;
  powerCtx.clearRect(0,0,w,h);
  const bp=ballMesh.position.clone().project(camera);
  const cx=(bp.x*0.5+0.5)*w, cy=(-bp.y*0.5+0.5)*h, r=52;
  powerCtx.beginPath(); powerCtx.arc(cx,cy,r,0,Math.PI*2);
  powerCtx.strokeStyle='rgba(255,255,255,0.18)'; powerCtx.lineWidth=6; powerCtx.stroke();
  const hue=120-pct*120;
  powerCtx.beginPath(); powerCtx.arc(cx,cy,r,-Math.PI/2,-Math.PI/2+pct*Math.PI*2);
  powerCtx.strokeStyle=`hsl(${hue},90%,55%)`; powerCtx.lineWidth=6;
  powerCtx.lineCap='round'; powerCtx.stroke();
}
function clearPowerRing(){ if(powerCtx) powerCtx.clearRect(0,0,El.powerCanvas.width,El.powerCanvas.height); }

/* ════════════════════════════════════════
   SHOOT & COLLISION
════════════════════════════════════════ */
function shoot(aimX, aimY, power) {
  if(!S.active||S.shooting||S.timeRemaining<=0) return;
  S.shooting=true;
  const sx=ballMesh.position.x, sy=ballMesh.position.y, sz=ballMesh.position.z;
  const dur=CFG.SHOOT_MS*(0.55+power*0.45);
  const t0=performance.now();
  (function fly(now){
    const t=Math.min((now-t0)/dur,1);
    const e=t<0.5?2*t*t:-1+(4-2*t)*t;
    ballMesh.position.set(sx+(aimX-sx)*e, sy+(aimY-sy)*e+Math.sin(t*Math.PI)*0.5, sz+(CFG.GOAL_Z-sz)*e);
    ballMesh.rotation.x+=0.15; ballMesh.rotation.z+=0.07;
    if(t<1) requestAnimationFrame(fly);
    else resolveShot(aimX,aimY);
  })(t0);
}

function resolveShot(bx, by) {
  const kx=keeperMesh ? keeperMesh.position.x : 0;
  const saved=Math.abs(bx-kx)<0.9 && by>0.1 && by<CFG.GOAL_H+0.2;
  const goal=!saved && Math.abs(bx)<CFG.GOAL_W/2 && by>0.1 && by<CFG.GOAL_H+0.1;
  if(saved){
    S.saves++; El.scoreCandy.textContent=S.saves;
    Snd.save();
    // Keeper dive tilt
    if(keeperMesh) { keeperMesh.rotation.z = bx > kx ? -0.7 : 0.7; setTimeout(()=>{ if(keeperMesh) keeperMesh.rotation.z=0; },600); }
    showFeedback('😅','SAVED!','saved');
  } else if(goal){
    S.goals++; S.points+=CFG.POINTS_PER_GOAL;
    El.scoreYou.textContent=S.points;
    El.scoreYou.classList.remove('pop'); void El.scoreYou.offsetWidth; El.scoreYou.classList.add('pop');
    Snd.goal();
    burstConfetti(bx, by, CFG.GOAL_Z+0.2);
    showFeedback('⚽','GOAL!','goal');
  } else {
    Snd.miss();
    showFeedback('😬','MISS!','miss');
  }
  setTimeout(()=>{
    ballMesh.position.set(0,CFG.BALL_Y,CFG.BALL_Z); ballMesh.rotation.set(0,0,0);
    S.shooting=false;
  },1000);
}

/* ── Feedback ── */
function showFeedback(emoji,text,cls) {
  El.feedback.className='feedback '+cls;
  El.fbEmoji.textContent=emoji; El.fbText.textContent=text;
  El.feedback.classList.remove('screen-hidden');
  clearTimeout(El.feedback._t);
  El.feedback._t=setTimeout(()=>El.feedback.classList.add('screen-hidden'),1300);
}

/* ════════════════════════════════════════
   GAME FLOW
════════════════════════════════════════ */
function updateTimerDisplay() {
  El.hudTimer.textContent=S.timeRemaining+'s';
  El.hudTimer.style.color=S.timeRemaining<=10?'#FF5252':'#fff';
}

function startGame() {
  Object.assign(S,{goals:0,saves:0,points:0,timeRemaining:CFG.TIME_LIMIT,shooting:false,active:true});
  El.scoreYou.textContent=0; El.scoreCandy.textContent=0;
  if(ballMesh) { ballMesh.position.set(0,CFG.BALL_Y,CFG.BALL_Z); ballMesh.rotation.set(0,0,0); }
  if(keeperMesh) keeperMesh.position.x=0;
  keeperPhase=0; updateTimerDisplay();
  El.start.classList.add('screen-hidden');
  El.gameover.classList.add('screen-hidden');
  El.hud.classList.remove('screen-hidden');
  El.swipeHint.classList.remove('screen-hidden');
  clearInterval(gameTimerInterval);
  gameTimerInterval=setInterval(()=>{
    if(!S.active) return clearInterval(gameTimerInterval);
    S.timeRemaining--;
    updateTimerDisplay();
    if(S.timeRemaining<=0){ clearInterval(gameTimerInterval); S.shooting?setTimeout(endGame,1200):endGame(); }
  },1000);
}

function endGame() {
  S.active=false;
  El.hud.classList.add('screen-hidden');
  El.swipeHint.classList.add('screen-hidden');
  El.gameover.classList.remove('screen-hidden');
  El.goGoals.textContent=S.points; El.goTotal.textContent=S.goals;
  if(S.goals>=10){ El.goTitle.textContent='PERFECT!'; El.goRating.textContent='🏆 WORLD CLASS STRIKER'; }
  else if(S.goals>=6){ El.goTitle.textContent='GREAT JOB!'; El.goRating.textContent='⭐ PRO LEVEL'; }
  else if(S.goals>=3){ El.goTitle.textContent='NOT BAD!'; El.goRating.textContent='👟 KEEP KICKING'; }
  else { El.goTitle.textContent='KEEP TRYING'; El.goRating.textContent='💪 TRAIN HARDER'; }
  saveScore(S.points);
  generateShareCard();
}

/* ── Score Share Card ── */
function generateShareCard() {
  const cvs=document.createElement('canvas');
  cvs.width=1080; cvs.height=1080;
  const ctx=cvs.getContext('2d');
  // Background gradient
  const bg=ctx.createLinearGradient(0,0,0,1080);
  bg.addColorStop(0,'#b90014'); bg.addColorStop(1,'#7a0009');
  ctx.fillStyle=bg; ctx.fillRect(0,0,1080,1080);
  // Yellow arc top
  ctx.fillStyle='#ffc703';
  ctx.beginPath(); ctx.arc(540,-120,580,0,Math.PI); ctx.fill();
  // Title
  ctx.fillStyle='#ffffff'; ctx.textAlign='center';
  ctx.font='bold 64px Plus Jakarta Sans,Arial'; ctx.fillText('YUPI AR SHOOTOUT',540,200);
  // Score circle
  ctx.fillStyle='#ffffff'; ctx.beginPath(); ctx.arc(540,520,220,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#b90014'; ctx.font='bold 140px Plus Jakarta Sans,Arial'; ctx.fillText(S.points,540,560);
  ctx.font='bold 36px Plus Jakarta Sans,Arial'; ctx.fillStyle='#7a0009'; ctx.fillText('POINTS',540,620);
  // Goals row
  ctx.fillStyle='rgba(255,255,255,0.15)';
  ctx.beginPath(); ctx.roundRect(140,780,360,120,24); ctx.fill();
  ctx.beginPath(); ctx.roundRect(580,780,360,120,24); ctx.fill();
  ctx.fillStyle='#fff'; ctx.font='bold 60px Plus Jakarta Sans,Arial';
  ctx.fillText(S.goals,320,860); ctx.fillText(S.saves,760,860);
  ctx.font='bold 24px Plus Jakarta Sans,Arial'; ctx.fillStyle='rgba(255,255,255,0.7)';
  ctx.fillText('GOALS',320,900); ctx.fillText('SAVES',760,900);
  // Tagline
  ctx.fillStyle='#ffc703'; ctx.font='bold 34px Plus Jakarta Sans,Arial';
  ctx.fillText('GUMMY FUN, GOAL WON! 🍬⚽',540,1020);

  // Show share button
  const shareBtn=$('btn-share-score');
  if(shareBtn) {
    shareBtn.classList.remove('screen-hidden');
    shareBtn.onclick=async()=>{
      cvs.toBlob(async blob=>{
        const file=new File([blob],'yupi-score.png',{type:'image/png'});
        if(navigator.canShare&&navigator.canShare({files:[file]})){
          await navigator.share({title:'Yupi AR Shootout',text:`I scored ${S.points} pts in Yupi AR! 🍬⚽ GUMMY FUN, GOAL WON!`,files:[file]});
        } else {
          // Fallback: download
          const a=document.createElement('a'); a.href=cvs.toDataURL();
          a.download='yupi-score.png'; a.click();
        }
      });
    };
  }
}

/* renderLoop removed — XR8 onUpdate handles the render cycle.
   Fallback loop is inlined in startFallbackSession(). */


/* ════════════════════════════════════════
   ERROR DISPLAY
════════════════════════════════════════ */
function showBootError(msg) {
  El.splashHint.textContent='⚠️ '+msg;
  El.splashHint.style.cssText='color:#FF5252;font-size:13px;padding:0 16px;line-height:1.5';
  El.splashBar.style.background='#E31E24';
  const btn=document.createElement('button');
  btn.textContent='🔄 Tap to Reload';
  btn.style.cssText='margin-top:16px;padding:10px 24px;background:#F7C948;border:none;border-radius:24px;font-size:16px;font-weight:bold;cursor:pointer';
  btn.onclick=()=>location.reload();
  El.splashHint.after(btn);
}

/* ════════════════════════════════════════
   BOOT — load GLB assets then build scene
════════════════════════════════════════ */
async function boot() {
  try {
    El.splashBar.style.width='5%';
    El.splashHint.textContent='Initializing…';
    clock = new THREE.Clock(); // gameGroup already created at module level

    // Ball: always use a visible procedural sphere (bola.glb materials are unreliable)
    const ballGroup = new THREE.Group();
    const ballSphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 32, 32),
      new THREE.MeshStandardMaterial({color:0xE31E24, roughness:0.35, metalness:0.05})
    );
    ballSphere.castShadow = true;
    // Black pentagon patches for soccer look
    const patchMat = new THREE.MeshStandardMaterial({color:0x111111, roughness:0.5});
    [0,60,120,180,240,300].forEach(deg => {
      const patch = new THREE.Mesh(new THREE.SphereGeometry(0.045,8,8), patchMat);
      const r = Math.PI*deg/180;
      patch.position.set(Math.cos(r)*0.11, 0.06, Math.sin(r)*0.11);
      ballGroup.add(patch);
    });
    ballGroup.add(ballSphere);
    ballGroup.position.set(0, CFG.BALL_Y, CFG.BALL_Z);
    ballGroup.castShadow = true;
    gameGroup.add(ballGroup);
    ballMesh = ballGroup;
    El.splashBar.style.width = '25%';

    El.splashBar.style.width='28%';
    El.splashHint.textContent='Loading goal…';
    const gawangGLB = await loadGLTF('assets/gawang.glb', p=>{
      El.splashBar.style.width=(28+p*17)+'%';
    });
    normalizeFBXByHeight(gawangGLB, CFG.GOAL_H);
    gawangGLB.position.set(0, 0, CFG.GOAL_Z);
    fixFBXMaterials(gawangGLB);
    gameGroup.add(gawangGLB);
    gawangMesh=gawangGLB;

    El.splashBar.style.width='46%';
    El.splashHint.textContent='Loading Reddie…';
    const reddieGLB = await loadGLTF('assets/reddie.glb', p=>{
      El.splashBar.style.width=(46+p*44)+'%';
    });
    // Reddie = 0.55m tall, slightly shorter than 0.9m goal
    normalizeFBXByHeight(reddieGLB, 0.55);
    reddieGLB.position.set(0, 0, CFG.GOAL_Z + 0.2);
    fixFBXMaterials(reddieGLB);
    if(reddieGLB.animations && reddieGLB.animations.length>0){
      mixer=new THREE.AnimationMixer(reddieGLB);
      mixer.clipAction(reddieGLB.animations[0]).play();
    }
    gameGroup.add(reddieGLB);
    keeperMesh=reddieGLB;

    El.splashBar.style.width='95%';
    El.splashHint.textContent='Almost ready…';

    El.splashBar.style.width='100%';
    El.splashHint.textContent='Ready!';
    await new Promise(r=>setTimeout(r,300));

    El.splash.classList.add('screen-hidden');
    El.regScreen.classList.remove('screen-hidden');

  } catch(err) {
    console.error('[Yupi AR] Boot error:', err);
    showBootError(err.message || 'Load failed. Please reload.');
  }
}

/* ════════════════════════════════════════
   REGISTRATION
════════════════════════════════════════ */
El.btnReg.onclick = async () => {
  const name=El.regName.value.trim();
  if(!name){ alert('Please enter a nickname.'); return; }
  El.btnReg.textContent='STARTING…'; El.btnReg.disabled=true;
  registerPlayer(name).catch(e=>console.warn('Firebase reg failed:',e));
  El.regScreen.classList.add('screen-hidden');

  // Show a loading cover so user never sees blank screen during camera init
  const cover = Object.assign(document.createElement('div'), {
    id:'cam-cover',
    innerHTML:'<div style="text-align:center"><div style="font-size:48px">📷</div><div style="margin-top:12px;font-size:18px;font-weight:700">Starting camera…</div><div style="margin-top:8px;font-size:13px;opacity:.7">Allow camera access when prompted</div></div>',
  });
  cover.style.cssText='position:fixed;inset:0;background:#000;color:#FFD700;display:flex;align-items:center;justify-content:center;z-index:500;font-family:Plus Jakarta Sans,sans-serif';
  document.body.appendChild(cover);

  try {
    await initScene();
  } catch(err) {
    cover.innerHTML=`<div style="text-align:center"><div style="font-size:36px">⚠️</div><div style="margin:12px 0;font-size:16px">${err.message||'Camera failed'}</div><button onclick="location.reload()" style="padding:10px 24px;background:#FFD700;border:none;border-radius:24px;font-size:15px;font-weight:700;cursor:pointer">🔄 Retry</button></div>`;
    return;
  }

  cover.remove();
  El.start.classList.remove('screen-hidden');
};


/* ── Leaderboard ── */
$('btn-leaderboard').onclick = async () => {
  El.lbScreen.classList.remove('screen-hidden');
  El.lbList.innerHTML='<div class="lb-loading">Loading scores...</div>';
  const scores=await fetchLeaderboard();
  if(!scores.length){ El.lbList.innerHTML='<div class="lb-loading">No scores yet.</div>'; return; }
  El.lbList.innerHTML='';
  let myHTML='<span class="lb-col-rank">-</span><span class="lb-col-player">-</span><span class="lb-col-score">-</span>';
  scores.forEach((entry,i)=>{
    const row=document.createElement('div'); row.className='lb-row';
    row.innerHTML=`<span class="lb-col-rank">${i+1}</span><span class="lb-col-player">${entry.name||'Anon'}</span><span class="lb-col-score">${entry.points||0}</span>`;
    if(entry.id===PlayerState.docId){ row.style.background='rgba(247,201,72,0.15)'; myHTML=row.innerHTML; }
    El.lbList.appendChild(row);
  });
  El.lbMyRow.innerHTML=myHTML;
};
El.btnCloseLb.onclick=()=>El.lbScreen.classList.add('screen-hidden');

/* ── Controls ── */
$('btn-start').onclick = startFallbackSession;
$('btn-restart').onclick = () => { gamePlaced=true; startGame(); };

/* ── Boot ── */
window.addEventListener('DOMContentLoaded', ()=>boot().catch(err=>{
  console.error('[Yupi AR] Fatal:', err);
  showBootError(err.message||'Unexpected error.');
}));
