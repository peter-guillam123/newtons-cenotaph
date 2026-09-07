// Newton's cenotaph: scroll-driven walkthrough, first-person mode, section cut, day and night.
// Coordinates are three.js y-up metres; the Blender model's (x, y, z) became (x, z, -y) on export.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from './vendor/three-mesh-bvh.module.js';
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;
const ASSET_V = '3';

const $ = (s) => document.querySelector(s);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
const isMobile = coarse || innerWidth < 720;

// ---------- renderer, scene, camera ----------
const canvas = $('#scene');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  $('#nowebgl').hidden = false; $('#loader').classList.add('done');
  document.querySelectorAll('.tools button, #btn-walk-2, .cmp .link').forEach(b => b.disabled = true);
  throw e;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile ? 1.25 : 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.localClippingEnabled = true;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.3, 6000);
camera.rotation.order = 'YXZ';

// sky dome: a gradient that we lerp between day and night
const DAY = { zenith: new THREE.Color(0.30, 0.44, 0.66), horizon: new THREE.Color(0.78, 0.78, 0.76), fog: new THREE.Color(0.74, 0.75, 0.74) };
const NIGHT = { zenith: new THREE.Color(0.012, 0.016, 0.034), horizon: new THREE.Color(0.06, 0.062, 0.085), fog: new THREE.Color(0.03, 0.03, 0.045) };
const skyMat = new THREE.ShaderMaterial({
  uniforms: { zenith: { value: DAY.zenith.clone() }, horizon: { value: DAY.horizon.clone() } },
  vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform vec3 zenith; uniform vec3 horizon; varying vec3 vP;
    void main(){ float h = normalize(vP).y; float t = smoothstep(-0.05, 0.55, h); gl_FragColor = vec4(mix(horizon, zenith, t), 1.0); }`,
  side: THREE.BackSide, depthWrite: false, fog: false,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 16), skyMat);
scene.add(sky);
scene.fog = new THREE.FogExp2(DAY.fog.clone(), 0.00045);

// ground
const ground = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), new THREE.MeshStandardMaterial({ color: new THREE.Color(0.17, 0.19, 0.10), roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true; ground.name = 'Ground';
scene.add(ground);

// lights
const SUN_DAY = new THREE.Color(1.0, 0.93, 0.82), SUN_NIGHT = new THREE.Color(0.55, 0.65, 1.0);
const SUNPOS_DAY = new THREE.Vector3(-330, 120, 70), SUNPOS_NIGHT = new THREE.Vector3(250, 200, -300);
const sun = new THREE.DirectionalLight(SUN_DAY.clone(), 3.2);
sun.position.set(-330, 120, 70); sun.target.position.set(0, 40, 0); scene.add(sun.target);
sun.castShadow = true;
const sm = sun.shadow; sm.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
sm.camera.left = -230; sm.camera.right = 230; sm.camera.top = 230; sm.camera.bottom = -230; sm.camera.near = 50; sm.camera.far = 900;
sm.bias = -0.0004; sm.normalBias = 2.2;
scene.add(sun);
const hemi = new THREE.HemisphereLight(new THREE.Color(0.55, 0.65, 0.85), new THREE.Color(0.25, 0.22, 0.18), 0.7);
scene.add(hemi);
const tombGlow = new THREE.PointLight(new THREE.Color(1.0, 0.8, 0.55), 60, 0, 2); tombGlow.position.set(0, 15, 9); scene.add(tombGlow);
const lamp = new THREE.PointLight(new THREE.Color(1.0, 0.85, 0.6), 0, 0, 2); lamp.position.set(0, 75, 0); scene.add(lamp);

// lamp halo sprite
function radialTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,225,170,1)'); grad.addColorStop(0.25, 'rgba(255,210,140,0.55)'); grad.addColorStop(1, 'rgba(255,200,120,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
halo.position.set(0, 75, 0); halo.scale.set(46, 46, 1); scene.add(halo);

// ---------- state ----------
const state = {
  night: 0, nightTarget: 0, nightOverride: null,
  section: false,
  mode: 'story',       // story | walk | pose
  progress: 0,         // chapter index + fraction
  dirty: true,
};
const clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), -0.37); // keeps Blender y >= 0.37, i.e. the back half
const buildingMats = [];
const walkables = []; const solids = [];
let cypresses, stars, moon, lampSun;

// ---------- loading ----------
const loader = new GLTFLoader();
const barFill = $('#bar-fill'), loaderMsg = $('#loader-msg');
function setProgress(f, msg) { barFill.style.width = `${Math.round(f * 100)}%`; if (msg !== undefined) loaderMsg.textContent = msg; }

Promise.all([
  new Promise((res, rej) => loader.load('assets/cenotaph.glb?v=' + ASSET_V, res, (e) => { if (e.total) setProgress(0.85 * e.loaded / e.total); }, rej)),
  fetch('assets/cypresses.json?v=' + ASSET_V).then(r => r.json()),
  fetch('assets/stars.json?v=' + ASSET_V).then(r => r.json()),
]).then(([gltf, cyp, st]) => {
  setProgress(0.9, 'Planting the cypresses');
  buildScene(gltf.scene, cyp, st);
  setProgress(1, '');
  state.loaded = true;
  requestAnimationFrame(() => { $('#loader').classList.add('done'); onScroll(); state.dirty = true; });
}).catch((err) => {
  console.error(err);
  loaderMsg.textContent = 'The model failed to load. The films further down still work.';
  $('#nowebgl').hidden = false;
});

function buildScene(root, cyp, st) {
  let cypMesh = null;
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.material.side = THREE.DoubleSide;
    if (o.name === 'Cypress') { cypMesh = o; return; }
    if (o.name === 'SphereShell') { o.material.roughness = 0.82; }
    o.castShadow = true; o.receiveShadow = true;
    buildingMats.push(o.material);
    if (o.name === 'LampSun') { lampSun = o; o.castShadow = false; }
    if (o.name === 'Moon') { moon = o; o.castShadow = false; o.material.emissiveIntensity = 3; }
    if (o.name.startsWith('Sarc')) { o.material.roughness = 0.78; }
    if (o.name.startsWith('Arm_') || o.name === 'LampRod') { o.receiveShadow = false; }
    if (['SphereShell', 'Drum', 'UpperTier', 'Platform', 'PitFloor', 'GrandStair', 'ForecourtStair', 'TunnelLanding', 'TunnelStair', 'Mound', 'MoundStair', 'SarcPlinth', 'Sarcophagus', 'SarcLid', 'FrontBridge'].includes(o.name)) {
      walkables.push(o); solids.push(o);
    }
  });
  scene.add(root);
  walkables.push(ground);
  scene.updateMatrixWorld(true);
  for (const o of walkables) o.geometry.computeBoundsTree();

  // cypresses as one instanced mesh
  if (cypMesh) {
    cypMesh.removeFromParent();
    const geo = cypMesh.geometry; const mat = cypMesh.material; mat.side = THREE.FrontSide;
    cypresses = new THREE.InstancedMesh(geo, mat, cyp.length);
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    cyp.forEach((c, i) => {
      p.set(c[0], c[1], c[2]); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), c[3]); s.set(c[4], c[5], c[4]);
      m.compose(p, q, s); cypresses.setMatrixAt(i, m);
    });
    cypresses.castShadow = true; cypresses.receiveShadow = true; cypresses.frustumCulled = false;
    buildingMats.push(mat);
    scene.add(cypresses);
  }

  // stars: glowing points on the inner surface (day effect)
  const n = st.stars.length; const pos = new Float32Array(n * 3); const size = new Float32Array(n);
  st.stars.forEach((s, i) => { pos[i * 3] = s[0]; pos[i * 3 + 1] = s[1]; pos[i * 3 + 2] = s[2]; size[i] = s[3]; });
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); sg.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const starMat = new THREE.ShaderMaterial({
    uniforms: { opacity: { value: 1 }, color: { value: new THREE.Color(0.85, 0.92, 1.0) }, pr: { value: renderer.getPixelRatio() } },
    vertexShader: `attribute float size; uniform float pr; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0);
      float d = max(1.0, -mv.z); gl_PointSize = clamp(size * 720.0 / d, 1.6, 16.0) * pr; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float opacity; uniform vec3 color; void main(){ vec2 c = gl_PointCoord - 0.5; float r = length(c);
      if (r > 0.5) discard; float a = smoothstep(0.5, 0.12, r); gl_FragColor = vec4(color * (0.6 + 0.6 * a), a * opacity); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  stars = new THREE.Points(sg, starMat); stars.frustumCulled = false; scene.add(stars);
  applySection();
  applyNight(true);
}

// ---------- day / night ----------
function applyNight(force) {
  const t = state.night;
  const l = (a, b) => a + (b - a) * t;
  // by night the sun becomes a low blue moon, as in Boullée's night elevation
  sun.intensity = l(3.2, 0.32); sun.color.copy(SUN_DAY).lerp(SUN_NIGHT, t);
  sun.position.copy(SUNPOS_DAY).lerp(SUNPOS_NIGHT, t);
  hemi.intensity = l(0.7, 0.06);
  tombGlow.intensity = l(30, 0);
  lamp.intensity = l(0, 1500);
  halo.material.opacity = l(0, 0.95);
  if (stars) { stars.material.uniforms.opacity.value = l(1, 0); stars.visible = stars.material.uniforms.opacity.value > 0.01; }
  if (moon) { moon.visible = t < 0.5; }
  if (lampSun) { lampSun.material.emissiveIntensity = l(0.2, 12); }
  skyMat.uniforms.zenith.value.copy(DAY.zenith).lerp(NIGHT.zenith, t);
  skyMat.uniforms.horizon.value.copy(DAY.horizon).lerp(NIGHT.horizon, t);
  scene.fog.color.copy(DAY.fog).lerp(NIGHT.fog, t);
  renderer.toneMappingExposure = l(1.05, 1.0);
  $('#btn-day').setAttribute('aria-pressed', String(state.nightTarget === 0));
  $('#btn-night').setAttribute('aria-pressed', String(state.nightTarget === 1));
}
function setNight(v, manual) {
  state.nightTarget = v ? 1 : 0;
  if (manual) state.nightOverride = state.nightTarget;
  if (reduceMotion) state.night = state.nightTarget;
  state.dirty = true;
}
$('#btn-day').addEventListener('click', () => setNight(false, true));
$('#btn-night').addEventListener('click', () => setNight(true, true));

// ---------- section ----------
function applySection() {
  const planes = state.section ? [clipPlane] : [];
  for (const m of buildingMats) { m.clippingPlanes = planes; m.clipShadows = true; m.needsUpdate = true; }
  if (stars) stars.material.clippingPlanes = planes;
  $('#btn-section').setAttribute('aria-pressed', String(state.section));
  state.dirty = true;
}
$('#btn-section').addEventListener('click', () => { state.section = !state.section; applySection(); });

// ---------- story camera path ----------
const KEYS = [
  { p: [70, 48, 540], t: [0, 70, 0] },        // title
  { p: [30, 32, 380], t: [0, 66, 0] },        // the sphere
  { p: [0, 12, 168], t: [0, 52, 0] },         // the base
  { p: [0, 8.2, 72], t: [0, 26, 0] },         // the way in
  { p: [0, 8.3, 36], t: [0, 15, 0] },         // the tunnel
  { p: [0, 8.3, 12.5], t: [0, 20, -4] },      // the tomb
  { p: [0, 9.0, 9.5], t: [0, 80, -6] },       // day, looking up
  { p: [0, 9.2, 9.0], t: [0, 140, 0] },       // night
  { p: [0, 9.2, 9.0], t: [0, 60, -30] },      // walk it
];
const posCurve = new THREE.CatmullRomCurve3(KEYS.map(k => new THREE.Vector3(...k.p)), false, 'catmullrom', 0.5);
const tgtCurve = new THREE.CatmullRomCurve3(KEYS.map(k => new THREE.Vector3(...k.t)), false, 'catmullrom', 0.5);
const chapters = [...document.querySelectorAll('.chapter')];
const NIGHT_AT = 6.5;
const camGoal = { p: new THREE.Vector3(...KEYS[0].p), t: new THREE.Vector3(...KEYS[0].t) };
const camNow = { p: camGoal.p.clone(), t: camGoal.t.clone() };
const smooth = (x) => x * x * (3 - 2 * x);

function onScroll() {
  if (state.mode !== 'story') return;
  const y = scrollY + innerHeight * 0.5;
  let prog = 0;
  for (let i = 0; i < chapters.length; i++) {
    const top = chapters[i].offsetTop; const next = i + 1 < chapters.length ? chapters[i + 1].offsetTop : top + innerHeight;
    if (y >= next) { prog = i + 1; continue; }
    const f = Math.max(0, Math.min(1, (y - top) / (next - top)));
    prog = i + smooth(f); break;
  }
  prog = Math.min(prog, chapters.length - 1);
  state.progress = prog;
  const u = prog / (KEYS.length - 1);
  camGoal.p.copy(posCurve.getPoint(u)); camGoal.t.copy(tgtCurve.getPoint(u));
  const wantNight = prog >= NIGHT_AT ? 1 : 0;
  if (state.nightOverride !== null && wantNight !== state.nightTarget && Math.abs(prog - NIGHT_AT) < 0.05) state.nightOverride = null;
  if (state.nightOverride === null) setNight(wantNight === 1, false);
  state.dirty = true;
}
addEventListener('scroll', onScroll, { passive: true });

// ---------- pose mode (the drawing over the live view) ----------
const POSES = {
  elevation: { p: [130, 42, 470], t: [0, 62, 0], fov: 29, img: 'media/drawing_f2_elevation_day.jpg', section: false, night: false },
  section: { p: [0, 72, 800], t: [0, 72, 0], fov: 16.2, img: 'media/drawing_f4_section_day_effect.jpg', section: true, night: false },
  interior: { p: [0, 7.8, 13], t: [0, 37, -10], fov: 86, img: 'media/drawing_f6_interior_view.jpg', section: false, night: false },
};
let poseRestore = null;
function enterPose(name) {
  const pose = POSES[name]; if (!pose) return;
  if (state.mode === 'walk') exitWalk(false);
  poseRestore = { section: state.section, fov: camera.fov, scroll: scrollY };
  state.mode = 'pose'; document.body.classList.add('pose');
  camGoal.p.set(...pose.p); camGoal.t.set(...pose.t); camera.fov = pose.fov; camera.updateProjectionMatrix();
  state.section = pose.section; applySection(); setNight(pose.night, true);
  const ov = $('#pose-overlay'); ov.hidden = false; $('#pose-img').src = pose.img; $('#pose-img').style.opacity = $('#pose-range').value / 100;
  scrollTo(0, 0); state.dirty = true; $('#pose-close').focus();
}
function exitPose() {
  if (state.mode !== 'pose') return;
  $('#pose-overlay').hidden = true; document.body.classList.remove('pose');
  state.mode = 'story'; camera.fov = 55; camera.updateProjectionMatrix();
  state.section = poseRestore?.section ?? false; applySection(); state.nightOverride = null;
  scrollTo(0, poseRestore?.scroll ?? 0); onScroll();
}
document.querySelectorAll('[data-pose]').forEach(b => b.addEventListener('click', () => enterPose(b.dataset.pose)));
$('#pose-range').addEventListener('input', (e) => { $('#pose-img').style.opacity = e.target.value / 100; });
$('#pose-close').addEventListener('click', exitPose);

// ---------- walk mode ----------
const controls = new PointerLockControls(camera, document.body);
const keys = new Set(); let fly = false; let onGround = false;
const EYE = 1.7, WALK = 6.5, RUN = 14, FLY = 35, STEP = 1.25;
const VIEWPOINTS = {
  forecourt: { p: [0, 4.2, 178], look: [0, 55, 0] },
  terrace: { p: [74, 39.2, 85], look: [0, 118, 0] },
  upper: { p: [21, 58, 90], look: [-70, 82, 40] },
  tomb: { p: [0, 14.0, 10.5], look: [0, 15, 0] },
  vault: { p: [0, 9.5, 9], look: [0, 140, 0] },
};
const ray = new THREE.Raycaster(); ray.far = 60;
const tmpV = new THREE.Vector3(), tmpD = new THREE.Vector3(), fwd = new THREE.Vector3(), right = new THREE.Vector3();

function groundHeight(x, z, fromY) {
  ray.set(tmpV.set(x, fromY + 1.2, z), tmpD.set(0, -1, 0)); ray.far = 60;
  const hits = ray.intersectObjects(walkables, false);
  return hits.length ? hits[0].point.y : null;
}
function blocked(from, dir, dist) {
  ray.set(from, dir); ray.far = dist; ray.firstHitOnly = true;
  return ray.intersectObjects(solids, false).length > 0;
}
function lookAtFrom(p, look) {
  camera.position.set(...p);
  const d = new THREE.Vector3(...look).sub(camera.position);
  camera.rotation.set(0, 0, 0);
  camera.rotation.y = Math.atan2(-d.x, -d.z);
  camera.rotation.x = Math.atan2(d.y, Math.hypot(d.x, d.z));
}
function goTo(name) {
  const v = VIEWPOINTS[name]; if (!v) return;
  lookAtFrom(v.p, v.look); fly = false; state.dirty = true;
}
function enterWalk() {
  if (state.mode === 'walk') return;
  if (state.mode === 'pose') exitPose();
  state.mode = 'walk'; document.body.classList.add('walk');
  scene.updateMatrixWorld(true);
  $('#walk-hud').hidden = false;
  if (coarse) { $('#joy-left').hidden = false; $('#joy-right').hidden = false; }
  camera.fov = 62; camera.updateProjectionMatrix();
  // start where the story camera is if it is somewhere a person could stand, else at the forecourt
  const g = groundHeight(camNow.p.x, camNow.p.z, camNow.p.y);
  if (g !== null && camNow.p.y - g < 4 && camNow.p.length() < 260) {
    lookAtFrom([camNow.p.x, g + EYE, camNow.p.z], camNow.t.toArray());
  } else goTo('forecourt');
  if (!coarse) controls.lock();
  state.dirty = true; lastT = performance.now();
}
function exitWalk(unlock = true) {
  if (state.mode !== 'walk') return;
  state.mode = 'story'; document.body.classList.remove('walk');
  $('#walk-hud').hidden = true; $('#joy-left').hidden = true; $('#joy-right').hidden = true;
  camera.fov = 55; camera.updateProjectionMatrix(); keys.clear();
  if (unlock && controls.isLocked) controls.unlock();
  onScroll(); camNow.p.copy(camGoal.p); camNow.t.copy(camGoal.t); state.dirty = true;
}
controls.addEventListener('unlock', () => { if (state.mode === 'walk' && !coarse) exitWalk(false); });
$('#btn-walk').addEventListener('click', () => state.mode === 'walk' ? exitWalk() : enterWalk());
$('#btn-walk-2').addEventListener('click', enterWalk);
$('#walk-exit').addEventListener('click', () => exitWalk());
document.querySelectorAll('[data-vp]').forEach(b => b.addEventListener('click', () => { goTo(b.dataset.vp); if (!coarse && !controls.isLocked) controls.lock(); }));
addEventListener('keydown', (e) => {
  if (state.mode !== 'walk') return;
  keys.add(e.code);
  if (e.code === 'KeyF') fly = !fly;
  const vp = { Digit1: 'forecourt', Digit2: 'terrace', Digit3: 'upper', Digit4: 'tomb', Digit5: 'vault' }[e.code];
  if (vp) goTo(vp);
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));

// touch joysticks
const joy = { move: { x: 0, y: 0 }, look: { x: 0, y: 0 } };
function joystick(el, out) {
  const knob = el.querySelector('.knob'); let id = null, cx = 0, cy = 0;
  el.addEventListener('pointerdown', (e) => { id = e.pointerId; const r = el.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; el.setPointerCapture(id); });
  el.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    let dx = (e.clientX - cx) / 50, dy = (e.clientY - cy) / 50; const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
    out.x = dx; out.y = dy; knob.style.transform = `translate(${dx * 34}px, ${dy * 34}px)`; state.dirty = true;
  });
  const end = (e) => { if (e.pointerId !== id) return; id = null; out.x = out.y = 0; knob.style.transform = ''; };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
}
joystick($('#joy-left'), joy.move); joystick($('#joy-right'), joy.look);

function stepWalk(dt) {
  dt = Math.min(dt, 0.05);
  // look (touch)
  if (joy.look.x || joy.look.y) {
    camera.rotation.y -= joy.look.x * 1.6 * dt; camera.rotation.x -= joy.look.y * 1.2 * dt;
    camera.rotation.x = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, camera.rotation.x));
  }
  // move
  let mx = 0, mz = 0, my = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) mz += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) mz -= 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) mx -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) mx += 1;
  if (keys.has('KeyE') || keys.has('Space')) my += 1;
  if (keys.has('KeyQ') || keys.has('KeyC')) my -= 1;
  mz -= joy.move.y; mx += joy.move.x;
  const run = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const speed = fly ? FLY : (run ? RUN : WALK);
  const moving = mx || mz || my;
  if (!moving) return false;
  camera.getWorldDirection(fwd);
  if (!fly) { fwd.y = 0; }
  fwd.normalize(); right.crossVectors(fwd, camera.up).normalize();
  const delta = new THREE.Vector3().addScaledVector(fwd, mz).addScaledVector(right, mx);
  if (delta.lengthSq() > 1) delta.normalize();
  delta.multiplyScalar(speed * dt);
  if (fly) { delta.y += my * speed * dt; camera.position.add(delta); return true; }
  // walls: try the full move, then each axis, so we slide along walls
  // wall ray at knee height above the step limit, so stairs are stepped up rather than treated as walls
  const from = camera.position.clone(); from.y -= (EYE - STEP - 0.2);
  const tryMove = (d) => {
    if (d.lengthSq() < 1e-8) return false;
    const dir = d.clone().normalize();
    if (blocked(from, dir, d.length() + 0.7)) return false;
    const g = groundHeight(camera.position.x + d.x, camera.position.z + d.z, camera.position.y);
    if (g === null) return false;
    if (g + EYE - camera.position.y > STEP) return false;   // too big a step up
    if (camera.position.y - (g + EYE) > 3.0) return false;   // and no walking off terraces (fly mode if you must)
    camera.position.x += d.x; camera.position.z += d.z;
    // follow the ground, gently on the way down
    const target = g + EYE; const dy = target - camera.position.y;
    camera.position.y += dy > 0 ? dy : Math.max(dy, -12 * dt);
    return true;
  };
  if (!tryMove(delta)) { tryMove(new THREE.Vector3(delta.x, 0, 0)) || tryMove(new THREE.Vector3(0, 0, delta.z)); }
  return true;
}

// ---------- main loop ----------
let lastT = performance.now();
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  if (stars) stars.material.uniforms.pr.value = renderer.getPixelRatio();
  state.dirty = true;
}
addEventListener('resize', resize); resize();

function frame(now) {
  requestAnimationFrame(frame);
  const dt = (now - lastT) / 1000; lastT = now;
  let need = state.dirty;
  // day/night crossfade
  if (Math.abs(state.night - state.nightTarget) > 0.001) {
    const k = reduceMotion ? 1 : Math.min(1, dt * 1.6);
    state.night += (state.nightTarget - state.night) * k; if (Math.abs(state.night - state.nightTarget) < 0.002) state.night = state.nightTarget;
    applyNight(); need = true;
  }
  if (state.mode === 'walk') {
    need = stepWalk(dt) || need || controls.isLocked;
  } else {
    // ease the camera toward its goal
    const k = reduceMotion ? 1 : Math.min(1, dt * 3.2);
    camNow.p.lerp(camGoal.p, k); camNow.t.lerp(camGoal.t, k);
    if (camNow.p.distanceToSquared(camGoal.p) > 1e-4 || camNow.t.distanceToSquared(camGoal.t) > 1e-4) need = true;
    camera.position.copy(camNow.p); camera.lookAt(camNow.t);
  }
  if (need) { renderer.render(scene, camera); state.dirty = false; }
}
requestAnimationFrame(frame);
// debug hook: render once and hand back a JPEG of the canvas
window.__cenotaph = { state, camera, scene, renderer, applyNight, stepWalk, keys, snap(q = 0.7) { renderer.render(scene, camera); return canvas.toDataURL('image/jpeg', q); }, goTo, enterWalk, exitWalk, enterPose, setNight, onScroll, camNow, camGoal };
// keep the sky and halo centred sensibly
sky.onBeforeRender = () => { sky.position.copy(camera.position); };
