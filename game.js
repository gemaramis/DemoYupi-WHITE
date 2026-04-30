/**
 * YUPI AR PENALTY SHOOTOUT — game.js
 * Three.js | Ground-placed AR | Yupi branding
 */
"use strict";

import { registerPlayer, saveScore, fetchLeaderboard, PlayerState } from "./firebase-db.js";

/* ── CONFIG ── */
const CFG = {
  TIME_LIMIT: 60,
  POINTS_PER_GOAL: 100,
  GOAL_W: 3.8, GOAL_H: 2.2, GOAL_Z: -7,
  BALL_Y: 0.22, BALL_Z: 0,
  KEEPER_RANGE: 1.5, KEEPER_SPEED: 0.03,
  AIM_STEP: 0.35, MAX_AIM: 1.7,
  SHOOT_MS: 700,
};

/* ── STATE ── */
const S = { goals:0, saves:0, points:0, timeRemaining:CFG.TIME_LIMIT, shooting:false, active:false, aimX:0 };

/* ── DOM ── */
const $ = id => document.getElementById(id);
const El = {
  splash: $('splash'), splashBar: $('splash-bar'), splashHint: $('splash-hint'),
  start: $('start-screen'), hud: $('hud'), feedback: $('feedback'),
  fbEmoji: $('feedback-emoji'), fbText: $('feedback-text'),
  gameover: $('gameover'), aim: $('aim-indicator'),
  scoreYou: $('score-you'), scoreCandy: $('score-candy'),
  shotsPips: $('shots-pips'), goGoals: $('go-goals'),
  goTotal: $('go-total'), goTitle: $('go-title'), goRating: $('go-rating'),
  hudTimer: $('hud-timer'),
  
  // Registration
  regScreen: $('registration-screen'), btnReg: $('btn-submit-reg'),
  regName: $('reg-name'),
  
  // Leaderboard
  lbScreen: $('leaderboard-screen'), lbList: $('lb-list'), lbMyRow: $('lb-my-row'), btnCloseLb: $('btn-close-lb')
};

/* ── THREE ── */
let renderer, scene, camera, ball, keeper, keeperTarget = 0, keeperTimer = 0;
let texLoader;

/**
 * Wait until the defer-loaded THREE global is available.
 * Typically resolves in <50 ms after DOMContentLoaded fires.
 */
function waitForThree() {
  return new Promise(resolve => {
    if (typeof THREE !== 'undefined') { resolve(); return; }
    const iv = setInterval(() => {
      if (typeof THREE !== 'undefined') { clearInterval(iv); resolve(); }
    }, 30);
  });
}

/** Promisify THREE.TextureLoader.load so we can await it. */
function loadTexture(url) {
  return new Promise((resolve, reject) =>
    texLoader.load(url, resolve, undefined, reject)
  );
}

/* ════════════════════════════════════════
   PHASE 1: Pre-build scene (no camera) — called during splash
════════════════════════════════════════ */
async function preInitScene() {
  // Catch WebGL init failures explicitly
  try {
    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' });
  } catch (e) {
    throw new Error('WebGL failed to start. Try a different browser or enable hardware acceleration. (' + e.message + ')');
  }

  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  $('ar-container').appendChild(renderer.domElement);

  camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 100);
  camera.position.set(0, 1.6, 3.5);
  camera.lookAt(0, 1, CFG.GOAL_Z);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a1020);

  // Lights
  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(3, 10, 3); sun.castShadow = true;
  sun.shadow.mapSize.set(512, 512); // was 1024 — halved for performance
  scene.add(sun);
  const fillLight = new THREE.PointLight(0x4488ff, 0.6, 20);
  fillLight.position.set(-3, 4, -3);
  scene.add(fillLight);

  buildGround(); buildGoal(); buildBall();
  addYupiBanner();

  window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  renderLoop();
}

/* ════════════════════════════════════════
   PHASE 2: Attach camera feed — called after user gesture
════════════════════════════════════════ */
async function initCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      // 720p is sufficient for WebAR and requests faster on mobile
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false
    });
    const vid = Object.assign(document.createElement('video'), {
      srcObject: stream, playsInline: true, muted: true, autoplay: true
    });
    await vid.play().catch(e => console.warn('Video play prevented:', e));
    const vt = new THREE.VideoTexture(vid);
    vt.minFilter = THREE.LinearFilter;
    scene.background = vt;
  } catch (e) {
    console.warn('Camera access denied, using dark background:', e);
  }
}

/* ── Ground ── */
function buildGround() {
  // Grass base
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshLambertMaterial({ color:0x2e7d32, transparent:true, opacity:0.85 })
  );
  grass.rotation.x = -Math.PI/2; grass.position.y = 0; grass.receiveShadow = true;
  scene.add(grass);

  // Penalty spot circle
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.62, 48),
    new THREE.MeshBasicMaterial({ color:0xffffff, side:THREE.DoubleSide, transparent:true, opacity:0.5 })
  );
  ring.rotation.x = -Math.PI/2; ring.position.set(0, 0.01, CFG.BALL_Z);
  scene.add(ring);

  // Field lines
  const lineMat = new THREE.LineBasicMaterial({ color:0xffffff, transparent:true, opacity:0.3 });
  const pts = [
    new THREE.Vector3(-CFG.GOAL_W/2, 0.01, CFG.GOAL_Z),
    new THREE.Vector3(-CFG.GOAL_W/2, 0.01, 2.5),
    new THREE.Vector3( CFG.GOAL_W/2, 0.01, 2.5),
    new THREE.Vector3( CFG.GOAL_W/2, 0.01, CFG.GOAL_Z),
  ];
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
}

/* ── Goal ── */
function buildGoal() {
  const postMat = new THREE.MeshStandardMaterial({ color:0xffffff, metalness:0.5, roughness:0.3 });
  const r = 0.07, h = CFG.GOAL_H, w = CFG.GOAL_W, z = CFG.GOAL_Z;

  const mkBox = (sx,sy,sz,x,y,zp) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx,sy,sz), postMat);
    m.position.set(x,y,zp); m.castShadow=true; scene.add(m);
  };
  mkBox(r, h, r, -w/2, h/2, z);       // left post
  mkBox(r, h, r,  w/2, h/2, z);       // right post
  mkBox(w+r, r, r, 0, h, z);          // crossbar
  mkBox(r, r, 0.5, -w/2, h/2, z-0.25); // left side bar
  mkBox(r, r, 0.5,  w/2, h/2, z-0.25); // right side bar

  // Net
  const netMat = new THREE.MeshBasicMaterial({ color:0xffffff, wireframe:true, transparent:true, opacity:0.18 });
  const net = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.6), netMat);
  net.position.set(0, h/2, z-0.3); scene.add(net);
}

/* ── Ball (canvas-textured sphere) ── */
function buildBall() {
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = 512;
  const ctx = cvs.getContext('2d');

  // Sections: red, yellow, blue, green, orange, white
  const colors = ['#E31E24','#F7C948','#0055B3','#00A34A','#FF6D00','#ffffff'];
  const slices = colors.length;
  for (let i=0; i<slices; i++) {
    ctx.beginPath();
    ctx.moveTo(256,256);
    ctx.arc(256,256,256, (i/slices)*Math.PI*2, ((i+1)/slices)*Math.PI*2);
    ctx.fillStyle = colors[i]; ctx.fill();
  }
  // Black seam lines
  ctx.strokeStyle='#111'; ctx.lineWidth=8;
  for (let i=0; i<slices; i++) {
    ctx.beginPath();
    ctx.moveTo(256,256);
    ctx.lineTo(256+260*Math.cos((i/slices)*Math.PI*2), 256+260*Math.sin((i/slices)*Math.PI*2));
    ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(256,256,252,0,Math.PI*2); ctx.stroke();

  ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 32, 32),
    new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(cvs), metalness:0.05, roughness:0.6 })
  );
  ball.position.set(0, CFG.BALL_Y, CFG.BALL_Z);
  ball.castShadow = true;
  scene.add(ball);
}

function buildKeeper(keeperTex) {
  const blue = new THREE.MeshStandardMaterial({ color:0x1565C0, metalness:0.1, roughness:0.3 });
  const dk   = new THREE.MeshStandardMaterial({ color:0x0D47A1, metalness:0.1, roughness:0.3 });
  const eye  = new THREE.MeshStandardMaterial({ color:0x111111 });

  const g = new THREE.Group();
  // Body
  g.add(mkM(new THREE.SphereGeometry(0.38,16,16), blue, 0,0.38,0));
  // Head
  g.add(mkM(new THREE.SphereGeometry(0.29,16,16), blue, 0,0.98,0));
  // Ears
  g.add(mkM(new THREE.SphereGeometry(0.1,8,8), dk, -0.24,1.22,0));
  g.add(mkM(new THREE.SphereGeometry(0.1,8,8), dk,  0.24,1.22,0));
  // Eyes
  g.add(mkM(new THREE.SphereGeometry(0.055,8,8), eye, -0.1,1.01,0.25));
  g.add(mkM(new THREE.SphereGeometry(0.055,8,8), eye,  0.1,1.01,0.25));
  // Arms stretched wide
  const armG = new THREE.SphereGeometry(0.13,8,8);
  const armL = mkM(armG, blue, -0.65,0.48,0); armL.scale.x=2.2; g.add(armL);
  const armR = mkM(armG, blue,  0.65,0.48,0); armR.scale.x=2.2; g.add(armR);
  // Legs
  g.add(mkM(new THREE.SphereGeometry(0.15,8,8), blue, -0.18,-0.12,0));
  g.add(mkM(new THREE.SphereGeometry(0.15,8,8), blue,  0.18,-0.12,0));

  g.position.set(0, 0, CFG.GOAL_Z + 0.55);
  g.scale.set(1.05,1.05,1.05);
  scene.add(g);
  keeper = g;

  // Use pre-loaded texture (no extra network request during game start)
  if (keeperTex) {
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map:keeperTex, transparent:true, alphaTest:0.1 }));
    spr.scale.set(2.2, 2.8, 1);
    spr.position.set(0, 1.1, 0);
    g.add(spr);
  }
}

function mkM(geo, mat, x, y, z) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x,y,z); m.castShadow=true; return m;
}

/* ── Yupi Banner behind goal ── */
function addYupiBanner() {
  const cvs = document.createElement('canvas');
  cvs.width=1024; cvs.height=256;
  const ctx = cvs.getContext('2d');
  // Yellow background
  ctx.fillStyle='#F7C948';
  roundRect(ctx, 0,0,1024,256,40);
  // Yupi text
  ctx.font='bold 200px Fredoka One,Arial';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ['#E31E24','#0055B3','#F7C948','#00A34A'].forEach((c,i) => {
    ctx.fillStyle=c;
    ctx.fillText(['Y','u','p','i'][i], 200+i*220, 130);
  });
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(3.6, 0.9),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cvs), side:THREE.DoubleSide })
  );
  banner.position.set(0, CFG.GOAL_H+0.55, CFG.GOAL_Z);
  scene.add(banner);

  // Yupi side boards
  [[-2.4, '#E31E24'], [2.4, '#0055B3']].forEach(([x, col]) => {
    const bc = document.createElement('canvas'); bc.width=512; bc.height=128;
    const bx = bc.getContext('2d');
    bx.fillStyle=col; bx.fillRect(0,0,512,128);
    bx.fillStyle='#fff'; bx.font='bold 90px Fredoka One,Arial';
    bx.textAlign='center'; bx.textBaseline='middle';
    bx.fillText('Yupi',256,64);
    const sb = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4,0.35),
      new THREE.MeshBasicMaterial({ map:new THREE.CanvasTexture(bc), side:THREE.DoubleSide })
    );
    sb.position.set(x, 0.5, CFG.GOAL_Z);
    scene.add(sb);
  });
}

function roundRect(ctx,x,y,w,h,r){
  ctx.beginPath(); ctx.moveTo(x+r,y);
  ctx.lineTo(x+w-r,y); ctx.arcTo(x+w,y,x+w,y+r,r);
  ctx.lineTo(x+w,y+h-r); ctx.arcTo(x+w,y+h,x+w-r,y+h,r);
  ctx.lineTo(x+r,y+h); ctx.arcTo(x,y+h,x,y+h-r,r);
  ctx.lineTo(x,y+r); ctx.arcTo(x,y,x+r,y,r);
  ctx.closePath(); ctx.fill();
}

/* ── Stadium crowd billboards ── */
function addStadiumSprites(stadiumTex) {
  if (!stadiumTex) return;
  const mat = new THREE.SpriteMaterial({ map:stadiumTex, transparent:true, opacity:0.6 });
  const s = new THREE.Sprite(mat);
  s.scale.set(24, 8, 1);
  s.position.set(0, 5, -16);
  scene.add(s);
}

/* ════════════════════════════════════════
   KEEPER AI
════════════════════════════════════════ */
function tickKeeper() {
  if (!S.active || S.shooting) return;
  keeperTimer--;
  if (keeperTimer <= 0) {
    keeperTarget = (Math.random()-0.5) * CFG.KEEPER_RANGE * 2;
    keeperTimer = 50 + Math.floor(Math.random()*80);
  }
  keeper.position.x += (keeperTarget - keeper.position.x) * CFG.KEEPER_SPEED;

  // Arm wave
  const t = Date.now() * 0.004;
  if (keeper.children[5]) keeper.children[5].rotation.z =  Math.sin(t) * 0.3;
  if (keeper.children[6]) keeper.children[6].rotation.z = -Math.sin(t) * 0.3;
}

/* ════════════════════════════════════════
   AIMING & SHOOTING
════════════════════════════════════════ */
function aimLeft()  { S.aimX = Math.max(-CFG.MAX_AIM, S.aimX - CFG.AIM_STEP); updateAimIndicator(); }
function aimRight() { S.aimX = Math.min( CFG.MAX_AIM, S.aimX + CFG.AIM_STEP); updateAimIndicator(); }

function updateAimIndicator() {
  const pct = (S.aimX + CFG.MAX_AIM) / (CFG.MAX_AIM*2);
  El.aim.style.left = (15 + pct*70) + '%';
}

function shoot() {
  if (!S.active || S.shooting || S.timeRemaining <= 0) return;
  S.shooting = true;

  const tx = S.aimX;
  const ty = CFG.GOAL_H * (0.3 + Math.random()*0.55);
  const tz = CFG.GOAL_Z;
  const sx = ball.position.x, sy = ball.position.y, sz = ball.position.z;
  const t0 = performance.now();

  (function fly(now) {
    const t = Math.min((now-t0)/CFG.SHOOT_MS, 1);
    const e = t<0.5 ? 2*t*t : -1+(4-2*t)*t;
    ball.position.set(
      sx+(tx-sx)*e,
      sy+(ty-sy)*e + Math.sin(t*Math.PI)*0.5,
      sz+(tz-sz)*e
    );
    ball.rotation.x += 0.14; ball.rotation.z += 0.07;
    if (t < 1) requestAnimationFrame(fly);
    else resolveShot(tx, ty);
  })(t0);
}

/* ════════════════════════════════════════
   COLLISION
════════════════════════════════════════ */
function resolveShot(bx, by) {
  const kx = keeper.position.x;
  const saved = Math.abs(bx-kx) < 0.88 && Math.abs(by - CFG.GOAL_H/2) < CFG.GOAL_H/2+0.2;
  const goal  = !saved && Math.abs(bx) < CFG.GOAL_W/2 && by>0.05 && by<CFG.GOAL_H+0.1;

  if (saved) {
    S.saves++;
    El.scoreCandy.textContent = S.saves;
    showFeedback('😅','SAVED!','saved');
  } else if (goal) {
    S.goals++;
    S.points += CFG.POINTS_PER_GOAL;
    El.scoreYou.textContent = S.points;
    El.scoreYou.classList.remove('pop');
    void El.scoreYou.offsetWidth;
    El.scoreYou.classList.add('pop');
    showFeedback('⚽','GOAL!','goal');
  } else {
    showFeedback('😬','MISS!','miss');
  }

  setTimeout(() => {
    ball.position.set(0, CFG.BALL_Y, CFG.BALL_Z);
    ball.rotation.set(0,0,0);
    S.aimX = 0; updateAimIndicator();
    S.shooting = false;
  }, 1000);
}

/* ════════════════════════════════════════
   FEEDBACK
════════════════════════════════════════ */
function showFeedback(emoji, text, cls) {
  El.feedback.className = 'feedback ' + cls;
  El.fbEmoji.textContent = emoji;
  El.fbText.textContent  = text;
  El.feedback.classList.remove('screen-hidden');
  clearTimeout(El.feedback._t);
  El.feedback._t = setTimeout(() => El.feedback.classList.add('screen-hidden'), 1200);
}

/* ════════════════════════════════════════
   HUD & TIMER
════════════════════════════════════════ */
let gameTimerInterval = null;

function updateTimerDisplay() {
  El.hudTimer.textContent = S.timeRemaining + 's';
  if (S.timeRemaining <= 10) El.hudTimer.style.color = '#FF5252';
  else El.hudTimer.style.color = '#fff';
}

/* ════════════════════════════════════════
   GAME FLOW
════════════════════════════════════════ */
function startGame() {
  Object.assign(S, { goals:0, saves:0, points:0, timeRemaining:CFG.TIME_LIMIT, shooting:false, active:true, aimX:0 });
  El.scoreYou.textContent = 0; El.scoreCandy.textContent = 0;
  ball.position.set(0, CFG.BALL_Y, CFG.BALL_Z); ball.rotation.set(0,0,0);
  keeperTimer = 0; keeper.position.x = 0; keeperTarget = 0;
  updateAimIndicator(); updateTimerDisplay();

  El.start.classList.add('screen-hidden');
  El.gameover.classList.add('screen-hidden');
  El.hud.classList.remove('screen-hidden');
  El.aim.classList.remove('screen-hidden');

  clearInterval(gameTimerInterval);
  gameTimerInterval = setInterval(() => {
    if (!S.active) return clearInterval(gameTimerInterval);
    S.timeRemaining--;
    updateTimerDisplay();
    if (S.timeRemaining <= 0) {
      clearInterval(gameTimerInterval);
      if (!S.shooting) endGame();
      else setTimeout(endGame, 1200); // Wait for the last shot to resolve
    }
  }, 1000);
}

function endGame() {
  S.active = false;
  El.hud.classList.add('screen-hidden');
  El.aim.classList.add('screen-hidden');
  El.gameover.classList.remove('screen-hidden');

  El.goGoals.textContent = S.points;
  El.goTotal.textContent = S.goals;

  if      (S.goals>=10) { El.goTitle.textContent='PERFECT!';    El.goRating.textContent='🏆 WORLD CLASS STRIKER'; }
  else if (S.goals>=6)  { El.goTitle.textContent='GREAT JOB!';  El.goRating.textContent='⭐ PRO LEVEL'; }
  else if (S.goals>=3)  { El.goTitle.textContent='NOT BAD!';    El.goRating.textContent='👟 KEEP KICKING'; }
  else                  { El.goTitle.textContent='KEEP TRYING'; El.goRating.textContent='💪 TRAIN HARDER'; }

  // Save to Firebase
  saveScore(S.points); 
}

/* ════════════════════════════════════════
   RENDER LOOP
════════════════════════════════════════ */
function renderLoop() {
  requestAnimationFrame(renderLoop);
  ball.rotation.y += 0.008;
  tickKeeper();
  renderer.render(scene, camera);
}

/* ════════════════════════════════════════
   BOOT — waits for THREE, loads textures in parallel, then builds scene
════════════════════════════════════════ */
function showBootError(msg) {
  El.splashHint.textContent = '⚠️ ' + msg;
  El.splashHint.style.cssText = 'color:#FF5252;font-size:13px;padding:0 16px;line-height:1.4';
  El.splashBar.style.background = '#E31E24';
  // Add a reload button
  const btn = document.createElement('button');
  btn.textContent = '🔄 Tap to Reload';
  btn.style.cssText = 'margin-top:16px;padding:10px 24px;background:#F7C948;border:none;border-radius:24px;font-size:16px;font-weight:bold;cursor:pointer';
  btn.onclick = () => location.reload();
  El.splashHint.after(btn);
}

async function boot() {
  try {
    // Step 1: Confirm THREE is available (blocking script, should be instant)
    El.splashBar.style.width = '10%';
    El.splashHint.textContent = 'Loading engine…';
    await waitForThree();

    texLoader = new THREE.TextureLoader();

    // Step 2: Load all textures in parallel
    El.splashBar.style.width = '30%';
    El.splashHint.textContent = 'Loading assets…';

    let loaded = 0;
    const total = 2;
    const onProgress = () => {
      loaded++;
      El.splashBar.style.width = (30 + Math.round((loaded / total) * 40)) + '%';
    };

    const [keeperTex, stadiumTex] = await Promise.all([
      loadTexture('assets/keeper.png').then(t  => { onProgress(); return t; }),
      loadTexture('assets/stadium.png').then(t => { onProgress(); return t; }),
    ]);

    // Step 3: Build 3D scene
    El.splashBar.style.width = '75%';
    El.splashHint.textContent = 'Building AR scene…';
    await preInitScene();

    buildKeeper(keeperTex);
    addStadiumSprites(stadiumTex);

    El.splashBar.style.width = '100%';
    El.splashHint.textContent = 'Ready!';
    await new Promise(r => setTimeout(r, 300));

    El.splash.classList.add('screen-hidden');
    El.regScreen.classList.remove('screen-hidden');

  } catch (err) {
    console.error('[Yupi AR] Boot failed:', err);
    showBootError(err.message || 'Failed to load. Please reload.');
  }
}

/* ── Registration Logic ── */
El.btnReg.onclick = async () => {
  const name = El.regName.value.trim();
  if (!name) {
    alert('Please enter a nickname.');
    return;
  }
  El.btnReg.textContent = 'LAUNCHING AR...';
  El.btnReg.disabled = true;

  // Fire and forget Firebase registration
  registerPlayer(name).catch(e => console.warn('Firebase register failed:', e));

  // Phase 2: get camera AFTER user gesture (fast, just camera stream)
  El.regScreen.classList.add('screen-hidden');
  await initCamera();

  startGame();
};

/* ── Leaderboard Logic ── */
$('btn-leaderboard').onclick = async () => {
  El.lbScreen.classList.remove('screen-hidden');
  El.lbList.innerHTML = '<div class="lb-loading">Loading scores...</div>';
  
  const scores = await fetchLeaderboard();
  
  if (scores.length === 0) {
    El.lbList.innerHTML = '<div class="lb-loading">No scores yet or Firebase not configured.</div>';
    return;
  }
  
  El.lbList.innerHTML = '';
  let myRankHTML = '<span class="lb-col-rank">-</span><span class="lb-col-player">-</span><span class="lb-col-score">-</span>';
  
  scores.forEach((entry, index) => {
    const rank = index + 1;
    const isMe = entry.id === PlayerState.docId;
    
    const row = document.createElement('div');
    row.className = 'lb-row';
    row.innerHTML = `
      <span class="lb-col-rank">${rank}</span>
      <span class="lb-col-player">${entry.name || 'Anonymous'}</span>
      <span class="lb-col-score">${entry.points || 0}</span>
    `;
    if (isMe) row.style.backgroundColor = 'rgba(247,201,72,0.15)';
    El.lbList.appendChild(row);
    
    if (isMe) myRankHTML = row.innerHTML;
  });
  
  El.lbMyRow.innerHTML = myRankHTML;
};
El.btnCloseLb.onclick = () => El.lbScreen.classList.add('screen-hidden');

/* ── Controls ── */
$('btn-start').onclick    = startGame;
$('btn-restart').onclick  = startGame;
$('btn-left').onclick     = aimLeft;
$('btn-right').onclick    = aimRight;
$('btn-shoot').onclick    = shoot;

/* Touch hold for continuous aim */
let aimHold = null;
['btn-left','btn-right'].forEach(id => {
  const el=$(id), fn = id==='btn-left' ? aimLeft : aimRight;
  el.addEventListener('touchstart', () => { aimHold=setInterval(fn,120); }, {passive:true});
  el.addEventListener('touchend',   () => clearInterval(aimHold), {passive:true});
});

window.addEventListener('DOMContentLoaded', () => boot().catch(err => {
  console.error('[Yupi AR] Unhandled boot error:', err);
  showBootError(err.message || 'Unexpected error. Please reload.');
}));

