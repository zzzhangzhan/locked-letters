import * as THREE from 'three';
import { buildFold, rollEdges, sheetSize } from './folds.js';

// Linear-space multiplier, so folded-over paper reads as the back of the sheet.
const BACK_SHADE = 0.66;
// Phones get fewer pixels and a smaller shadow map, which they redraw far slower.
const lowPower = window.matchMedia('(pointer: coarse)').matches;

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowPower ? 1.5 : 2));
  renderer.setClearColor(0x1c1410);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 40);
  const holder = new THREE.Group();
  scene.add(holder);

  // A low ambient and a strong key raking across the sheet from the upper
  // side, so creases and stacked layers read by their light and shadow.
  const hemi = new THREE.HemisphereLight(0xfff4e4, 0x1a130e, 0.5);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffe9cc, 6.5);
  key.position.set(-0.1, 4.3, 2.8);
  key.target = holder;
  key.castShadow = true;
  key.shadow.mapSize.setScalar(lowPower ? 2048 : 4096);
  Object.assign(key.shadow.camera, { left: -2.4, right: 2.4, top: 2.4, bottom: -2.4, near: 0.5, far: 14 });
  // Lit from about 40 degrees off the tilted sheet, past its top edge, each
  // layer's edge throws a shadow down the sheet about as long as the step is
  // high: a thin dark line along every seam and stack.
  // Depth bias (a share of the camera's near-to-far range) spares single-layer
  // steps, which would otherwise freckle with acne.
  // Both scale with the shadow map's texel size.
  const texel = 4096 / key.shadow.mapSize.x;
  key.shadow.bias = -0.0006 * texel;
  key.shadow.normalBias = 0.006 * texel;
  key.shadow.radius = 4;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xb9c8e0, 0.22);
  fill.position.set(-3.6, 0.8, 2.6);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffd9a8, 0.9);
  rim.position.set(-2.4, 3.2, -3.4);
  scene.add(rim);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(8, 64),
    new THREE.MeshBasicMaterial({ color: 0x1e1612, toneMapped: false }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.72;
  scene.add(floor);

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.8, 1.15),
    new THREE.MeshBasicMaterial({
      map: shadowTexture(),
      transparent: true,
      depthWrite: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -1.7;
  scene.add(shadow);

  const target = new THREE.Vector3();
  const spherical = new THREE.Spherical(5, 1.16, 0.46);
  const raycaster = new THREE.Raycaster();
  const clock = new THREE.Clock();

  let texture = null;
  let uploadedWidth = 0;
  let uploadedHeight = 0;
  let frontMat = null;
  let backMat = null;
  let model = null;
  const models = new Map();
  let fold = 'trifold';
  let progress = 0;
  let mode = 'composer';
  let playing = false;
  let playToken = 0;
  let userMoved = false;
  let readLatched = false;
  let readRadius = 3.4;
  let viewRadius = 5;
  let frameDistance = 5;
  let onUnfold = null;
  const stacked = window.matchMedia('(max-width: 820px) and (max-aspect-ratio: 4/5)');
  let framing = 'aside';
  let framed = false;
  let shownX = 0;
  let shownY = 0;
  let shownLift = 0;
  let fly = 0;
  let flyStarted = 0;
  let flyMs = 1;
  let flyResolve = null;
  let dirty = true;
  let lastPose = '';

  const pointer = {
    id: null,
    kind: null,
    sign: null,
    x: 0,
    y: 0,
    progress: 0,
    theta: 0,
    phi: 0,
  };

  holder.rotation.set(-0.16, 0.34, 0);

  function setMode(next) {
    mode = next;
    readLatched = false;
  }

  function setLetter({ canvas: letterCanvas, backColor, fold: nextFold }) {
    const sizeChanged = !texture
      || uploadedWidth !== letterCanvas.width
      || uploadedHeight !== letterCanvas.height;
    if (sizeChanged) {
      if (texture) texture.dispose();
      texture = new THREE.CanvasTexture(letterCanvas);
      uploadedWidth = letterCanvas.width;
      uploadedHeight = letterCanvas.height;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 1;
      texture.generateMipmaps = false;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      if (!frontMat) {
        backMat = rollEdges(new THREE.MeshStandardMaterial({
          roughness: 0.95,
          metalness: 0,
          side: THREE.BackSide,
        }));
        frontMat = rollEdges(new THREE.MeshStandardMaterial({
          map: texture,
          roughness: 0.84,
          metalness: 0,
          side: THREE.FrontSide,
        }), backMat.color);
      } else {
        frontMat.map = texture;
        frontMat.needsUpdate = true;
      }
    } else {
      texture.image = letterCanvas;
      texture.needsUpdate = true;
    }
    backMat.color.set(backColor).multiplyScalar(BACK_SHADE);
    dirty = true;

    const size = sheetSize(nextFold);
    readRadius = size.h * 1.38;
    viewRadius = size.h * 2.12;
    const foldChanged = nextFold !== fold || !model;
    fold = nextFold;
    if (foldChanged) {
      mountModel();
      if (!userMoved) restPose();
    }
  }

  // Building a fold takes up to a second, so each is built once and kept.
  function mountModel() {
    if (model) holder.remove(model.root);
    prepare(fold);
    model = models.get(fold);
    holder.add(model.root);
    model.setProgress(progress);
    dirty = true;
  }

  // Builds a fold ahead of time, so switching to it later doesn't stall.
  function prepare(id) {
    if (models.has(id) || !frontMat) return;
    const built = buildFold(id, { front: frontMat, back: backMat });
    built.root.traverse((obj) => {
      obj.castShadow = true;
      obj.receiveShadow = true;
    });
    built.setProgress(0);
    models.set(id, built);
  }

  function restPose() {
    spherical.radius = viewRadius;
    spherical.theta = 0.46;
    spherical.phi = 1.16;
    holder.rotation.set(-0.16, 0.34, 0);
  }

  function setProgress(value) {
    const previous = progress;
    progress = THREE.MathUtils.clamp(value, 0, 1);
    if (progress !== previous) {
      model?.setProgress(progress);
      dirty = true;
    }
    if (mode === 'reader' && previous >= 0.08 && progress < 0.08) readLatched = false;
    if (progress > 0.12) readLatched = false;
  }

  function playTo(target, ms) {
    const token = ++playToken;
    playing = true;
    const from = progress;
    const goal = THREE.MathUtils.clamp(target, 0, 1);
    if (ms <= 0) {
      setProgress(goal);
      if (token === playToken) playing = false;
      return Promise.resolve(true);
    }
    const started = performance.now();
    return new Promise((resolve) => {
      function step(now) {
        if (token !== playToken) {
          resolve(false);
          return;
        }
        const u = Math.min(1, (now - started) / ms);
        const eased = u * u * (3 - 2 * u);
        setProgress(from + (goal - from) * eased);
        if (u < 1) requestAnimationFrame(step);
        else {
          playing = false;
          resolve(true);
        }
      }
      requestAnimationFrame(step);
    });
  }

  function hitsLetter(event) {
    if (!model) return false;
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    return raycaster.intersectObject(model.root, true).length > 0;
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || (playing && mode !== 'composer')) return;
    pointer.id = event.pointerId;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.sign = null;
    pointer.progress = progress;
    pointer.theta = spherical.theta;
    pointer.phi = spherical.phi;
    pointer.kind = mode === 'reader' && hitsLetter(event) ? 'unfold' : 'orbit';
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener('pointermove', (event) => {
    if (pointer.id !== event.pointerId || !pointer.kind) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    if (pointer.kind === 'unfold') {
      if (pointer.sign == null) {
        if (Math.abs(dx) < 4) return;
        pointer.sign = pointer.progress > 0.85 ? -Math.sign(dx) : -1;
      }
      setProgress(pointer.progress + (pointer.sign * dx) / 340);
      if (Math.abs(dx) > 6) onUnfold?.();
      return;
    }
    if (Math.abs(dx) + Math.abs(dy) > 3) userMoved = true;
    spherical.theta = pointer.theta - dx * 0.006;
    spherical.phi = THREE.MathUtils.clamp(pointer.phi - dy * 0.004, 0.55, 2.15);
  });

  function endPointer(event) {
    if (pointer.id !== event.pointerId) return;
    pointer.id = null;
    pointer.kind = null;
  }

  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    userMoved = true;
    spherical.radius = THREE.MathUtils.clamp(
      spherical.radius + event.deltaY * 0.003,
      readRadius * 0.82,
      viewRadius * 1.45,
    );
  }, { passive: false });

  function resize() {
    const width = canvas.clientWidth;
    const height = Math.max(canvas.clientHeight, 1);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    dirty = true;
  }

  function frameSubject(dt) {
    const dock = document.querySelector('.float:not([hidden])');
    const aside = framing === 'aside' && Boolean(dock);
    const height = Math.max(canvas.clientHeight, 1);
    const below = aside && stacked.matches;
    const docked = below ? Math.min(dock.offsetHeight, height * 0.65) : 0;
    const open = 1 - docked / height;
    const narrow = Math.max(1, 0.8 / camera.aspect);
    const fit = framing === 'away' ? 1.12 + fly * 0.9 : below ? 1.12 / open : aside ? 1.5 : 1.05 * narrow;
    frameDistance = spherical.radius * fit;
    const viewH = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * frameDistance;
    const viewW = viewH * camera.aspect;
    const goalX = aside && !below ? viewW * 0.22 : 0;
    const goalY = aside && !below ? viewH * 0.04 : 0;
    const goalLift = docked / 2;
    if (!framed) {
      shownX = goalX;
      shownY = goalY;
      shownLift = goalLift;
      framed = true;
    } else {
      shownX = THREE.MathUtils.damp(shownX, goalX, 3.4, dt);
      shownY = THREE.MathUtils.damp(shownY, goalY, 3.4, dt);
      shownLift = THREE.MathUtils.damp(shownLift, goalLift, 3.4, dt);
    }
    if (framing === 'away') {
      const u = Math.min(1, (performance.now() - flyStarted) / flyMs);
      fly = u * u;
      if (u >= 1 && flyResolve) {
        const done = flyResolve;
        flyResolve = null;
        done();
      }
    }
    // The sheet stays at the orbit's centre, so dragging turns it about its own
    // middle; the picture is shifted aside on screen instead, which also keeps
    // the key light's angle.
    const width = canvas.clientWidth;
    const shiftX = ((shownX * (1 - fly)) / viewW) * width;
    const shiftY = (shownY / viewH) * height + shownLift;
    if (Math.abs(shiftX) > 0.5 || Math.abs(shiftY) > 0.5) {
      camera.setViewOffset(width, height, -shiftX, shiftY, width, height);
    } else if (camera.view?.enabled) {
      camera.clearViewOffset();
    }
    const lift = fly * viewH * 1.35;
    holder.position.set(0, lift, fly * viewH * 0.45);
    holder.rotation.z = fly * -0.4;
    target.set(0, 0, 0);
    shadow.position.x = 0;
    shadow.position.z = 0.15;
    shadow.material.opacity = 1 - fly;
  }

  function snapFrame() {
    framed = false;
    dirty = true;
  }

  function takeCenter() {
    framing = 'center';
    fly = 0;
  }

  function flyAway(ms) {
    framing = 'away';
    fly = 0;
    flyStarted = performance.now();
    flyMs = Math.max(ms, 1);
    return new Promise((resolve) => {
      flyResolve = resolve;
    });
  }

  function present() {
    framing = 'aside';
    fly = 0;
    holder.rotation.z = 0;
    shadow.material.opacity = 1;
    if (flyResolve) {
      const done = flyResolve;
      flyResolve = null;
      done();
    }
  }

  function easeToRead(dt) {
    const pose = {
      theta: 0,
      phi: Math.PI / 2,
      radius: readRadius,
      rx: 0,
      ry: 0,
    };
    spherical.theta = THREE.MathUtils.damp(spherical.theta, pose.theta, 5, dt);
    spherical.phi = THREE.MathUtils.damp(spherical.phi, pose.phi, 5, dt);
    spherical.radius = THREE.MathUtils.damp(spherical.radius, pose.radius, 5, dt);
    holder.rotation.x = THREE.MathUtils.damp(holder.rotation.x, pose.rx, 5, dt);
    holder.rotation.y = THREE.MathUtils.damp(holder.rotation.y, pose.ry, 5, dt);
    return Math.abs(spherical.theta - pose.theta) < 0.012
      && Math.abs(spherical.phi - pose.phi) < 0.012
      && Math.abs(spherical.radius - pose.radius) < 0.03
      && Math.abs(holder.rotation.x) < 0.012
      && Math.abs(holder.rotation.y) < 0.012;
  }

  function animate() {
    const dt = Math.min(clock.getDelta(), 0.05);
    frameSubject(dt);
    if (mode === 'reader' && !pointer.kind && !playing && progress < 0.08 && !readLatched) {
      if (easeToRead(dt)) readLatched = true;
    }
    const offset = new THREE.Vector3().setFromSpherical(spherical).setLength(frameDistance);
    camera.position.copy(target).add(offset);
    camera.lookAt(target);
    // Only draw when something on screen moved, so a still letter leaves the
    // phone free for typing.
    const pose = [
      camera.position.x, camera.position.y, camera.position.z,
      holder.position.x, holder.position.y, holder.position.z,
      holder.rotation.x, holder.rotation.y, holder.rotation.z,
      shownX, shownY, shownLift, camera.aspect, shadow.material.opacity,
    ].map((value) => value.toFixed(4)).join();
    if (dirty || pose !== lastPose) {
      renderer.render(scene, camera);
      lastPose = pose;
      dirty = false;
    }
    requestAnimationFrame(animate);
  }

  resize();
  window.addEventListener('resize', resize);
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => resize());
    observer.observe(canvas);
  }
  requestAnimationFrame(animate);
  return {
    get fold() {
      return fold;
    },
    get progress() {
      return progress;
    },
    setMode,
    setLetter,
    setProgress,
    prepare,
    playTo,
    takeCenter,
    snapFrame,
    flyAway,
    present,
    onUnfold(listener) {
      onUnfold = listener;
    },
  };
}

function shadowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 8, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.45)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
