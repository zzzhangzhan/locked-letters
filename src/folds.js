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
  {
    id: 'pagu',
    name: 'Pagu hexagon',
    blurb: 'UH6104: corners and edges fold in, then a tip tucks into the pocket.',
  },
];

export function sheetSize(fold) {
  if (fold === 'locked' || fold === 'pagu') return { w: 2.2, h: 2.2 };
  const h = 2.4;
  return { w: h * (8.5 / 11), h };
}

export function buildFold(id, materials) {
  if (id === 'gate') return buildGate(materials);
  if (id === 'locked') return buildLocked(materials);
  if (id === 'pagu') return buildPagu(materials);
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

// Pagu hexagon (UH6104): a small top hem, the bottom-left and top-right
// corners, then the bottom and top edges, the left point, the right point,
// and a tip tucked into the pocket.
function buildPagu(materials) {
  const S = sheetSize('pagu').w;
  const steps = paguSteps();
  const pieces = carvePagu(steps);
  const positions = [];
  const uvs = [];
  const indices = [];
  const masks = [];
  pieces.forEach((piece) => {
    const base = positions.length / 3;
    piece.poly.forEach((vertex) => {
      positions.push((vertex.x - 0.5) * S, (vertex.y - 0.5) * S, 0);
      uvs.push(vertex.x, vertex.y);
      masks.push(piece.mask);
    });
    for (let i = 1; i < piece.poly.length - 1; i += 1) {
      indices.push(base, base + i, base + i + 1);
    }
  });

  const rest = Float32Array.from(positions);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const root = new THREE.Group();
  root.add(new THREE.Mesh(geometry, materials.front), new THREE.Mesh(geometry, materials.back));

  const point = new THREE.Vector3();
  const origin = new THREE.Vector3();
  const axis = new THREE.Vector3();
  const probe = new THREE.Quaternion();
  const hinges = steps.map(() => ({
    origin: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    lift: 0,
    active: false,
  }));

  function creaseMoved(index, u, v) {
    let mask = 0;
    for (let earlier = 0; earlier < index; earlier += 1) {
      const step = steps[earlier];
      if (step.keep(u, v) <= 0.004) continue;
      if (step.requires && !step.requires(mask)) continue;
      mask |= 1 << earlier;
    }
    return mask;
  }

  function place(u, v, mask, target) {
    target.set((u - 0.5) * S, (v - 0.5) * S, 0);
    hinges.forEach((hinge, index) => {
      if (!hinge.active || (mask & (1 << index)) === 0) return;
      target.sub(hinge.origin).applyQuaternion(hinge.quat).add(hinge.origin);
      target.z += hinge.lift;
    });
    return target;
  }

  function setProgress(t) {
    const progress = THREE.MathUtils.clamp(t, 0, 1);
    steps.forEach((step, index) => {
      const hinge = hinges[index];
      const amount = smooth(segment(progress, index, steps.length));
      hinge.lift = step.lift * amount;
      hinge.active = amount > 0.001;
      if (!hinge.active) return;
      const midU = (step.ax + step.bx) / 2;
      const midV = (step.ay + step.by) / 2;
      const mask = creaseMoved(index, midU, midV);
      place(step.ax, step.ay, mask, origin);
      place(step.bx, step.by, mask, axis);
      axis.sub(origin);
      if (axis.lengthSq() < 1e-8) {
        hinge.active = false;
        return;
      }
      axis.normalize();
      place(step.sx, step.sy, mask, point);
      probe.setFromAxisAngle(axis, 0.35);
      const before = point.z;
      point.sub(origin).applyQuaternion(probe).add(origin);
      const sign = point.z >= before ? 1 : -1;
      hinge.origin.copy(origin);
      hinge.quat.setFromAxisAngle(axis, sign * amount * FOLD_ANGLE);
    });

    const attr = geometry.getAttribute('position');
    for (let i = 0; i < masks.length; i += 1) {
      const u = rest[i * 3] / S + 0.5;
      const v = rest[i * 3 + 1] / S + 0.5;
      let mask = 0;
      steps.forEach((step, index) => {
        if ((masks[i] & (1 << index)) === 0) return;
        if (step.requires && !step.requires(mask)) return;
        mask |= 1 << index;
      });
      place(u, v, mask, point);
      attr.setXYZ(i, point.x, point.y, point.z);
    }
    attr.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  return { root, setProgress };
}

function carvePagu(steps) {
  const pieces = [];
  const eps = 1e-6;
  function intersect(p, q, sp, sq) {
    const t = Math.abs(sp - sq) < 1e-9 ? 0 : sp / (sp - sq);
    return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
  }
  function clip(poly, positive, side) {
    const out = [];
    poly.forEach((cur, index) => {
      const prev = poly[(index + poly.length - 1) % poly.length];
      const sc = side(cur.x, cur.y);
      const sp = side(prev.x, prev.y);
      const curIn = positive ? sc >= -eps : sc <= eps;
      const prevIn = positive ? sp >= -eps : sp <= eps;
      if (curIn) {
        if (!prevIn) out.push(intersect(prev, cur, sp, sc));
        out.push(cur);
      } else if (prevIn) out.push(intersect(prev, cur, sp, sc));
    });
    return out;
  }
  function carve(poly, mask, index) {
    if (poly.length < 3) return;
    if (index >= steps.length) {
      pieces.push({ poly, mask });
      return;
    }
    const side = steps[index].keep;
    const onFlap = clip(poly, true, side);
    const offFlap = clip(poly, false, side);
    carve(onFlap, mask | (1 << index), index + 1);
    carve(offFlap, mask, index + 1);
  }
  carve([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], 0, 0);
  return pieces;
}

function paguSteps() {
  const center = (mask) => (mask & 6) === 0;
  return [
    { ax: 0, ay: 0.92, bx: 1, by: 0.92, sx: 0.5, sy: 0.98, lift: 0.01, keep: (x, y) => y - 0.92 },
    { ax: 0.92, ay: 0, bx: 0, by: 0.92, sx: 0.08, sy: 0.08, lift: 0.014, keep: (x, y) => 0.92 - x - y },
    { ax: 0.08, ay: 1, bx: 1, by: 0.08, sx: 0.9, sy: 0.9, lift: 0.018, keep: (x, y) => x + y - 1.08 },
    { ax: 1, ay: 0.36, bx: 0, by: 0.36, sx: 0.5, sy: 0.08, lift: 0.022, keep: (x, y) => 0.36 - y, requires: center },
    { ax: 0, ay: 0.64, bx: 1, by: 0.64, sx: 0.5, sy: 0.88, lift: 0.026, keep: (x, y) => y - 0.64, requires: center },
  ];
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
