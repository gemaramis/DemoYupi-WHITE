/**
 * YUPI AR PENALTY SHOOTOUT v2 — game.js
 * Swipe-to-shoot | FBX assets | Three.js ES modules
 */
"use strict";

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { registerPlayer, saveScore, fetchLeaderboard, PlayerState } from './firebase-db.js';

/* ── CONFIG ── */
const CFG = {
  TIME_LIMIT: 15, POINTS_PER_GOAL: 100,
  GOAL_W: 4.0, GOAL_H: 2.8, GOAL_Z: -5.5,
  BALL_Y: 0.22, BALL_Z: 1.2,
  KEEPER_PATROL: 1.6, KEEPER_CYCLE: 2.2,
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

/* ════════════════════════════════════════
   FBX HELPERS
════════════════════════════════════════ */
function loadFBX(url, onPct) {
  return new Promise((resolve, reject) => {
    const loader = new FBXLoader();
    loader.load(url, resolve, xhr => onPct && onPct(xhr.loaded / (xhr.total || 1)), reject);
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

/** Fix common FBX material issues (backface, transparency). */
function fixFBXMaterials(group) {
  group.traverse(c => {
    if (!c.isMesh) return;
    c.castShadow = true;
    c.receiveShadow = true;
    const mats = Array.isArray(c.material) ? c.material : [c.material];
    mats.forEach(m => {
      m.side = THREE.DoubleSide;
      m.depthWrite = true;
      m.needsUpdate = true;
    });
  });
}

/* ════════════════════════════════════════
   SCENE INIT
════════════════════════════════════════ */
async function preInitScene() {
  try {
    renderer = new THREE.WebGLRenderer({ antialias:false, alpha:true, powerPreference:'high-performance' });
  } catch(e) { throw new Error('WebGL unavailable: ' + e.message); }

  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  $('ar-container').appendChild(renderer.domElement);

  clock = new THREE.Clock();
  camera = new THREE.PerspectiveCamera(55, innerWidth/innerHeight, 0.1, 150);
  camera.position.set(0, 1.65, 3.8);
  camera.lookAt(0, 0.8, CFG.GOAL_Z);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a1020);

  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const sun = new THREE.DirectionalLight(0xffffff, 1.3);
  sun.position.set(3, 12, 4); sun.castShadow=true;
  sun.shadow.mapSize.set(512,512); scene.add(sun);
  const fill = new THREE.PointLight(0x4488ff, 0.5, 25);
  fill.position.set(-3,5,-3); scene.add(fill);
  const rim = new THREE.PointLight(0xffaa33, 0.4, 20);
  rim.position.set(3,4,4); scene.add(rim);

  buildGround();
  buildTrajectoryDots();
  addYupiBanner();

  window.addEventListener('resize', () => {
    camera.aspect = innerWidth/innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    if(El.powerCanvas){ El.powerCanvas.width=innerWidth; El.powerCanvas.height=innerHeight; }
  });
  renderLoop();
}

function buildGround() {
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(30,30),
    new THREE.MeshLambertMaterial({color:0x2d7a27, transparent:true, opacity:0.88})
  );
  grass.rotation.x=-Math.PI/2; grass.receiveShadow=true; scene.add(grass);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.48,0.54,48),
    new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.DoubleSide,transparent:true,opacity:0.4})
  );
  ring.rotation.x=-Math.PI/2; ring.position.set(0,0.01,CFG.BALL_Z); scene.add(ring);

  const lm = new THREE.LineBasicMaterial({color:0xffffff,transparent:true,opacity:0.2});
  const hw = CFG.GOAL_W/2+0.5;
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-hw,0.01,CFG.GOAL_Z), new THREE.Vector3(-hw,0.01,CFG.BALL_Z+0.8),
    new THREE.Vector3( hw,0.01,CFG.BALL_Z+0.8), new THREE.Vector3( hw,0.01,CFG.GOAL_Z),
  ]), lm));
}

function buildTrajectoryDots() {
  const mat = new THREE.MeshBasicMaterial({color:0xFFD700, transparent:true, opacity:0.8});
  for(let i=0; i<CFG.TRAJ_DOTS; i++){
    const d = new THREE.Mesh(new THREE.SphereGeometry(0.045,8,8), mat.clone());
    d.visible=false; scene.add(d); trajDots.push(d);
  }
}

function addYupiBanner() {
  const cvs=document.createElement('canvas'); cvs.width=1024; cvs.height=256;
  const ctx=cvs.getContext('2d');
  ctx.fillStyle='#F7C948';
  ctx.beginPath(); ctx.roundRect(0,0,1024,256,40); ctx.fill();
  ctx.font='bold 190px Fredoka One,Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ['#E31E24','#0055B3','#F7C948','#00A34A'].forEach((c,i)=>{ ctx.fillStyle=c; ctx.fillText('Yupi'[i],200+i*220,128); });
  const b=new THREE.Mesh(new THREE.PlaneGeometry(4.0,0.95),
    new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(cvs),side:THREE.DoubleSide}));
  b.position.set(0,CFG.GOAL_H+0.7,CFG.GOAL_Z); scene.add(b);
}

function addStadiumSprite(tex) {
  if(!tex) return;
  const s=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,opacity:0.55}));
  s.scale.set(28,9,1); s.position.set(0,5.5,-18); scene.add(s);
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
function initSwipeControls() {
  const cvs = renderer.domElement;
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
  if(saved){ S.saves++; El.scoreCandy.textContent=S.saves; showFeedback('😅','SAVED!','saved'); }
  else if(goal){
    S.goals++; S.points+=CFG.POINTS_PER_GOAL;
    El.scoreYou.textContent=S.points;
    El.scoreYou.classList.remove('pop'); void El.scoreYou.offsetWidth; El.scoreYou.classList.add('pop');
    showFeedback('⚽','GOAL!','goal');
  } else { showFeedback('😬','MISS!','miss'); }
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
}

/* ── Render loop ── */
function renderLoop() {
  requestAnimationFrame(renderLoop);
  const dt=clock.getDelta();
  if(ballMesh && !S.shooting) ballMesh.rotation.y+=0.006;
  tickKeeper(dt);
  renderer.render(scene,camera);
}

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
   BOOT — load FBX assets then build scene
════════════════════════════════════════ */
async function boot() {
  try {
    El.splashBar.style.width='5%';
    El.splashHint.textContent='Starting engine…';
    await preInitScene();

    El.splashBar.style.width='15%';
    El.splashHint.textContent='Loading ball…';
    const bolaFBX = await loadFBX('assets/bola.fbx', p=>{
      El.splashBar.style.width=(15+p*10)+'%';
    });
    normalizeFBX(bolaFBX, 0.44);
    bolaFBX.position.set(0, CFG.BALL_Y, CFG.BALL_Z);
    fixFBXMaterials(bolaFBX);
    scene.add(bolaFBX);
    ballMesh=bolaFBX;

    El.splashBar.style.width='28%';
    El.splashHint.textContent='Loading goal…';
    const gawangFBX = await loadFBX('assets/gawang.fbx', p=>{
      El.splashBar.style.width=(28+p*17)+'%';
    });
    // Normalize by HEIGHT so goal is always taller than keeper
    normalizeFBXByHeight(gawangFBX, CFG.GOAL_H);
    gawangFBX.position.set(0, 0, CFG.GOAL_Z);
    fixFBXMaterials(gawangFBX);
    scene.add(gawangFBX);
    gawangMesh=gawangFBX;

    El.splashBar.style.width='46%';
    El.splashHint.textContent='Loading Reddie… (9 MB)';
    const reddieFBX = await loadFBX('assets/Reddie.fbx', p=>{
      El.splashBar.style.width=(46+p*44)+'%';
    });
    // Reddie slightly shorter than goal post
    normalizeFBXByHeight(reddieFBX, CFG.GOAL_H * 0.7);
    reddieFBX.position.set(0, 0, CFG.GOAL_Z+0.55);
    fixFBXMaterials(reddieFBX);
    if(reddieFBX.animations && reddieFBX.animations.length>0){
      mixer=new THREE.AnimationMixer(reddieFBX);
      mixer.clipAction(reddieFBX.animations[0]).play();
    }
    scene.add(reddieFBX);
    keeperMesh=reddieFBX;

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
  El.btnReg.textContent='LAUNCHING AR…'; El.btnReg.disabled=true;
  registerPlayer(name).catch(e=>console.warn('Firebase reg failed:',e));
  El.regScreen.classList.add('screen-hidden');
  await initCamera();
  initSwipeControls();
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
$('btn-start').onclick=startGame;
$('btn-restart').onclick=startGame;

/* ── Boot ── */
window.addEventListener('DOMContentLoaded', ()=>boot().catch(err=>{
  console.error('[Yupi AR] Fatal:', err);
  showBootError(err.message||'Unexpected error.');
}));
