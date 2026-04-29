/**
 * AR PENALTY SHOOTOUT – game.js
 * Senior WebXR Developer build using Three.js + MindAR.js (CDN)
 */

"use strict";

/* ─── CONFIG ─────────────────────────────────────────── */
const TOTAL_SHOTS   = 5;
const KEEPER_SPEED  = 0.025;
const KEEPER_RANGE  = 1.4;
const BALL_TRAVEL   = 0.75;  // seconds for ball to reach goal
const GOAL_W        = 3.6;
const GOAL_H        = 2.2;
const GOAL_DEPTH    = 0.6;
const GOAL_Z        = -8;
const BALL_START_Z  = 0;
const BALL_START_Y  = -1.0;

/* ─── STATE ──────────────────────────────────────────── */
const state = {
  goals: 0, saves: 0,
  shotsLeft: TOTAL_SHOTS,
  shooting: false,
  gameActive: false,
  keeperDir: 1,
};

/* ─── DOM refs ───────────────────────────────────────── */
const $ = id => document.getElementById(id);
const loadingScreen  = $('loading-screen');
const startScreen    = $('start-screen');
const hudEl          = $('hud');
const feedbackEl     = $('feedback');
const feedbackText   = $('feedback-text');
const gameoverScreen = $('gameover-screen');
const loaderBar      = $('loader-bar');
const loaderHint     = $('loader-hint');
const swipeHint      = $('swipe-hint');

/* ─── THREE.js objects (set later) ──────────────────── */
let scene, camera, renderer;
let ball, keeper, goalMesh;
let ballAnimId = null;
let keeperAnimId = null;

/* ═══════════════════════════════════════════════════════
   LOADER PROGRESS ANIMATION
════════════════════════════════════════════════════════ */
function animateLoader(pct, hint) {
  loaderBar.style.width = pct + '%';
  if (hint) loaderHint.textContent = hint;
}

/* ═══════════════════════════════════════════════════════
   BUILD THREE.JS SCENE (no MindAR target needed)
   Camera feed rendered as background via getUserMedia
════════════════════════════════════════════════════════ */
async function initScene() {
  /* ── Renderer ── */
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  $('ar-container').appendChild(renderer.domElement);

  /* ── Camera (1st-person, fixed) ── */
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 0, 0);

  /* ── Scene ── */
  scene = new THREE.Scene();

  /* ── Camera feed as background ── */
  await setupCameraBackground();

  /* ── Lights ── */
  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(4, 10, 4);
  dirLight.castShadow = true;
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far  = 50;
  dirLight.shadow.mapSize.set(1024, 1024);
  scene.add(dirLight);

  const fillLight = new THREE.PointLight(0x00b4ff, 0.8, 20);
  fillLight.position.set(-3, 3, -4);
  scene.add(fillLight);

  /* ── Build meshes ── */
  buildGoal();
  buildBall();
  buildKeeper();
  buildGround();

  /* ── Resize handler ── */
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  /* ── Start render loop ── */
  renderLoop();
}

/* ─── Camera background via getUserMedia ─────────────── */
async function setupCameraBackground() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    const video = document.createElement('video');
    video.srcObject = stream;
    video.playsInline = true;
    video.muted = true;
    await video.play();

    const videoTexture = new THREE.VideoTexture(video);
    videoTexture.minFilter = THREE.LinearFilter;
    videoTexture.magFilter = THREE.LinearFilter;
    scene.background = videoTexture;
  } catch (e) {
    // Fallback: dark gradient background
    scene.background = new THREE.Color(0x0a0e1a);
    console.warn('Camera not available, using fallback background.', e);
  }
}

/* ─── GOAL POSTS ─────────────────────────────────────── */
function buildGoal() {
  const postMat  = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.6, roughness: 0.3 });
  const netMat   = new THREE.MeshStandardMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.25 });
  const postR    = 0.08;

  const mkPost = (w, h, d, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), postMat);
    m.position.set(x, y, z);
    m.castShadow = true;
    scene.add(m);
  };

  const gx = GOAL_W / 2, gy = GOAL_H / 2, gz = GOAL_Z;

  // Left / Right posts
  mkPost(postR, GOAL_H, postR, -gx, gy, gz);
  mkPost(postR, GOAL_H, postR,  gx, gy, gz);
  // Crossbar
  mkPost(GOAL_W + postR, postR, postR, 0, GOAL_H, gz);
  // Back net
  const net = new THREE.Mesh(new THREE.BoxGeometry(GOAL_W, GOAL_H, GOAL_DEPTH), netMat);
  net.position.set(0, gy, gz - GOAL_DEPTH / 2);
  scene.add(net);

  // Invisible goal trigger volume (for collision)
  const goalGeo  = new THREE.BoxGeometry(GOAL_W, GOAL_H, 0.3);
  const goalMatI = new THREE.MeshBasicMaterial({ visible: false });
  goalMesh = new THREE.Mesh(goalGeo, goalMatI);
  goalMesh.position.set(0, gy, gz);
  scene.add(goalMesh);
}

/* ─── SOCCER BALL ────────────────────────────────────── */
function buildBall() {
  const geo = new THREE.SphereGeometry(0.22, 32, 32);

  // Procedural soccer-ball look with canvas texture
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 512, 512);
  ctx.fillStyle = '#111';
  // Draw pentagon-like patches
  const patches = [
    [256,256],[128,128],[384,128],[128,384],[384,384],
    [256,80],[256,432],[80,256],[432,256]
  ];
  patches.forEach(([cx,cy]) => {
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = (i * 2 * Math.PI / 5) - Math.PI / 2;
      const r = 48;
      const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
      i === 0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
    }
    ctx.closePath();
    ctx.fill();
  });

  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.MeshStandardMaterial({ map: tex, metalness: 0.05, roughness: 0.6 });

  ball = new THREE.Mesh(geo, mat);
  ball.position.set(0, BALL_START_Y, BALL_START_Z);
  ball.castShadow = true;
  scene.add(ball);
}

/* ─── GOALKEEPER (GLB placeholder = stylised box rig) ── */
function buildKeeper() {
  const mat = new THREE.MeshStandardMaterial({ color: 0x00b4ff, metalness: 0.2, roughness: 0.5 });
  const matYellow = new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 0.1, roughness: 0.6 });

  const group = new THREE.Group();

  // Torso
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.75, 0.35), mat);
  torso.position.y = 0.375;
  group.add(torso);

  // Head
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.35), matYellow);
  head.position.y = 0.93;
  group.add(head);

  // Left arm
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.6, 0.18), mat);
  armL.position.set(-0.5, 0.42, 0);
  group.add(armL);

  // Right arm
  const armR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.6, 0.18), mat);
  armR.position.set(0.5, 0.42, 0);
  group.add(armR);

  // Left leg
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.65, 0.22), matYellow);
  legL.position.set(-0.22, -0.325, 0);
  group.add(legL);

  // Right leg
  const legR = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.65, 0.22), matYellow);
  legR.position.set(0.22, -0.325, 0);
  group.add(legR);

  // Gloves
  [[-0.5, -0.08], [0.5, -0.08]].forEach(([x,y]) => {
    const glove = new THREE.Mesh(new THREE.BoxGeometry(0.22,0.22,0.22),
      new THREE.MeshStandardMaterial({ color: 0xffffff }));
    glove.position.set(x, y, 0);
    group.add(glove);
  });

  group.position.set(0, GOAL_H / 2 - 0.5, GOAL_Z + 0.5);
  group.scale.set(1.1, 1.1, 1.1);
  scene.add(group);

  keeper = group;

  // Try loading a real GLB (optional – fails silently)
  tryLoadKeeperGLB();

  // Start keeper movement
  animateKeeper();
}

/* Attempt to load a real .glb model if provided */
function tryLoadKeeperGLB() {
  if (typeof THREE.GLTFLoader === 'undefined') return;
  const loader = new THREE.GLTFLoader();
  loader.load('assets/goalkeeper.glb',
    (gltf) => {
      scene.remove(keeper);
      keeper = gltf.scene;
      keeper.position.set(0, GOAL_H / 2 - 1.2, GOAL_Z + 0.5);
      keeper.scale.set(1.2, 1.2, 1.2);
      scene.add(keeper);
    },
    undefined,
    () => { /* silently use box-rig fallback */ }
  );
}

/* ─── GROUND PLANE ───────────────────────────────────── */
function buildGround() {
  const geo = new THREE.PlaneGeometry(20, 20);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x2d7a2d,
    roughness: 0.9,
    metalness: 0.0,
    transparent: true,
    opacity: 0.6,
  });
  const ground = new THREE.Mesh(geo, mat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.5;
  ground.receiveShadow = true;
  scene.add(ground);

  // Field lines
  const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 });
  const lineGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-GOAL_W / 2, -1.49, GOAL_Z),
    new THREE.Vector3(-GOAL_W / 2, -1.49, 1),
    new THREE.Vector3( GOAL_W / 2, -1.49, 1),
    new THREE.Vector3( GOAL_W / 2, -1.49, GOAL_Z),
  ]);
  scene.add(new THREE.Line(lineGeo, lineMat));
}

/* ═══════════════════════════════════════════════════════
   KEEPER AI – moves left/right randomly
════════════════════════════════════════════════════════ */
let keeperTargetX = 0;
let keeperChangeTimer = 0;

function animateKeeper() {
  function loop() {
    if (!state.gameActive) { keeperAnimId = requestAnimationFrame(loop); return; }

    keeperChangeTimer--;
    if (keeperChangeTimer <= 0) {
      keeperTargetX = (Math.random() - 0.5) * KEEPER_RANGE * 2;
      keeperChangeTimer = 60 + Math.floor(Math.random() * 80);
    }

    keeper.position.x += (keeperTargetX - keeper.position.x) * KEEPER_SPEED;

    // Arm animation (diving effect)
    const arms = [keeper.children[2], keeper.children[3]];
    if (arms[0] && arms[1]) {
      const swing = Math.sin(Date.now() * 0.005) * 0.15;
      arms[0].rotation.z =  swing;
      arms[1].rotation.z = -swing;
    }

    keeperAnimId = requestAnimationFrame(loop);
  }
  keeperAnimId = requestAnimationFrame(loop);
}

/* ═══════════════════════════════════════════════════════
   BALL SHOOTING MECHANIC
════════════════════════════════════════════════════════ */
let swipeStartY = 0;
let swipeStartX = 0;
let swipeStartTime = 0;

function registerSwipeHandlers() {
  const el = renderer.domElement;

  el.addEventListener('touchstart', e => {
    if (!state.gameActive || state.shooting) return;
    swipeStartY    = e.touches[0].clientY;
    swipeStartX    = e.touches[0].clientX;
    swipeStartTime = Date.now();
  }, { passive: true });

  el.addEventListener('touchend', e => {
    if (!state.gameActive || state.shooting) return;
    const dy = swipeStartY - e.changedTouches[0].clientY;
    const dx = e.changedTouches[0].clientX - swipeStartX;
    const dt = Date.now() - swipeStartTime;
    if (dy < 40 || dt > 700) return; // must swipe up fast enough
    const normDx = Math.max(-1, Math.min(1, dx / (window.innerWidth * 0.4)));
    shoot(normDx);
  }, { passive: true });

  // Mouse fallback for desktop testing
  el.addEventListener('mousedown', e => {
    swipeStartY = e.clientY; swipeStartX = e.clientX; swipeStartTime = Date.now();
  });
  el.addEventListener('mouseup', e => {
    if (!state.gameActive || state.shooting) return;
    const dy = swipeStartY - e.clientY;
    const dx = e.clientX - swipeStartX;
    const dt = Date.now() - swipeStartTime;
    if (dy < 30 || dt > 700) return;
    const normDx = Math.max(-1, Math.min(1, dx / (window.innerWidth * 0.4)));
    shoot(normDx);
  });
}

function shoot(directionX) {
  if (state.shooting || state.shotsLeft <= 0) return;
  state.shooting = true;
  swipeHint.style.opacity = '0';

  const targetX = directionX * (GOAL_W / 2 - 0.1);
  const targetY = GOAL_H * (0.25 + Math.random() * 0.55);
  const targetZ = GOAL_Z;

  const startX = ball.position.x;
  const startY = ball.position.y;
  const startZ = ball.position.z;

  const startTime = performance.now();
  const duration  = BALL_TRAVEL * 1000;

  function ballFly(now) {
    const t = Math.min((now - startTime) / duration, 1);
    const ease = t < 0.5 ? 2*t*t : -1+(4-2*t)*t;

    ball.position.x = startX + (targetX - startX) * ease;
    ball.position.y = startY + (targetY - startY) * ease + Math.sin(t * Math.PI) * 0.4;
    ball.position.z = startZ + (targetZ - startZ) * ease;
    ball.rotation.x += 0.12;
    ball.rotation.z += 0.06;

    if (t < 1) {
      ballAnimId = requestAnimationFrame(ballFly);
    } else {
      resolveShot(targetX, targetY);
    }
  }
  ballAnimId = requestAnimationFrame(ballFly);
}

/* ═══════════════════════════════════════════════════════
   COLLISION DETECTION
════════════════════════════════════════════════════════ */
function resolveShot(bx, by) {
  state.shotsLeft--;
  updateHUD();

  const kx = keeper.position.x;
  const keeperHalfW = 0.65;
  const keeperHalfH = GOAL_H / 2;

  const inKeeperX = Math.abs(bx - kx) < keeperHalfW + 0.22;
  const inKeeperY = Math.abs(by - keeperHalfH) < keeperHalfH + 0.22;
  const inGoalX   = Math.abs(bx) < GOAL_W / 2;
  const inGoalY   = by > 0.1 && by < GOAL_H + 0.1;

  let result;
  if (inKeeperX && inKeeperY) {
    result = 'SAVED!';
    state.saves++;
    showFeedback(result, 'saved');
  } else if (inGoalX && inGoalY) {
    result = 'GOAL!';
    state.goals++;
    showFeedback(result, 'goal');
  } else {
    result = 'MISS!';
    showFeedback(result, 'miss');
  }

  updateHUD();
  // Reset ball after delay
  setTimeout(() => {
    resetBall();
    state.shooting = false;
    if (state.shotsLeft <= 0) {
      setTimeout(showGameOver, 400);
    } else {
      swipeHint.style.opacity = '1';
    }
  }, 1000);
}

function resetBall() {
  ball.position.set(0, BALL_START_Y, BALL_START_Z);
  ball.rotation.set(0, 0, 0);
}

/* ═══════════════════════════════════════════════════════
   HUD UPDATES
════════════════════════════════════════════════════════ */
function updateHUD() {
  const goalsEl = $('hud-goals');
  const savesEl = $('hud-saves');
  goalsEl.textContent = state.goals;
  savesEl.textContent = state.saves;
  $('hud-timer').textContent = state.shotsLeft;
  goalsEl.classList.remove('pop');
  void goalsEl.offsetWidth;
  goalsEl.classList.add('pop');
}

/* ═══════════════════════════════════════════════════════
   FEEDBACK OVERLAY
════════════════════════════════════════════════════════ */
function showFeedback(text, type) {
  feedbackEl.className = 'feedback ' + type;
  feedbackText.textContent = text;
  feedbackEl.classList.remove('hidden');
  clearTimeout(feedbackEl._t);
  feedbackEl._t = setTimeout(() => feedbackEl.classList.add('hidden'), 1200);
}

/* ═══════════════════════════════════════════════════════
   GAME OVER
════════════════════════════════════════════════════════ */
function showGameOver() {
  state.gameActive = false;
  hudEl.classList.add('hidden');
  gameoverScreen.classList.remove('hidden');

  $('go-goals').textContent = state.goals;
  $('go-shots').textContent = TOTAL_SHOTS;

  const pct = state.goals / TOTAL_SHOTS;
  let emoji, title, rating;
  if (pct === 1)       { emoji = '🏆'; title = 'PERFECT!';   rating = 'WORLD CLASS STRIKER'; }
  else if (pct >= 0.6) { emoji = '⚽'; title = 'GREAT JOB!'; rating = 'PRO LEVEL';  }
  else if (pct >= 0.4) { emoji = '👏'; title = 'NOT BAD!';   rating = 'AMATEUR';    }
  else                 { emoji = '😅'; title = 'KEEP TRYING'; rating = 'KEEP TRAINING'; }

  $('gameover-emoji').textContent  = emoji;
  $('gameover-title').textContent  = title;
  $('gameover-rating').textContent = rating;
}

/* ═══════════════════════════════════════════════════════
   RENDER LOOP
════════════════════════════════════════════════════════ */
function renderLoop() {
  requestAnimationFrame(renderLoop);
  renderer.render(scene, camera);
}

/* ═══════════════════════════════════════════════════════
   GAME FLOW
════════════════════════════════════════════════════════ */
function startGame() {
  state.goals = 0; state.saves = 0;
  state.shotsLeft = TOTAL_SHOTS;
  state.shooting  = false;
  state.gameActive = true;
  keeperChangeTimer = 0;

  resetBall();
  updateHUD();

  startScreen.classList.add('hidden');
  gameoverScreen.classList.add('hidden');
  hudEl.classList.remove('hidden');
  swipeHint.style.opacity = '1';
}

/* ═══════════════════════════════════════════════════════
   BOOT SEQUENCE
════════════════════════════════════════════════════════ */
async function boot() {
  animateLoader(10, 'Loading libraries…');
  await delay(300);
  animateLoader(35, 'Building scene…');
  await initScene();
  animateLoader(70, 'Setting up physics…');
  await delay(300);
  animateLoader(90, 'Registering controls…');
  registerSwipeHandlers();
  await delay(300);
  animateLoader(100, 'Ready!');
  await delay(400);

  loadingScreen.classList.add('hidden');
  startScreen.classList.remove('hidden');
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ─── Button listeners ───────────────────────────────── */
$('btn-start').addEventListener('click', startGame);
$('btn-restart').addEventListener('click', () => {
  gameoverScreen.classList.add('hidden');
  startGame();
});

/* ─── Kick off ────────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', boot);
