import * as THREE from 'three';

// `catalog`, where set, is the fold's own page in the UH catalogue.
export const FOLDS = [
  {
    id: 'gate',
    name: 'Closed gatefold',
    blurb: 'Both side edges fold to the center like two gate doors swinging shut, then the sheet folds in half so all four panels stack.',
    uh: 'UH0115',
    video: 'https://www.youtube.com/watch?v=BlNS6KBeqoA',
  },
  {
    id: 'pagu',
    name: 'Pagu hexagon',
    blurb: 'Corners and edges fold into a hexagon, then a tip tucks into its own pocket to lock it shut.',
    uh: 'UH6104',
    video: 'https://www.youtube.com/watch?v=ZGNSWfi0UmI',
  },
  {
    id: 'jeff',
    name: 'Jefferson pentagon',
    history:
      'In December 1818 at Monticello, Thomas Jefferson locked a note to Charlottesville watchmaker Louis Leschot into a tiny pentagon — asking him to repair his daughter’s watch, settle the family’s bill, and come to dinner.',
    blurb: 'Roll-fold into a narrow strip, bend it into an L with unequal legs, stand both legs up, then fold the long one across and tuck its end behind the short one.',
    uh: 'UH6314',
    video: 'https://www.youtube.com/watch?v=Ozwys8hr8pA',
    catalog: 'https://letterlocking.org/uh6314',
  },
];

export function sheetSize(fold) {
  if (fold === 'locked' || fold === 'pagu') return { w: 2.2, h: 2.2 };
  // UH6314 opens at about 152 × 130 mm — wider than it is tall.
  if (fold === 'jeff') {
    const w = 2.5;
    return { w, h: w * (130 / 152) };
  }
  const h = 2.4;
  return { w: h * (8.5 / 11), h };
}

// Teaches a standard material the rolled edges of pressed folds, read from the
// sheet's `rim` attribute: the way to the nearest folded edge (scaled by how
// pressed it is) and the distance to it. Given the back's color, the face also
// takes it on where the sheet's `shade` attribute says, so a tip bending back
// against its flap's turn doesn't flash its other side.
export function rollEdges(material, backColor = null) {
  material.onBeforeCompile = (shader) => {
    if (backColor) shader.uniforms.backTint = { value: backColor };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 rim;\nattribute float shade;\nvarying vec3 vRimDir;\nvarying float vRimDist;\nvarying float vShade;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRimDir = normalMatrix * rim.xyz;\nvRimDist = rim.w;\nvShade = shade;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vRimDir;\nvarying float vRimDist;\nvarying float vShade;${backColor ? '\nuniform vec3 backTint;' : ''}`)
      .replace('#include <map_fragment>', backColor
        ? '#include <map_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, backTint, vShade);'
        : '#include <map_fragment>')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      {
        float pressed = length(vRimDir);
        float t = 1.0 - clamp(vRimDist / ${RIM_WIDTH.toFixed(4)}, 0.0, 1.0);
        vec3 edge = vRimDir - dot(vRimDir, normal) * normal;
        if (pressed > 1e-3 && t > 0.0 && dot(edge, edge) > 1e-8) {
          float turn = ${RIM_TURN.toFixed(4)} * min(pressed, 1.0) * t * t;
          normal = normalize(normal * cos(turn) + normalize(edge) * sin(turn));
        }
      }`);
  };
  material.customProgramCacheKey = () => (backColor ? 'rolled-edges-tinted' : 'rolled-edges');
  material.needsUpdate = true;
  return material;
}

export function buildFold(id, materials) {
  if (id === 'gate') return buildSheet(gateSpec(), materials);
  if (id === 'locked') return buildSheet(lockedSpec(), materials);
  if (id === 'pagu') return buildSheet(paguSpec(), materials);
  if (id === 'jeff') return buildSheet(jeffSpec(), materials);
  return buildSheet(trifoldSpec(), materials);
}

// The fold flattened for a top-down diagram: each piece of the sheet with its
// placement and stack height after every phase (index 0 is the open sheet).
export function foldPlan(id) {
  const spec = { gate: gateSpec, locked: lockedSpec, pagu: paguSpec, jeff: jeffSpec }[id]?.() ?? trifoldSpec();
  const { lines, pieces } = foldPieces(spec);
  const steps = spec.phases.map((phase) => lines[phase.fold]);
  return {
    w: spec.w,
    h: spec.h,
    phases: spec.phases.map((phase, k) => ({ weight: phase.weight, line: steps[k], spin: phase.spin ?? 0, lift: Boolean(phase.lift) })),
    pieces: pieces.map((piece) => {
      const maps = [[1, 0, 0, 1, 0, 0]];
      piece.moves.forEach((moving, k) => {
        maps.push(moving && !spec.phases[k].lift ? composeMap(reflectMap(steps[k]), maps[k]) : maps[k]);
      });
      return { poly: piece.poly, moves: piece.moves, maps, z: piece.z };
    }),
  };
}

// Every fold is a list of phases over crease lines, in world units with the
// sheet's bottom-left corner at the origin and y up. A line's normal points at
// the side that turns over; every fold takes all layers on that side, unless
// it names an earlier phase as `only`.
const r = Math.SQRT1_2;

function trifoldSpec() {
  const { w, h } = sheetSize('trifold');
  return {
    w,
    h,
    lines: {
      bottom: { p: [0, h / 3], d: [1, 0], n: [0, -1] },
      top: { p: [0, (2 * h) / 3], d: [1, 0], n: [0, 1] },
    },
    phases: [{ fold: 'bottom', weight: 1 }, { fold: 'top', weight: 1 }],
  };
}

// Closed gatefold (UH0115). Both side edges fold to the center like two gate
// doors, stopping short of it by the gap so neither crosses the middle crease,
// then the sheet folds in half there and all four panels stack.
const GATE_GAP = 0.006;

function gateSpec() {
  const { w, h } = sheetSize('gate');
  const gap = GATE_GAP * w;
  return {
    w,
    h,
    lines: {
      left: { p: [w / 4 - gap / 2, 0], d: [0, 1], n: [-1, 0] },
      right: { p: [(3 * w) / 4 + gap / 2, 0], d: [0, 1], n: [1, 0] },
      middle: { p: [w / 2, 0], d: [0, 1], n: [1, 0] },
    },
    phases: [
      { fold: 'left', weight: 1 },
      { fold: 'right', weight: 1 },
      { fold: 'middle', weight: 1.2 },
    ],
  };
}

function lockedSpec() {
  const { w } = sheetSize('locked');
  const half = w / 2;
  return {
    w,
    h: w,
    lines: {
      tl: { p: [0, half], d: [r, r], n: [-r, r] },
      tr: { p: [half, w], d: [r, -r], n: [r, r] },
      br: { p: [w, half], d: [-r, -r], n: [r, -r] },
      bl: { p: [half, 0], d: [-r, r], n: [-r, -r] },
    },
    phases: ['tl', 'tr', 'br', 'bl'].map((fold) => ({ fold, weight: 1 })),
  };
}

// Pagu hexagon (UH6104). Crease positions are measured off a refolded sheet,
// as fractions of its side, as is the slot left between the two flaps.
const PAGU = { hem: 0.85, corner: 0.53, right: 1.36, bottom: 0.175, slot: 0.008 };

function paguSpec() {
  const S = sheetSize('pagu').w;
  const { hem, corner, right, bottom, slot } = PAGU;
  const top = (corner + hem) / 2;
  const middle = top - bottom;
  // The top-left flap's crease sits back by the slot, so its edge stops that
  // far short of the middle; the other flap's edge meets the top band's corner.
  const lean = slot;
  const line = (p, d, n) => ({ p: [p[0] * S, p[1] * S], d, n });
  return {
    w: S,
    h: S,
    lines: {
      hem: line([0, hem], [1, 0], [0, 1]),
      corner: line([0, corner], [r, -r], [-r, -r]),
      right: line([1, right - 1], [r, -r], [r, r]),
      bottom: line([0, bottom], [1, 0], [0, -1]),
      top: line([0, top], [1, 0], [0, 1]),
      tl: line([0, bottom + lean], [r, r], [-r, r]),
      br: line([middle, bottom], [r, r], [r, -r]),
    },
    phases: [
      { fold: 'hem', weight: 1 },
      { fold: 'corner', weight: 1 },
      { fold: 'right', weight: 1 },
      { fold: 'bottom', weight: 1 },
      { fold: 'top', weight: 1 },
      // Each flap's tip, the part landing past a band's edge, slides under that
      // band. The top-left flap's tip goes in through the bottom band's slanted
      // end, left there by the corner fold, square to its own crease.
      {
        fold: 'tl',
        weight: 1.3,
        tuck: 'bottom',
        tip: line([corner - 2 * bottom, 0], [r, r], [r, -r]),
      },
      // Splitting at the middle lets the bottom band sit over the corner on one
      // side and under the flap on the other. Right of the middle the top band's
      // open edge runs at 45 degrees, parallel to the crease.
      {
        fold: 'br',
        weight: 1.4,
        tuck: 'top',
        cut: line([middle, 0], [0, 1], [1, 0]),
        tip: line([middle, corner], [r, r], [-r, r]),
      },
    ],
  };
}

// Jefferson pentagon (UH6314 / LUV314), following the step photos s1–s9.
// The landscape sheet (152 × 130) rolls from the bottom into a strip along its
// top edge (s1–s4), and a diagonal bends it into an L: short leg left, long
// leg up (s5). The short leg folds up behind, beside the long one, so the two
// legs stand over a V point (s6). The long leg folds left across the top of
// both (s7) and tucks in behind the short leg's tip (s8): the tip lifts out
// of its way and settles back over it once it is down, while the packet
// turns 45 degrees clockwise, leaving a pentagon point up (s9).
function jeffSpec() {
  const { w, h } = sheetSize('jeff');
  const s = h / 4;
  const y0 = (3 * h) / 4;
  // Where the L bends, measured along the strip: the short leg is the part
  // left of it. At 2s it stands as tall as the packet, covering the square
  // the long leg folds across; the long leg, running up 2s and back across,
  // ends behind it short of the outer edge, so none of it shows.
  const a = 2 * s;
  // The packet ends up a 2s square of creases around (a, y0 + s).
  const offset = [w / 2 - a, h / 2 - (y0 + s)];
  return {
    w,
    h,
    offset,
    lines: {
      roll1: { p: [0, h / 4], d: [1, 0], n: [0, -1] },
      roll2: { p: [0, h / 2], d: [1, 0], n: [0, -1] },
      roll3: { p: [0, y0], d: [1, 0], n: [0, -1] },
      leg: { p: [a, y0], d: [r, r], n: [r, -r] },
      // Mirrors the leg crease about x = a, so the short leg stands up just
      // left of the long one and the two creases meet in the V at (a, y0).
      short: { p: [a, y0], d: [r, -r], n: [-r, -r] },
      // Through the long leg at a height of 2s above the V: the leg above it
      // turns left and runs across the top of the short leg.
      long: { p: [a + s, y0 + s], d: [r, -r], n: [r, r] },
      // Along the top of the V, where the short leg's tip rises past it.
      tip: { p: [0, y0 + s], d: [1, 0], n: [0, 1] },
    },
    phases: [
      { fold: 'roll1', weight: 0.9 },
      { fold: 'roll2', weight: 0.9 },
      { fold: 'roll3', weight: 0.9 },
      { fold: 'leg', weight: 1.25 },
      { fold: 'short', weight: 1.2, behind: true },
      { fold: 'long', weight: 1.8, bend: { radius: 0.2, sag: 0.5 } },
      // Lifted while the long leg comes down, the tip settles back over it.
      // It rises with the long leg's first half, to just past upright before
      // the long leg crosses its crease, leaning over the V clear of every
      // place the long leg sweeps, and settles once the long leg is down. A
      // tight crease keeps it from bulging back over the long leg's side.
      {
        fold: 'tip',
        weight: 2.7,
        only: 'short',
        lift: 0.53 * Math.PI,
        bend: { radius: 0.03, sag: -0.3 },
        overlap: 1,
        spin: -Math.PI / 4,
      },
    ],
  };
}

const LAYER_GAP = 0.005;
const EPS = 1e-6;
// Phones reshape every vertex each frame far slower, so they get a lighter
// mesh: a coarser grid and fewer rows along each edge.
const LIGHT_MESH = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
const CELL = LIGHT_MESH ? 0.032 : 0.025;
const SEAM_BAND = 0.04;
// How steeply paper eased toward a crease drapes past the edge of a layer
// under it (height per unit across the sheet).
const DRAPE = 0.5;
// How far back from a tucked tip its flap slopes down to meet it.
const TUCK_RAMP = 0.4;
// The rolled edge of a pressed fold: how far in from the crease it shades as
// turning, how far (radians) it turns at the crease, and how far through its
// swing (a share of a half turn) a fold starts to press.
const RIM_WIDTH = 0.022;
const RIM_TURN = 1.2;
const RIM_FROM = 0.8;
// How fast (per whole swing) a tip takes on its flap's face.
const TIP_SHADE = 2.5;
// How far into the next phase each phase runs, so the hand never stops.
const OVERLAP = 0.18;
// Crease radius mid-swing and once pressed flat, and how much a moving flap
// trails behind its crease (curvature per unit length at the steepest point).
const BEND_RADIUS = 0.07;
const CREASE_RADIUS = 0.0008;
const SAG = 0.16;
// Length of flap, ending at the tip line, that bows to point a tucking tip at
// its slit, so the flap curves like paper held by its tip instead of kinking.
// The bow fades out toward the crease, which holds the paper straight.
const CURL_SPAN = 0.4;
const CURL_FADE = 0.3;
// Share of a tucking phase spent swinging the tip flat under the band once the
// flap is down, and the part of the swing over which the tip bends to head for the slit.
const SLIDE = 0.2;
const AIM = [0.3, 0.75];
// Where a tip aims once its flap is down: this far past the band's edge, and
// this far below it.
const SLIT_REACH = 0.2;
const SLIT_DEPTH = 0.02;
// How far through a phase that turns the whole packet (its `spin`) the turn
// starts.
const SPIN_FROM = 0.6;
// The share of a lift's swing its flap takes to rise, and again to settle.
const LIFT_RAMP = 0.24;
// Samples of a tip's bend over its flap's swing; how fast the bend may wind up
// against the swing (a share of the flap's own turning); how fast it may let go
// (its deepest bend per whole swing); the share of the swing it eases in over;
// and how widely (as a share of the swing) it is smoothed.
const CURL_SAMPLES = 96;
const CURL_RATE = 0.3;
const CURL_RELEASE = 3;
// The least a tip bends at its deepest, and the least it is still bent as its
// flap lands, so every tip visibly slides in.
const CURL_PEAK = 1;
const CURL_LAND = 0.6;
const CURL_EASE_IN = 0.2;
const CURL_SMOOTHING = 0.1;
// Grid on which a bowing flap is kept above the paper it lands on, how far into
// it the flap may still dip (a few layers, which the flap itself hides), and
// how fast (radians per whole swing) its bend may give way to stay clear.
const CLEAR_CELL = 0.02;
const CLEAR_SLACK = 0.03;
const CLEAR_RATE = 3;

function reflectMap({ p, d }) {
  const a = 2 * d[0] * d[0] - 1;
  const b = 2 * d[0] * d[1];
  const c = 2 * d[1] * d[1] - 1;
  return [a, b, b, c, p[0] - a * p[0] - b * p[1], p[1] - b * p[0] - c * p[1]];
}

function composeMap(A, B) {
  return [
    A[0] * B[0] + A[1] * B[2],
    A[0] * B[1] + A[1] * B[3],
    A[2] * B[0] + A[3] * B[2],
    A[2] * B[1] + A[3] * B[3],
    A[0] * B[4] + A[1] * B[5] + A[4],
    A[2] * B[4] + A[3] * B[5] + A[5],
  ];
}

function applyMap(M, [x, y]) {
  return [M[0] * x + M[1] * y + M[4], M[2] * x + M[3] * y + M[5]];
}

function polyArea(poly) {
  let sum = 0;
  poly.forEach(([x0, y0], i) => {
    const [x1, y1] = poly[(i + 1) % poly.length];
    sum += x0 * y1 - x1 * y0;
  });
  return Math.abs(sum) / 2;
}

function clipPoly(poly, values, sign) {
  const out = [];
  poly.forEach((point, i) => {
    const j = (i + 1) % poly.length;
    const a = values[i] * sign;
    const b = values[j] * sign;
    if (a >= 0) out.push(point);
    if ((a > 0 && b < 0) || (a < 0 && b > 0)) {
      const t = a / (a - b);
      const next = poly[j];
      out.push([point[0] + (next[0] - point[0]) * t, point[1] + (next[1] - point[1]) * t]);
    }
  });
  return out;
}

// The stretch of a convex polygon lying on the zero line of `values`.
function cutSegment(poly, values) {
  const points = [];
  poly.forEach((point, i) => {
    const j = (i + 1) % poly.length;
    const a = values[i];
    const b = values[j];
    if (a === 0) points.push(point);
    if ((a > 0 && b < 0) || (a < 0 && b > 0)) {
      const t = a / (a - b);
      points.push([point[0] + (poly[j][0] - point[0]) * t, point[1] + (poly[j][1] - point[1]) * t]);
    }
  });
  return points.length >= 2 ? [points[0], points[points.length - 1]] : null;
}

function polysOverlap(A, B) {
  for (const poly of [A, B]) {
    for (let i = 0; i < poly.length; i++) {
      const [x0, y0] = poly[i];
      const [x1, y1] = poly[(i + 1) % poly.length];
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (len < EPS) continue;
      const ax = (y0 - y1) / len;
      const ay = (x1 - x0) / len;
      const range = (pts) => pts.reduce(([lo, hi], [x, y]) => {
        const s = x * ax + y * ay;
        return [Math.min(lo, s), Math.max(hi, s)];
      }, [Infinity, -Infinity]);
      const [aLo, aHi] = range(A);
      const [bLo, bHi] = range(B);
      if (aHi - bLo < 1e-4 || bHi - aLo < 1e-4) return false;
    }
  }
  return true;
}

// Whether a point lies inside a convex polygon, at least `margin` from its edges.
function insideBy(poly, [x, y], margin) {
  const turn = poly.reduce((sum, [x0, y0], i) => {
    const [x1, y1] = poly[(i + 1) % poly.length];
    return sum + x0 * y1 - x1 * y0;
  }, 0) > 0 ? 1 : -1;
  return poly.every(([x0, y0], i) => {
    const [x1, y1] = poly[(i + 1) % poly.length];
    const len = Math.hypot(x1 - x0, y1 - y0);
    return len < EPS || (turn * ((x1 - x0) * (y - y0) - (y1 - y0) * (x - x0))) / len > margin;
  });
}

function segmentDistance([px, py], [[ax, ay], [bx, by]]) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len > 0 ? THREE.MathUtils.clamp(((px - ax) * dx + (py - ay) * dy) / len, 0, 1) : 0;
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}

// Whether two polygons share a stretch of boundary.
function touching(a, b) {
  return a.some(([px, py], i) => {
    const [qx, qy] = a[(i + 1) % a.length];
    const len = Math.hypot(qx - px, qy - py);
    if (len < EPS) return false;
    const dx = (qx - px) / len;
    const dy = (qy - py) / len;
    return b.some(([rx, ry], j) => {
      const [sx, sy] = b[(j + 1) % b.length];
      const off = (x, y) => Math.abs((x - px) * dy - (y - py) * dx);
      if (off(rx, ry) > EPS * 10 || off(sx, sy) > EPS * 10) return false;
      const r = (rx - px) * dx + (ry - py) * dy;
      const s = (sx - px) * dx + (sy - py) * dy;
      return Math.min(len, Math.max(r, s)) - Math.max(0, Math.min(r, s)) > EPS * 10;
    });
  });
}

// Splits the sheet along every crease and records, for each piece, which
// phases turn it over and how high it sits in the stack after each phase, plus
// where on the sheet each crease runs.
function foldPieces({ w, h, lines: specLines, phases }) {
  const lines = { ...specLines };
  let pieces = [{ poly: [[0, 0], [w, 0], [w, h], [0, h]], map: [1, 0, 0, 1, 0, 0], moves: [], z: [0] }];
  const creases = phases.map(() => []);
  const folded = (piece) => piece.poly.map((point) => applyMap(piece.map, point));

  // Cuts pieces along a line in folded space. With a flag, pieces on the
  // normal's side get it set; `only` limits which pieces are cut, and cut
  // segments on the sheet are pushed to `record`.
  function split(line, flag, only = () => true, record = null) {
    const next = [];
    pieces.forEach((piece) => {
      if (!only(piece)) {
        next.push(piece);
        return;
      }
      const values = folded(piece).map(([x, y]) => {
        const s = line.n[0] * (x - line.p[0]) + line.n[1] * (y - line.p[1]);
        return Math.abs(s) < EPS ? 0 : s;
      });
      if (values.every((s) => s <= 0)) {
        next.push(piece);
      } else if (values.every((s) => s >= 0)) {
        if (flag) piece[flag] = true;
        next.push(piece);
      } else {
        const segment = cutSegment(piece.poly, values);
        if (record && segment) record.push(segment);
        [1, -1].forEach((sign) => {
          const poly = clipPoly(piece.poly, values, sign);
          if (poly.length < 3 || polyArea(poly) < EPS) return;
          const part = { ...piece, poly, moves: [...piece.moves], z: [...piece.z] };
          if (flag) part[flag] = sign > 0;
          next.push(part);
        });
      }
    });
    pieces = next;
  }

  phases.forEach((phase, k) => {
    if (phase.cut) split(phase.cut, null);
    const id = phase.fold;
    // With `only`, the fold takes just the layers that turned in that phase.
    const ko = phase.only ? phases.findIndex((p) => p.fold === phase.only) : -1;
    split(lines[id], 'moving', ko < 0 ? undefined : (piece) => piece.moves[ko], creases[k]);
    const reflect = reflectMap(lines[id]);
    pieces.forEach((piece) => {
      if (piece.moving && !phase.lift) piece.map = composeMap(reflect, piece.map);
      piece.moves.push(Boolean(piece.moving));
    });
    if (phase.tip) {
      split(phase.tip, `tip_${id}`, (piece) => piece.moving);
      // The curl hinge, where the band's edge line sat before the flap turned over.
      const [x0, y0] = applyMap(reflect, phase.tip.p);
      const [x1, y1] = applyMap(reflect, [phase.tip.p[0] + phase.tip.d[0], phase.tip.p[1] + phase.tip.d[1]]);
      const n = [reflect[0] * phase.tip.n[0] + reflect[1] * phase.tip.n[1], reflect[2] * phase.tip.n[0] + reflect[3] * phase.tip.n[1]];
      lines[`curl_${id}`] = { p: [x0, y0], d: [x1 - x0, y1 - y0], n };
    }
    if (phase.tuck) {
      // Only the part of a tip that lands under the pocket's layers goes under
      // them, so tips are split along those layers' outlines.
      const kt = phases.findIndex((p) => p.fold === phase.tuck);
      const flag = `tip_${id}`;
      const bands = pieces.filter((piece) => !piece.moving && piece.moves[kt]).map(folded);
      bands.forEach((shape) => {
        const turn = shape.reduce((sum, [x0, y0], i) => {
          const [x1, y1] = shape[(i + 1) % shape.length];
          return sum + x0 * y1 - x1 * y0;
        }, 0) > 0 ? 1 : -1;
        shape.forEach((a, i) => {
          const b = shape[(i + 1) % shape.length];
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (len < EPS) return;
          const n = [((b[1] - a[1]) / len) * turn, ((a[0] - b[0]) / len) * turn];
          split({ p: a, n }, null, (piece) => piece[flag] && polysOverlap(folded(piece), shape));
        });
      });
      // The phase a tip goes under in.
      pieces.forEach((piece) => {
        if (piece[flag] && bands.some((shape) => polysOverlap(folded(piece), shape))) piece.tucked = k;
      });
    }

    // Stack order: moving layers flip over and land on top, except where a
    // tucked flap slides under the pocket, or a `behind` fold swings under.
    const shapes = pieces.map(folded);
    const below = pieces.map(() => []);
    pieces.forEach((a, i) => {
      pieces.forEach((b, j) => {
        if (j <= i || !polysOverlap(shapes[i], shapes[j])) return;
        let aOnTop;
        // A fold turns its layers over; a lift keeps them in order.
        if (a.moving && b.moving) aOnTop = phase.lift ? a.z[k] > b.z[k] : a.z[k] < b.z[k];
        else if (a.moving || b.moving) {
          const mover = a.moving ? a : b;
          const other = a.moving ? b : a;
          const pocket = phase.tuck && other.moves[phases.findIndex((p) => p.fold === phase.tuck)];
          aOnTop = (mover === a) !== (Boolean(pocket) || Boolean(phase.behind));
        } else aOnTop = a.z[k] > b.z[k];
        if (aOnTop) below[i].push(j);
        else below[j].push(i);
      });
    });
    const level = pieces.map(() => null);
    const visiting = new Set();
    const depth = (i) => {
      if (level[i] !== null) return level[i];
      if (visiting.has(i)) throw new Error(`Fold layers loop at phase ${k}`);
      visiting.add(i);
      level[i] = below[i].reduce((max, j) => Math.max(max, depth(j) + 1), 0);
      visiting.delete(i);
      return level[i];
    };
    const z = pieces.map((_, i) => depth(i) * LAYER_GAP);

    // Pieces of one flat stretch of paper, split only by tip or pocket lines,
    // rise level with each other wherever nothing above holds them down, so
    // the stretch doesn't step where nothing in the paper changes. A tucking
    // tip stays down with the pocket it heads into, even where it lands past
    // the band's end, so the band's edge lies over it rather than under.
    const above = pieces.map(() => []);
    below.forEach((list, i) => list.forEach((j) => above[j].push(i)));
    const tips = phases.slice(0, k + 1).filter((p) => p.tuck).map((p) => `tip_${p.fold}`);
    const flush = pieces.map((a) => pieces.map((b) => a !== b
      && a.moves.every((m, q) => m === b.moves[q])
      && tips.every((flag) => Boolean(a[flag]) === Boolean(b[flag]))
      && touching(a.poly, b.poly)));
    for (let changed = true; changed; ) {
      changed = false;
      pieces.forEach((_, i) => {
        const target = z.reduce((top, zj, j) => (flush[i][j] ? Math.max(top, zj) : top), z[i]);
        const cap = above[i].reduce((low, j) => Math.min(low, z[j] - LAYER_GAP), Infinity);
        const next = Math.min(target, cap);
        if (next > z[i] + EPS) {
          z[i] = next;
          changed = true;
        }
      });
    }
    pieces.forEach((piece, i) => {
      piece.z.push(z[i]);
      delete piece.moving;
    });
  });

  return { lines, pieces, creases };
}

// A grid clipped to each piece, so creases run exactly along triangle edges.
// Pieces keep their own vertices (crisp shading at creases) but vertices at
// the same spot on the sheet always land in the same place. Rows of vertices
// run along the inside of every edge, so the roll of a tightening crease is
// built from strips along it rather than from cells cut across it at random,
// which would show as a saw-tooth along the folded edge.
const EDGE_ROWS = LIGHT_MESH ? [0.002, 0.007, 0.017, 0.032, 0.05] : [0.002, 0.005, 0.01, 0.017, 0.026, 0.037, 0.05];

function meshPieces(pieces) {
  const positions = [];
  const indices = [];
  const owner = [];
  const spots = new Map();
  const spotOf = [];
  const corners = pieces.flatMap(({ poly }) => poly);
  const sheet = [Math.min(...corners.map(([x]) => x)), Math.max(...corners.map(([x]) => x))];
  const sheetY = [Math.min(...corners.map(([, y]) => y)), Math.max(...corners.map(([, y]) => y))];
  // The sheet's own edges never roll round a crease.
  const onBorder = ([x0, y0], [x1, y1]) => [sheet, sheetY].some((range, axis) => range.some((at) => (
    Math.abs((axis ? y0 : x0) - at) < EPS && Math.abs((axis ? y1 : x1) - at) < EPS
  )));
  pieces.forEach((piece, pi) => {
    const local = new Map();
    const vertex = ([x, y]) => {
      const key = `${Math.round(x * 1e5)},${Math.round(y * 1e5)}`;
      if (local.has(key)) return local.get(key);
      const id = owner.length;
      positions.push(x, y);
      owner.push(pi);
      if (!spots.has(key)) spots.set(key, spots.size);
      spotOf.push(spots.get(key));
      local.set(key, id);
      return id;
    };
    const turn = Math.sign(piece.poly.reduce((sum, [x0, y0], i) => {
      const [x1, y1] = piece.poly[(i + 1) % piece.poly.length];
      return sum + x0 * y1 - x1 * y0;
    }, 0));
    const rows = piece.poly.flatMap(([x0, y0], i) => {
      const [x1, y1] = piece.poly[(i + 1) % piece.poly.length];
      if (onBorder([x0, y0], [x1, y1])) return [];
      const len = Math.hypot(x1 - x0, y1 - y0);
      const nx = (-(y1 - y0) / len) * turn;
      const ny = ((x1 - x0) / len) * turn;
      return EDGE_ROWS.map((inset) => [nx, ny, -(nx * x0 + ny * y0) - inset]);
    });
    const xs = piece.poly.map(([x]) => x);
    const ys = piece.poly.map(([, y]) => y);
    const i0 = Math.floor(Math.min(...xs) / CELL - EPS);
    const i1 = Math.ceil(Math.max(...xs) / CELL + EPS);
    const j0 = Math.floor(Math.min(...ys) / CELL - EPS);
    const j1 = Math.ceil(Math.max(...ys) / CELL + EPS);
    for (let i = i0; i < i1; i++) {
      for (let j = j0; j < j1; j++) {
        let poly = piece.poly;
        [[1, 0, -i * CELL], [-1, 0, (i + 1) * CELL], [0, 1, -j * CELL], [0, -1, (j + 1) * CELL]].forEach(([a, b, c]) => {
          if (poly.length < 3) return;
          poly = clipPoly(poly, poly.map(([x, y]) => {
            const s = a * x + b * y + c;
            return Math.abs(s) < EPS ? 0 : s;
          }), 1);
        });
        if (poly.length < 3 || polyArea(poly) < 1e-9) continue;
        let parts = [poly];
        rows.forEach(([a, b, c]) => {
          parts = parts.flatMap((part) => {
            const values = part.map(([x, y]) => {
              const s = a * x + b * y + c;
              return Math.abs(s) < EPS ? 0 : s;
            });
            if (values.every((s) => s >= 0) || values.every((s) => s <= 0)) return [part];
            return [clipPoly(part, values, 1), clipPoly(part, values, -1)];
          });
        });
        parts.forEach((part) => {
          if (part.length < 3 || polyArea(part) < 1e-10) return;
          const ids = part.map(vertex);
          for (let t = 1; t < ids.length - 1; t++) {
            if (ids[0] !== ids[t] && ids[t] !== ids[t + 1] && ids[0] !== ids[t + 1]) indices.push(ids[0], ids[t], ids[t + 1]);
          }
        });
      }
    }
  });
  return { positions, indices, owner, spotOf, spotCount: spots.size };
}

function buildSheet(spec, materials) {
  const { w, h, phases } = spec;
  const { lines, pieces, creases } = foldPieces(spec);
  const { positions: rest, indices, owner, spotOf, spotCount } = meshPieces(pieces);
  const count = owner.length;
  const P = phases.length;

  const hinges = {};
  Object.entries(lines).forEach(([id, { p, d, n }]) => {
    const dl = Math.hypot(d[0], d[1]);
    const nl = Math.hypot(n[0], n[1]);
    hinges[id] = { px: p[0], py: p[1], ax: d[0] / dl, ay: d[1] / dl, nx: n[0] / nl, ny: n[1] / nl };
  });

  // Layer heights. Where pieces meet, each eases over a fixed band to the
  // average of the pieces at the seam, so seams close without stair-stepping
  // and the layers of a folded edge nest instead of crossing. Tucked tips lie
  // flat under their band once tucked, so seams they share meet them at their
  // height from then on; before that they ease like any other paper.
  const tuckedAt = (piece, k) => piece.tucked !== undefined && k > piece.tucked;
  const pinnedFrom = new Float32Array(spotCount).fill(Infinity);
  for (let v = 0; v < count; v++) {
    const { tucked } = pieces[owner[v]];
    if (tucked !== undefined) pinnedFrom[spotOf[v]] = Math.min(pinnedFrom[spotOf[v]], tucked + 1);
  }
  const pinned = (spot, k) => k >= pinnedFrom[spot];
  const seamZ = new Float32Array(spotCount * (P + 1));
  const hits = new Uint16Array(spotCount * (P + 1));
  const shared = new Uint16Array(spotCount);
  for (let v = 0; v < count; v++) {
    const spot = spotOf[v];
    const piece = pieces[owner[v]];
    shared[spot]++;
    piece.z.forEach((z, k) => {
      if (pinned(spot, k) && !tuckedAt(piece, k)) return;
      hits[spot * (P + 1) + k]++;
      seamZ[spot * (P + 1) + k] += z;
    });
  }
  for (let i = 0; i < seamZ.length; i++) seamZ[i] /= hits[i] || 1;
  const zs = new Float32Array(count * (P + 1));
  const seams = pieces.map(() => []);
  for (let v = 0; v < count; v++) {
    if (shared[spotOf[v]] > 1) seams[owner[v]].push(v);
  }
  // Where the paper slips under a band's edge, it keeps its own height;
  // easing it down would dent it along the slit.
  for (let v = 0; v < count; v++) {
    const piece = pieces[owner[v]];
    const point = [rest[v * 2], rest[v * 2 + 1]];
    // The nearest seam, and the nearest that no tucked tip pins.
    let best = null;
    let free = null;
    piece.poly.forEach((a, i) => {
      const edge = [a, piece.poly[(i + 1) % piece.poly.length]];
      const d = segmentDistance(point, edge);
      if (d >= SEAM_BAND || (best && free && d >= best.d && d >= free.d)) return;
      const [[ax, ay], [bx, by]] = edge;
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const t = THREE.MathUtils.clamp(((point[0] - ax) * (bx - ax) + (point[1] - ay) * (by - ay)) / (len * len), 0, 1);
      const foot = [ax + (bx - ax) * t, ay + (by - ay) * t];
      let spot = -1;
      let gap = CELL * 0.75;
      seams[owner[v]].forEach((u) => {
        const g = Math.hypot(rest[u * 2] - foot[0], rest[u * 2 + 1] - foot[1]);
        if (g < gap && segmentDistance([rest[u * 2], rest[u * 2 + 1]], edge) < EPS * 10) {
          gap = g;
          spot = spotOf[u];
        }
      });
      if (spot < 0) return;
      if (!best || d < best.d) best = { d, spot };
      if (pinnedFrom[spot] === Infinity && (!free || d < free.d)) free = { d, spot };
    });
    piece.z.forEach((z, k) => {
      const seam = best && pinned(best.spot, k) ? free : best;
      const weight = seam && !tuckedAt(piece, k) ? 1 - seam.d / SEAM_BAND : 0;
      zs[v * (P + 1) + k] = z + ((seam ? seamZ[seam.spot * (P + 1) + k] : z) - z) * weight;
    });
  }
  // Once a tip is tucked, the rest of its flap slopes down to the tip's height
  // over the stretch before the band's edge, so the edge lies over the flap
  // rather than the flap riding over the edge. It never sinks into the paper
  // under it.
  const maps = pieces.map((piece) => phases.reduce((list, { fold, lift }, k) => {
    list.push(piece.moves[k] && !lift ? composeMap(reflectMap(lines[fold]), list[k]) : list[k]);
    return list;
  }, [[1, 0, 0, 1, 0, 0]]));
  const members = pieces.map(() => []);
  for (let v = 0; v < count; v++) members[owner[v]].push(v);
  // Easing toward a crease can sink paper below another layer's folded edge
  // tucked inside the fold, and that edge would show through. Eased paper
  // stays a layer above whatever lies under it, draping down past its edge,
  // though never above its own height, except over the pieces it meets,
  // which it eases to. Whole spots rise together so seams hold.
  const eased = new Uint8Array(count);
  for (let v = 0; v < count; v++) {
    const { poly } = pieces[owner[v]];
    const point = [rest[v * 2], rest[v * 2 + 1]];
    eased[v] = poly.some((a, i) => segmentDistance(point, [a, poly[(i + 1) % poly.length]]) < SEAM_BAND) ? 1 : 0;
  }
  const neighbours = pieces.map(() => new Set());
  const bySpot = new Map();
  for (let v = 0; v < count; v++) (bySpot.get(spotOf[v]) || bySpot.set(spotOf[v], []).get(spotOf[v])).push(v);
  bySpot.forEach((list) => list.forEach((a) => list.forEach((b) => {
    if (owner[a] !== owner[b]) neighbours[owner[a]].add(owner[b]);
  })));
  const reachOver = CELL;
  for (let k = 1; k <= P; k++) {
    const where = new Float32Array(count * 2);
    const grid = new Map();
    const cellOf = (gx, gy) => gx * 65536 + gy;
    for (let v = 0; v < count; v++) {
      const [x, y] = applyMap(maps[owner[v]][k], [rest[v * 2], rest[v * 2 + 1]]);
      where[v * 2] = x;
      where[v * 2 + 1] = y;
      const key = cellOf(Math.floor(x / reachOver), Math.floor(y / reachOver));
      (grid.get(key) || grid.set(key, []).get(key)).push(v);
    }
    // How far a point lies past a piece's edge, as folded: the drape runs
    // from the edge itself, not from the piece's vertices, which a layer's
    // edge passes over at uneven distances and would rise and fall between.
    const shapes = pieces.map((piece, j) => piece.poly.map((point) => applyMap(maps[j][k], point)));
    const pastEdge = (j, point) => (insideBy(shapes[j], point, -EPS)
      ? 0
      : Math.min(...shapes[j].map((a, n) => segmentDistance(point, [a, shapes[j][(n + 1) % shapes[j].length]]))));
    const order = pieces.map((_, i) => i).sort((a, b) => pieces[a].z[k] - pieces[b].z[k]);
    order.forEach((i) => {
      if (tuckedAt(pieces[i], k) || pieces[i].tucked === k - 1) return;
      const lift = new Map();
      const under = pieces.map((piece, j) => j !== i && !neighbours[i].has(j) && piece.z[k] < pieces[i].z[k] - EPS);
      const tops = new Map();
      const top = (u) => {
        const spot = spotOf[u];
        let high = tops.get(spot);
        if (high === undefined) {
          high = bySpot.get(spot).reduce((most, w) => Math.max(most, zs[w * (P + 1) + k]), -Infinity);
          tops.set(spot, high);
        }
        return high;
      };
      members[i].forEach((v) => {
        if (!eased[v]) return;
        const x = where[v * 2];
        const y = where[v * 2 + 1];
        const cx = Math.floor(x / reachOver);
        const cy = Math.floor(y / reachOver);
        let need = -Infinity;
        const gaps = new Map();
        for (let gx = cx - 1; gx <= cx + 1; gx++) {
          for (let gy = cy - 1; gy <= cy + 1; gy++) {
            const list = grid.get(cellOf(gx, gy));
            if (!list) continue;
            for (const u of list) {
              const j = owner[u];
              if (!under[j] || Math.hypot(where[u * 2] - x, where[u * 2 + 1] - y) >= reachOver) continue;
              if (!gaps.has(j)) gaps.set(j, pastEdge(j, [x, y]));
              need = Math.max(need, top(u) + LAYER_GAP - gaps.get(j) * DRAPE);
            }
          }
        }
        need = Math.min(need, pieces[i].z[k]);
        if (need > zs[v * (P + 1) + k] + EPS) {
          const spot = spotOf[v];
          lift.set(spot, Math.max(lift.get(spot) ?? -Infinity, need));
        }
      });
      lift.forEach((need, spot) => bySpot.get(spot).forEach((w) => {
        zs[w * (P + 1) + k] = Math.max(zs[w * (P + 1) + k], need);
      }));
    });
  }
  phases.forEach(({ tuck }, kt) => {
    if (!tuck) return;
    const tipAt = new Map();
    for (let v = 0; v < count; v++) {
      if (pieces[owner[v]].tucked === kt) tipAt.set(spotOf[v], v);
    }
    // The whole flap slopes from the tip's edge, not just the pieces on it, so
    // pieces of the flap that meet each other stay level where they meet.
    const flap = pieces.map((piece) => piece.moves[kt] && piece.tucked === undefined);
    const edge = [];
    for (let v = 0; v < count; v++) {
      if (flap[owner[v]] && tipAt.has(spotOf[v])) edge.push(v);
    }
    for (let k = kt + 1; k <= P; k++) {
      const shapes = pieces.map((piece, i) => piece.poly.map((point) => applyMap(maps[i][k], point)));
      const folded = (v) => applyMap(maps[owner[v]][k], [rest[v * 2], rest[v * 2 + 1]]);
      const where = new Float32Array(count * 2);
      const cells = pieces.map(() => new Map());
      for (let v = 0; v < count; v++) {
        const [x, y] = folded(v);
        where[v * 2] = x;
        where[v * 2 + 1] = y;
        const key = `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
        const cell = cells[owner[v]];
        (cell.get(key) || cell.set(key, []).get(key)).push(v);
      }
      // The vertex of piece `j` nearest `spot`, searching rings of cells out
      // until no nearer one can be left.
      const closestIn = (j, spot) => {
        const cx = Math.floor(spot[0] / CELL);
        const cy = Math.floor(spot[1] / CELL);
        let best = null;
        for (let ring = 0; ring * CELL < (best ? best.d + CELL : Infinity) && ring < 4 / CELL; ring++) {
          for (let gx = cx - ring; gx <= cx + ring; gx++) {
            for (let gy = cy - ring; gy <= cy + ring; gy++) {
              if (Math.max(Math.abs(gx - cx), Math.abs(gy - cy)) !== ring) continue;
              (cells[j].get(`${gx},${gy}`) || []).forEach((u) => {
                const d = Math.hypot(where[u * 2] - spot[0], where[u * 2 + 1] - spot[1]);
                if (!best || d < best.d) best = { d, u };
              });
            }
          }
        }
        return best;
      };
      const order = pieces.map((_, i) => i).filter((i) => flap[i]).sort((a, b) => pieces[a].z[k] - pieces[b].z[k]);
      order.forEach((i) => {
        const under = pieces.map((_, j) => j).filter((j) => j !== i && pieces[j].z[k] < pieces[i].z[k] - EPS);
        members[i].forEach((v) => {
          const point = [rest[v * 2], rest[v * 2 + 1]];
          let near = null;
          edge.forEach((u) => {
            const d = Math.hypot(rest[u * 2] - point[0], rest[u * 2 + 1] - point[1]);
            if (d < TUCK_RAMP && (!near || d < near.d)) near = { d, u };
          });
          if (!near) return;
          const at = v * (P + 1) + k;
          const target = zs[tipAt.get(spotOf[near.u]) * (P + 1) + k];
          let z = zs[at] + (target - zs[at]) * smooth(1 - near.d / TUCK_RAMP);
          const spot = [where[v * 2], where[v * 2 + 1]];
          under.forEach((j) => {
            if (!insideBy(shapes[j], spot, CELL * 0.2)) return;
            const closest = closestIn(j, spot);
            z = Math.max(z, zs[closest.u * (P + 1) + k] + LAYER_GAP);
          });
          zs[at] = Math.min(zs[at], z);
        });
      });
    }
  });
  // Vertices close enough to a crease, along the sheet, to wrap around it.
  // A phase's `bend` can soften its fold: a wider crease mid-swing and a flap
  // that trails further behind it, or curls on ahead with a negative sag.
  const bendRadius = phases.map((phase) => phase.bend?.radius ?? BEND_RADIUS);
  const bendSag = phases.map((phase) => phase.bend?.sag ?? SAG);
  const reach = bendRadius.map((radius) => radius * Math.PI + CELL);
  const nearCrease = new Uint8Array(count * P);
  for (let v = 0; v < count; v++) {
    const point = [rest[v * 2], rest[v * 2 + 1]];
    for (let k = 0; k < P; k++) {
      if (creases[k].some((seg) => segmentDistance(point, seg) < reach[k])) nearCrease[v * P + k] = 1;
    }
  }
  // Paper pressed flat still turns over its folded edges in a tight roll. Each
  // vertex near a crease records how far it is from it and which way the edge
  // lies (from a vertex of its piece well inside to one on the crease), and
  // the material turns the surface toward the edge over the last stretch.
  // Distance to a straight crease interpolates exactly, so the roll stays even
  // however the grid meets it.
  const leans = [];
  const leanOf = new Int32Array(count).fill(-1);
  const rimDist = new Float32Array(count).fill(Infinity);
  const span = RIM_WIDTH + CELL * 1.5;
  for (let k = 0; k < P; k++) {
    pieces.forEach((piece, i) => {
      const band = members[i]
        .map((v) => ({ v, d: Math.min(...creases[k].map((seg) => segmentDistance([rest[v * 2], rest[v * 2 + 1]], seg)), Infinity) }))
        .filter(({ d }) => d < span);
      const edge = band.filter(({ d }) => d < EPS * 10);
      const inner = band.reduce((far, entry) => (entry.d > far.d ? entry : far), { d: 0 });
      if (!edge.length || inner.d < CELL * 0.5) return;
      const nearest = edge.reduce((best, entry) => {
        const g = Math.hypot(rest[entry.v * 2] - rest[inner.v * 2], rest[entry.v * 2 + 1] - rest[inner.v * 2 + 1]);
        return g < best.g ? { v: entry.v, g } : best;
      }, { v: -1, g: Infinity });
      const lean = leans.length;
      leans.push({ k, from: inner.v, to: nearest.v });
      band.forEach(({ v, d }) => {
        if (d >= rimDist[v]) return;
        rimDist[v] = d;
        leanOf[v] = lean;
      });
    });
  }

  const bows = {};
  phases.forEach(({ fold, tip }) => {
    if (!tip) return;
    const h = hinges[`curl_${fold}`];
    bows[fold] = { ...h, px: h.px - h.nx * CURL_SPAN, py: h.py - h.ny * CURL_SPAN };
  });

  const geometry = new THREE.BufferGeometry();
  const positionAttr = new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3);
  geometry.setAttribute('position', positionAttr);
  const normalAttr = new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3);
  geometry.setAttribute('normal', normalAttr);
  const uv = new Float32Array(count * 2);
  for (let v = 0; v < count; v++) {
    uv[v * 2] = rest[v * 2] / w;
    uv[v * 2 + 1] = rest[v * 2 + 1] / h;
  }
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const rimAttr = new THREE.Float32BufferAttribute(new Float32Array(count * 4), 4);
  for (let v = 0; v < count; v++) rimAttr.array[v * 4 + 3] = Math.min(rimDist[v], 1);
  geometry.setAttribute('rim', rimAttr);
  const shadeAttr = new THREE.Float32BufferAttribute(new Float32Array(count), 1);
  geometry.setAttribute('shade', shadeAttr);
  // How much of a tucking flap's bend each vertex takes, fading in from the
  // crease as the bend does, so its face changes with it.
  const tipPhase = new Int8Array(count).fill(-1);
  const tipReach = new Float32Array(count);
  phases.forEach(({ fold, tip }, k) => {
    if (!tip) return;
    const h = hinges[fold];
    for (let v = 0; v < count; v++) {
      if (!pieces[owner[v]].moves[k]) continue;
      const [x, y] = applyMap(maps[owner[v]][k], [rest[v * 2], rest[v * 2 + 1]]);
      tipPhase[v] = k;
      tipReach[v] = smooth(THREE.MathUtils.clamp(((x - h.px) * h.nx + (y - h.py) * h.ny) / CURL_FADE, 0, 1));
    }
  });
  geometry.setIndex(indices);

  // The packet turns about its centre, which `offset` brings to the origin
  // over the fold; the open sheet stays centred like every other fold's.
  const root = new THREE.Group();
  const sheet = new THREE.Group();
  sheet.add(new THREE.Mesh(geometry, materials.front), new THREE.Mesh(geometry, materials.back));
  root.add(sheet);

  // A phase's `overlap` sets how far into the one before it it starts.
  let start = 0;
  const spans = phases.map(({ weight }, k) => {
    const span = [start, start + weight];
    start += weight * (1 - (phases[k + 1]?.overlap ?? OVERLAP));
    return span;
  });
  const total = Math.max(...spans.map(([, end]) => end));

  const point = new THREE.Vector3();
  const probe = new THREE.Vector3();
  const along = new THREE.Vector3();
  const across = new THREE.Vector3();
  const target = new THREE.Vector3();
  const facing = new THREE.Vector3();
  const bends = phases.map(() => ({ angle: 0, radius: 0, sag: 0, curl: 0 }));
  const layering = new Float32Array(P);
  // Wraps the part of the sheet past a crease around a cylinder of `radius`
  // that rolls up to `angle`, then runs on as a flap curving back by `sag`
  // (or, if negative, curling on further, like paper lifted by its edge).
  // `wrap` is false for layers that only lie near the crease after earlier
  // folds; they turn with the flap instead of wrapping. Turns `normal` with
  // the paper if given, and returns how far the point turned.
  function bend(out, hinge, angle, radius, sag, wrap, normal) {
    if (angle === 0) return 0;
    const sign = angle < 0 ? -1 : 1;
    const turn = Math.abs(angle);
    const dx = out.x - hinge.px;
    const dy = out.y - hinge.py;
    const s = dx * hinge.nx + dy * hinge.ny;
    if (wrap && s <= 0) return 0;
    const t = dx * hinge.ax + dy * hinge.ay;
    const lift = out.z * sign;
    const arc = radius * turn;
    let X;
    let Z;
    let turned = turn;
    if (wrap && s < arc) {
      // A layer raised above a tight crease would swing in over the paper
      // beside it if it followed the circle; it keeps to the crease's side and
      // still meets the flap where the arc ends.
      turned = s / radius;
      X = radius * Math.sin(turned) - lift * Math.sin(turn) * (turned / turn);
      Z = radius - (radius - lift) * Math.cos(turned);
    } else {
      const u = s - arc;
      const endX = radius * Math.sin(turn);
      const endZ = radius * (1 - Math.cos(turn));
      if (Math.abs(sag) > 1e-6) {
        turned = turn - sag * u;
        X = endX + (Math.sin(turn) - Math.sin(turned)) / sag - lift * Math.sin(turned);
        Z = endZ + (Math.cos(turned) - Math.cos(turn)) / sag + lift * Math.cos(turned);
      } else {
        X = endX + u * Math.cos(turn) - lift * Math.sin(turn);
        Z = endZ + u * Math.sin(turn) + lift * Math.cos(turn);
      }
    }
    out.set(hinge.px + t * hinge.ax + X * hinge.nx, hinge.py + t * hinge.ay + X * hinge.ny, Z * sign);
    if (normal) {
      const ns = normal.x * hinge.nx + normal.y * hinge.ny;
      const na = normal.x * hinge.ax + normal.y * hinge.ay;
      const nz = normal.z * sign;
      const cos = Math.cos(turned);
      const sin = Math.sin(turned);
      const s2 = ns * cos - nz * sin;
      normal.set(s2 * hinge.nx + na * hinge.ax, s2 * hinge.ny + na * hinge.ay, (ns * sin + nz * cos) * sign);
    }
    return turned;
  }

  // Turn about the curl hinge that points the tip from the curl line into the
  // slit, so it enters under the band's edge instead of cutting through the
  // band. It aims at the edge while the flap is up, then further past it and
  // just below the band as the flap comes down: aiming at the edge itself
  // flips direction as the hinge lands on it.
  function slitAngle(k) {
    const id = phases[k].fold;
    const hinge = hinges[id];
    const curl = hinges[`curl_${id}`];
    const { angle, radius, sag } = bends[k];
    const at = (x, y, out) => bend(out.set(x, y, 0), hinge, angle, radius, sag, false);
    at(curl.px, curl.py, point);
    at(curl.px + curl.ny * 1e-3, curl.py - curl.nx * 1e-3, probe);
    along.subVectors(probe, point).normalize();
    at(curl.px + curl.nx * 1e-3, curl.py + curl.ny * 1e-3, probe);
    across.subVectors(probe, point).normalize();
    const tip = phases[k].tip;
    const reach = (SLIT_REACH * (1 - Math.sin(angle))) / Math.hypot(tip.n[0], tip.n[1]);
    target.set(tip.p[0] + tip.n[0] * reach - point.x, tip.p[1] + tip.n[1] * reach - point.y, -SLIT_DEPTH - point.z);
    target.addScaledVector(along, -target.dot(along));
    if (target.lengthSq() < 1e-10) target.set(0, 0, -1);
    target.normalize();
    const sin = along.dot(probe.crossVectors(across, target));
    return Math.atan2(sin, across.dot(target));
  }

  // With `stacked`, each fold also raises the paper to its new layer height
  // just after it turns it, so later folds carry the layers round with the
  // paper instead of lifting them straight up off a curled flap. A fold turns
  // its flap's earlier height over with it, so its rise makes up for that.
  // With a `memo`, the vertex picks up from the state saved before phase
  // `memo.from` instead of the flat sheet, and saves its state before phase
  // `memo.at` for the next call.
  const phaseHinge = phases.map((phase) => hinges[phase.fold]);
  const phaseBow = phases.map((phase) => bows[phase.fold]);
  function place(v, out, stacked = false, normal = null, memo = null) {
    const piece = pieces[owner[v]];
    const row = v * (P + 1);
    let height = stacked ? zs[row] : 0;
    let from = 0;
    if (memo && memo.from > 0) {
      from = memo.from;
      out.fromArray(memo.pos, v * 3);
      normal?.fromArray(memo.nor, v * 3);
      height = memo.height[v];
    } else {
      out.set(rest[v * 2], rest[v * 2 + 1], height);
      normal?.set(0, 0, 1);
    }
    for (let k = from; k <= P; k++) {
      if (memo && k === memo.at) {
        out.toArray(memo.pos, v * 3);
        normal?.toArray(memo.nor, v * 3);
        memo.height[v] = height;
      }
      if (k === P) break;
      const b = bends[k];
      // A lift ends flat again, but still holds its flap at its new height.
      if (b.angle === 0 && (!stacked || layering[k] === 0)) continue;
      const moves = piece.moves[k];
      if (b.curl !== 0 && moves) {
        const h = phaseHinge[k];
        const fromCrease = (out.x - h.px) * h.nx + (out.y - h.py) * h.ny;
        const curl = b.curl * smooth(THREE.MathUtils.clamp(fromCrease / CURL_FADE, 0, 1));
        if (Math.abs(curl) > 1e-6) bend(out, phaseBow[k], curl, CURL_SPAN / Math.abs(curl), 0, true, normal);
      }
      const wrap = nearCrease[v * P + k];
      const turned = wrap || moves
        ? bend(out, phaseHinge[k], b.angle, b.radius, b.sag, Boolean(wrap), normal)
        : 0;
      if (!stacked) continue;
      // The turn lays a layer's height over to the flap's far side; the
      // flap's layers take their new heights by the same share of the turn,
      // so they keep to their order through the flap as it goes over. Paper
      // still at the crease rises with the fold.
      const step = zs[row + k + 1] - zs[row + k];
      const flat = step * layering[k];
      const over = (1 - Math.cos(turned)) / 2;
      const whole = step + 2 * height;
      out.z += flat * (1 - over) + whole * over;
      height += flat * (1 - over) + step * over;
    }
    return out;
  }

  const clamp = (u) => THREE.MathUtils.clamp(u, 0, 1);
  function swingTo(k, swing) {
    // A `behind` fold swings the other way so the flap comes up from under.
    // A `lift` raises its flap to that angle, holds it there over the middle
    // of its swing, and lays it back down where it was.
    const { lift } = phases[k];
    const angle = lift
      ? lift * smooth(clamp(swing / LIFT_RAMP)) * smooth(clamp((1 - swing) / LIFT_RAMP))
      : swing * Math.PI * (phases[k].behind ? -1 : 1);
    const ease = Math.sin(Math.abs(angle));
    Object.assign(bends[k], {
      angle,
      radius: CREASE_RADIUS + (bendRadius[k] - CREASE_RADIUS) * ease,
      sag: bendSag[k] * ease,
      curl: 0,
    });
  }

  // How far each tip bends over its flap's swing. The aim alone winds the tip
  // up against the swing and then lets it go, so the tip would stall and then
  // rush; smoothing it over the swing keeps the tip moving evenly.
  const curlCurves = phases.map((phase, k) => {
    if (!phase.tip) return null;
    const aimed = [];
    for (let i = 0; i <= CURL_SAMPLES; i++) {
      const swing = i / CURL_SAMPLES;
      swingTo(k, swing);
      const aim = smooth(clamp((swing - AIM[0]) / (AIM[1] - AIM[0])));
      aimed.push(aim > 0 ? slitAngle(k) * aim : 0);
    }
    swingTo(k, 0);
    // The tip always bends on with the fold, so the flap domes over and the tip
    // dips into the slit, however the aim leans. Cap how fast the bend winds up
    // against the swing, keeping its depth by starting it earlier, and how fast
    // it lets go against its own depth, so a shallow bend doesn't unwind
    // against the falling flap. Then smooth it and ease it in from the start.
    const depth = aimed.map((value) => Math.abs(value));
    const step = (CURL_RATE * Math.PI) / CURL_SAMPLES;
    for (let i = CURL_SAMPLES - 1; i >= 0; i--) depth[i] = Math.max(depth[i], depth[i + 1] - step);
    const release = (CURL_RELEASE * Math.max(...depth)) / CURL_SAMPLES;
    for (let i = 1; i <= CURL_SAMPLES; i++) depth[i] = Math.max(depth[i], depth[i - 1] - release);
    // A shallow bend, or one let go too soon, would land nearly flat, leaving
    // the slide nothing to push.
    const deepen = Math.max(1, CURL_PEAK / Math.max(...depth, 1e-6));
    depth.forEach((value, i) => {
      depth[i] = value * deepen;
    });
    const peak = depth.indexOf(Math.max(...depth));
    const hold = Math.min(depth[peak], CURL_LAND);
    for (let i = peak + 1; i <= CURL_SAMPLES; i++) depth[i] = Math.max(depth[i], hold);
    const curve = depth.map((_, i) => {
      let sum = 0;
      let weights = 0;
      depth.forEach((value, j) => {
        const weight = Math.exp(-0.5 * ((i - j) / (CURL_SMOOTHING * CURL_SAMPLES)) ** 2);
        sum += value * weight;
        weights += weight;
      });
      return (sum * smooth(clamp(i / CURL_SAMPLES / CURL_EASE_IN))) / weights;
    });
    return clearCurl(k, curve);
  });

  // Holds a tip's bend to what keeps its flap off the paper it lands on. Under
  // the band the tip has the pocket to bow into, but anywhere else the bow
  // would push the flap down through the layers below.
  function clearCurl(k, curve) {
    const cell = (x, y) => `${Math.round(x / CLEAR_CELL)},${Math.round(y / CLEAR_CELL)}`;
    phases.forEach((_, j) => {
      if (j !== k) swingTo(j, j < k ? 1 : 0);
    });
    swingTo(k, 0);
    const below = new Map();
    const pocket = new Set();
    const flap = [];
    // One test point per half cell of each piece: the rows along its edges
    // add many more vertices there than the check needs.
    const tested = new Set();
    const hinge = hinges[phases[k].fold];
    const kt = phases.findIndex((phase) => phase.fold === phases[k].tuck);
    for (let v = 0; v < count; v++) {
      const piece = pieces[owner[v]];
      const row = v * (P + 1);
      if (!piece.moves[k]) {
        if (nearCrease[v * P + k]) continue;
        place(v, point);
        const key = cell(point.x, point.y);
        if (piece.moves[kt]) pocket.add(key);
        const z = point.z + Math.max(zs[row + k], zs[row + k + 1]);
        below.set(key, Math.max(below.get(key) ?? -Infinity, z));
      } else if (piece.tucked === undefined) {
        const fromCrease = (rest[v * 2] - hinge.px) * hinge.nx + (rest[v * 2 + 1] - hinge.py) * hinge.ny;
        const at = `${owner[v]},${Math.round(rest[v * 2] / (CELL / 2))},${Math.round(rest[v * 2 + 1] / (CELL / 2))}`;
        if (Math.abs(fromCrease) > CURL_FADE / 2 && !tested.has(at)) {
          tested.add(at);
          flap.push(v);
        }
      }
    }
    const lowest = new Float32Array(flap.length);
    const clears = (swing, curl) => {
      bends[k].curl = curl;
      return flap.every((v, i) => {
        place(v, point);
        const row = v * (P + 1);
        const z = point.z + zs[row + k] + (zs[row + k + 1] - zs[row + k]) * swing;
        if (curl === 0) lowest[i] = z;
        const key = cell(point.x, point.y);
        const floor = below.get(key);
        if (z < Math.min(0, lowest[i])) return false;
        return floor === undefined || pocket.has(key) || z >= Math.min(floor, lowest[i]) - CLEAR_SLACK;
      });
    };
    const capped = curve.map((depth, i) => {
      const swing = i / CURL_SAMPLES;
      swingTo(k, swing);
      clears(swing, 0);
      if (depth === 0 || clears(swing, depth)) return depth;
      let [lo, hi] = [0, depth];
      for (let n = 0; n < 12; n++) {
        const mid = (lo + hi) / 2;
        if (clears(swing, mid)) lo = mid;
        else hi = mid;
      }
      return lo;
    });
    phases.forEach((_, j) => swingTo(j, 0));
    // Let the bend give way ahead of the cap rather than snap to it.
    return curve.map((depth, i) =>
      Math.min(depth, ...capped.map((cap, j) => cap + (Math.abs(i - j) * CLEAR_RATE) / CURL_SAMPLES)),
    );
  }
  const curlAt = (k, swing) => {
    const x = swing * CURL_SAMPLES;
    const i = Math.min(Math.floor(x), CURL_SAMPLES - 1);
    return THREE.MathUtils.lerp(curlCurves[k][i], curlCurves[k][i + 1], x - i);
  };

  const memos = [0, 1].map(() => ({
    from: 0,
    at: 0,
    pos: new Float32Array(count * 3),
    nor: new Float32Array(count * 3),
    height: new Float32Array(count),
  }));
  let lastState = [];
  let shaped = false;

  function setProgress(t) {
    const at = clamp(t) * total;
    const amounts = spans.map(([from, to]) => smooth(clamp((at - from) / (to - from))));
    // A tucking flap rises to its new height as one through the swing, so it
    // lands on the paper below instead of in it. Changing heights unevenly on
    // a raised flap would tear it.
    layering.set(amounts);
    phases.forEach((phase, k) => {
      const raw = clamp((at - spans[k][0]) / (spans[k][1] - spans[k][0]));
      const swing = phase.tip ? smooth(clamp(raw / (1 - SLIDE))) : amounts[k];
      swingTo(k, swing);
      if (phase.tip) {
        const slide = smooth(clamp((raw - 1 + SLIDE) / SLIDE));
        bends[k].curl = curlAt(k, swing) * (1 - slide);
        layering[k] = swing;
      }
    });
    if (spec.offset) {
      const share = smooth(clamp(t));
      sheet.position.set(spec.offset[0] * share, spec.offset[1] * share, 0);
    }
    root.rotation.z = phases.reduce((sum, phase, k) => {
      if (!phase.spin) return sum;
      const raw = clamp((at - spans[k][0]) / (spans[k][1] - spans[k][0]));
      return sum + phase.spin * smooth(clamp((raw - SPIN_FROM) / (1 - SPIN_FROM)));
    }, 0);

    // Phases before the first one that moved since the last call place every
    // vertex the same as then, so each pass resumes from where they left it.
    const state = bends.flatMap((b, k) => [b.angle, b.radius, b.sag, b.curl, layering[k]]);
    let changed = 0;
    while (changed < P && state.slice(changed * 5, changed * 5 + 5).every((value, i) => value === lastState[changed * 5 + i])) {
      changed++;
    }
    lastState = state;
    if (changed === P && shaped) return;
    shaped = true;

    const out = positionAttr.array;
    // Shade by the paper's folded shape alone: the layer heights ramp where
    // pieces meet, and those ramps would show as smears under raking light.
    // Each normal turns with the paper rather than being averaged from the
    // triangles, which cut a tight crease's roll unevenly and would shade its
    // edge in steps.
    const normals = normalAttr.array;
    const lay = (stacked) => {
      const memo = memos[stacked ? 1 : 0];
      memo.from = memo.at <= changed ? memo.at : 0;
      memo.at = changed;
      for (let v = 0; v < count; v++) {
        place(v, point, stacked, stacked ? null : facing, memo);
        out[v * 3] = point.x - w / 2;
        out[v * 3 + 1] = point.y - h / 2;
        out[v * 3 + 2] = point.z;
        if (!stacked) facing.toArray(normals, v * 3);
      }
    };
    lay(false);
    normalAttr.needsUpdate = true;
    // Each lean, scaled by how pressed its fold is.
    const leaning = leans.map(({ k, from, to }) => {
      const pressed = smooth(clamp((Math.abs(bends[k].angle) / Math.PI - RIM_FROM) / (1 - RIM_FROM)));
      if (pressed <= 0) return null;
      const dir = new THREE.Vector3().fromArray(out, to * 3).sub(probe.fromArray(out, from * 3));
      return dir.lengthSq() > 1e-12 ? dir.normalize().multiplyScalar(pressed) : null;
    });
    // Paper still swinging isn't pressed: its layers shift against each other
    // as it bends, and a rolled edge would pick out the shift.
    const still = pieces.map((piece) => piece.moves.reduce(
      (left, moves, k) => (moves
        ? left * Math.max(0, 1 - Math.sin(Math.abs(bends[k].angle)) * 8) * Math.max(0, 1 - Math.abs(bends[k].curl) * 4)
        : left),
      1,
    ));
    const rims = rimAttr.array;
    for (let v = 0; v < count; v++) {
      const dir = leanOf[v] >= 0 ? leaning[leanOf[v]] : null;
      const scale = dir ? still[owner[v]] : 0;
      rims[v * 4] = dir ? dir.x * scale : 0;
      rims[v * 4 + 1] = dir ? dir.y * scale : 0;
      rims[v * 4 + 2] = dir ? dir.z * scale : 0;
    }
    rimAttr.needsUpdate = true;
    // A tip bends back against its flap's turn, which would show its other
    // side; it keeps the flap's face instead.
    for (let v = 0; v < count; v++) {
      shadeAttr.array[v] = tipPhase[v] >= 0 ? tipReach[v] * smooth(clamp(layering[tipPhase[v]] * TIP_SHADE)) : 0;
    }
    shadeAttr.needsUpdate = true;
    lay(true);
    positionAttr.needsUpdate = true;
    geometry.computeBoundingSphere();
  }

  return { root, setProgress };
}

function smooth(u) {
  return u * u * (3 - 2 * u);
}
