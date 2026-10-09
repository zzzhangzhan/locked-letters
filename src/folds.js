import * as THREE from 'three';

const FOLD_ANGLE = Math.PI * 0.992;

export const FOLDS = [
  {
    id: 'trifold',
    name: 'Tri-fold',
    blurb: 'Bottom folds up, then the top closes over it.',
  },
  {
    id: 'gate',
    name: 'Gate fold',
    blurb: 'The wings fold in, one over the other.',
  },
  {
    id: 'locked',
    name: 'Locked square',
    blurb: 'Four corners fold in and cover the writing.',
  },
];

export function sheetSize(fold) {
  if (fold === 'locked') return { w: 2.2, h: 2.2 };
  const h = 2.4;
  return { w: h * (8.5 / 11), h };
}

export function buildFold(id, materials) {
  if (id === 'gate') return buildGate(materials);
  if (id === 'locked') return buildLocked(materials);
  return buildTrifold(materials);
}

function buildTrifold(materials) {
  const { w, h } = sheetSize('trifold');
  const band = h / 3;
  const root = new THREE.Group();
  const flaps = [];

  addRect(root, materials, {
    x0: -w / 2,
    y0: -band / 2,
    x1: w / 2,
    y1: band / 2,
    originX: 0,
    originY: 0,
    sheetW: w,
    sheetH: h,
    order: 0,
  });

  flaps.push(makeFlap(root, materials, {
    hinge: { x: 0, y: -band / 2 },
    axis: 'x',
    direction: -1,
    lift: 0.018,
    order: 1,
    x0: -w / 2,
    y0: -band,
    x1: w / 2,
    y1: 0,
    originX: 0,
    originY: -band / 2,
    sheetW: w,
    sheetH: h,
  }));

  flaps.push(makeFlap(root, materials, {
    hinge: { x: 0, y: band / 2 },
    axis: 'x',
    direction: 1,
    lift: 0.042,
    order: 2,
    x0: -w / 2,
    y0: 0,
    x1: w / 2,
    y1: band,
    originX: 0,
    originY: band / 2,
    sheetW: w,
    sheetH: h,
  }));

  return { root, setProgress: (t) => applyFlaps(flaps, t) };
}

function buildGate(materials) {
  const { w, h } = sheetSize('gate');
  const band = w / 3;
  const root = new THREE.Group();
  const flaps = [];

  addRect(root, materials, {
    x0: -band / 2,
    y0: -h / 2,
    x1: band / 2,
    y1: h / 2,
    originX: 0,
    originY: 0,
    sheetW: w,
    sheetH: h,
    order: 0,
  });

  flaps.push(makeFlap(root, materials, {
    hinge: { x: -band / 2, y: 0 },
    axis: 'y',
    direction: 1,
    lift: 0.018,
    order: 1,
    x0: -band,
    y0: -h / 2,
    x1: 0,
    y1: h / 2,
    originX: -band / 2,
    originY: 0,
    sheetW: w,
    sheetH: h,
  }));

  flaps.push(makeFlap(root, materials, {
    hinge: { x: band / 2, y: 0 },
    axis: 'y',
    direction: -1,
    lift: 0.042,
    order: 2,
    x0: 0,
    y0: -h / 2,
    x1: band,
    y1: h / 2,
    originX: band / 2,
    originY: 0,
    sheetW: w,
    sheetH: h,
  }));

  return { root, setProgress: (t) => applyFlaps(flaps, t) };
}

function buildLocked(materials) {
  const { w } = sheetSize('locked');
  const half = w / 2;
  const verts = [
    [-half, 0],
    [0, half],
    [half, 0],
    [0, -half],
    [-half, half],
    [half, half],
    [half, -half],
    [-half, -half],
  ];
  const positions = [];
  const uvs = [];
  verts.forEach(([x, y]) => {
    positions.push(x, y, 0);
    uvs.push((x + half) / w, (y + half) / w);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex([
    0, 2, 1,
    0, 3, 2,
    0, 1, 4,
    1, 2, 5,
    2, 3, 6,
    3, 0, 7,
  ]);
  geometry.computeVertexNormals();

  const rest = Float32Array.from(geometry.getAttribute('position').array);
  const corners = [
    { tip: 4, a: 0, b: 1 },
    { tip: 5, a: 1, b: 2 },
    { tip: 6, a: 2, b: 3 },
    { tip: 7, a: 3, b: 0 },
  ].map((corner, index) => ({ ...corner, lift: 0.02 + index * 0.016, sign: foldSign(rest, corner) }));

  const root = new THREE.Group();
  const front = new THREE.Mesh(geometry, materials.front);
  const back = new THREE.Mesh(geometry, materials.back);
  root.add(front, back);
  const origin = new THREE.Vector3();
  const axis = new THREE.Vector3();
  const point = new THREE.Vector3();
  const quat = new THREE.Quaternion();

  function setProgress(t) {
    const progress = THREE.MathUtils.clamp(t, 0, 1);
    const attr = geometry.getAttribute('position');
    attr.array.set(rest);
    corners.forEach((corner, index) => {
      const amount = smooth(segment(progress, index, corners.length));
      if (amount === 0) return;
      origin.set(rest[corner.a * 3], rest[corner.a * 3 + 1], 0);
      axis.set(rest[corner.b * 3] - origin.x, rest[corner.b * 3 + 1] - origin.y, 0).normalize();
      point.set(rest[corner.tip * 3], rest[corner.tip * 3 + 1], 0);
      quat.setFromAxisAngle(axis, corner.sign * amount * FOLD_ANGLE);
      point.sub(origin).applyQuaternion(quat).add(origin);
      attr.setXYZ(corner.tip, point.x, point.y, point.z + corner.lift * amount);
    });
    attr.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  return { root, setProgress };
}

function foldSign(rest, corner) {
  const origin = new THREE.Vector3(rest[corner.a * 3], rest[corner.a * 3 + 1], 0);
  const axis = new THREE.Vector3(
    rest[corner.b * 3] - origin.x,
    rest[corner.b * 3 + 1] - origin.y,
    0,
  ).normalize();
  const point = new THREE.Vector3(rest[corner.tip * 3], rest[corner.tip * 3 + 1], 0).sub(origin);
  const turned = point.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, 0.2));
  return turned.z >= 0 ? 1 : -1;
}

function makeFlap(root, materials, spec) {
  const hinge = new THREE.Group();
  hinge.position.set(spec.hinge.x, spec.hinge.y, 0);
  const rotator = new THREE.Group();
  hinge.add(rotator);
  root.add(hinge);
  addRect(rotator, materials, spec);
  return { rotator, axis: spec.axis, direction: spec.direction, lift: spec.lift };
}

function applyFlaps(flaps, t) {
  const progress = THREE.MathUtils.clamp(t, 0, 1);
  flaps.forEach((flap, index) => {
    const amount = smooth(segment(progress, index, flaps.length));
    flap.rotator.rotation.set(0, 0, 0);
    flap.rotator.rotation[flap.axis] = flap.direction * amount * FOLD_ANGLE;
    flap.rotator.position.z = flap.lift * amount;
  });
}

function segment(t, index, count) {
  const start = index / count;
  const end = (index + 1) / count;
  return THREE.MathUtils.clamp((t - start) / (end - start), 0, 1);
}

function smooth(u) {
  return u * u * (3 - 2 * u);
}

function addRect(parent, materials, spec) {
  const geometry = rectGeometry(
    spec.x0,
    spec.y0,
    spec.x1,
    spec.y1,
    spec.originX,
    spec.originY,
    spec.sheetW,
    spec.sheetH,
  );
  addSurfaces(parent, geometry, materials, spec.order || 0);
}

function rectGeometry(x0, y0, x1, y1, originX, originY, sheetW, sheetH) {
  const sx = (x) => (x + originX + sheetW / 2) / sheetW;
  const sy = (y) => (y + originY + sheetH / 2) / sheetH;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    x0, y0, 0,
    x1, y0, 0,
    x1, y1, 0,
    x0, y1, 0,
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
    sx(x0), sy(y0),
    sx(x1), sy(y0),
    sx(x1), sy(y1),
    sx(x0), sy(y1),
  ], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  return geometry;
}

function addSurfaces(parent, geometry, materials, order) {
  const front = new THREE.Mesh(geometry, materials.front);
  const back = new THREE.Mesh(geometry, materials.back);
  front.renderOrder = order;
  back.renderOrder = order;
  parent.add(front, back);
}
