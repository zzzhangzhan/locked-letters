import * as THREE from 'three';
import { buildFold, sheetSize } from './folds.js';

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x1c1410);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 40);
  const holder = new THREE.Group();
  scene.add(holder);

  const hemi = new THREE.HemisphereLight(0xfff4e4, 0x2a2118, 0.9);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff1dd, 1.2);
  key.position.set(2.4, 3.4, 4.2);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xc5d4e8, 0.38);
  fill.position.set(-3.2, 1.2, 2.4);
  scene.add(fill);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(8, 64),
    new THREE.MeshStandardMaterial({ color: 0x18110e, roughness: 1 }),
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
  let fold = 'trifold';
  let progress = 0;
  let mode = 'composer';
  let playing = false;
  let playToken = 0;
  let userMoved = false;
  let readLatched = false;
  let readRadius = 3.4;
  let viewRadius = 5;
  let onUnfold = null;

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
        frontMat = new THREE.MeshStandardMaterial({
          map: texture,
          roughness: 0.84,
          metalness: 0,
          side: THREE.FrontSide,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        });
        backMat = new THREE.MeshStandardMaterial({
          color: backColor,
          roughness: 0.95,
          metalness: 0,
          side: THREE.BackSide,
        });
      } else {
        frontMat.map = texture;
        frontMat.needsUpdate = true;
        backMat.color.set(backColor);
      }
    } else {
      texture.image = letterCanvas;
      texture.needsUpdate = true;
      backMat.color.set(backColor);
    }

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

  function mountModel() {
    if (model) {
      holder.remove(model.root);
      model.root.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
      });
    }
    model = buildFold(fold, { front: frontMat, back: backMat });
    holder.add(model.root);
    model.setProgress(progress);
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
    model?.setProgress(progress);
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
    if (playing || event.button !== 0) return;
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
  }

  function frameSubject() {
    const dist = spherical.radius;
    const viewH = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * dist;
    const viewW = viewH * camera.aspect;
    let shiftX = 0;
    let shiftY = 0;
    const panel = document.getElementById('composer');
    if (panel && !panel.hidden) {
      if (window.innerWidth > 800) {
        const cover = Math.min(panel.offsetWidth + 36, canvas.clientWidth * 0.55) / canvas.clientWidth;
        shiftX = (cover * viewW) / 2;
      } else {
        const cover = Math.min(panel.offsetHeight, canvas.clientHeight * 0.58) / canvas.clientHeight;
        shiftY = (cover * viewH) / 2;
      }
    }
    holder.position.set(shiftX, shiftY, 0);
    target.set(shiftX, shiftY, 0);
    shadow.position.x = shiftX;
    shadow.position.z = 0.15;
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
    frameSubject();
    if (mode === 'reader' && !pointer.kind && !playing && progress < 0.08 && !readLatched) {
      if (easeToRead(dt)) readLatched = true;
    }
    const offset = new THREE.Vector3().setFromSpherical(spherical);
    camera.position.copy(target).add(offset);
    camera.lookAt(target);
    renderer.render(scene, camera);
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
    playTo,
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
