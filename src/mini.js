import { foldPlan } from './folds.js';

const SVG = 'http://www.w3.org/2000/svg';
const FRONT = [243, 234, 215];
const BACK = [228, 213, 185];
const OPEN_MS = 500;
const PHASE_MS = 760;
const HOLD_MS = 1600;
const FADE_MS = 420;
// The view zooms in as the sheet shrinks, but never past this share of it.
const MIN_VIEW = 0.62;
const PAD = 0.06;
const EPS = 1e-6;

function apply(M, [x, y]) {
  return [M[0] * x + M[1] * y + M[4], M[2] * x + M[3] * y + M[5]];
}

function sameMap(A, B) {
  return A.every((value, i) => Math.abs(value - B[i]) < 1e-5);
}

// Pieces sharing a stretch of each edge on the sheet.
function neighbours(pieces) {
  const edges = pieces.map(({ poly }) => poly.map((a, i) => [a, poly[(i + 1) % poly.length]]));
  return edges.map((list, i) => list.map(([a, b]) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < EPS) return [];
    const dx = (b[0] - a[0]) / len;
    const dy = (b[1] - a[1]) / len;
    const off = ([x, y]) => Math.abs((x - a[0]) * dy - (y - a[1]) * dx);
    const along = ([x, y]) => (x - a[0]) * dx + (y - a[1]) * dy;
    return edges.flatMap((other, j) => (j !== i && other.some(([c, d]) => {
      if (off(c) > 1e-5 || off(d) > 1e-5) return false;
      const lo = Math.max(0, Math.min(along(c), along(d)));
      const hi = Math.min(len, Math.max(along(c), along(d)));
      return hi - lo > 1e-5;
    })) ? [j] : []);
  }));
}

function shade(rgb, dark) {
  return `rgb(${rgb.map((c) => Math.round(c * (1 - dark))).join(',')})`;
}

// A looping top-down diagram of a fold, drawn from the same creases as the 3D sheet.
export function foldMini(id, { still = false } = {}) {
  const plan = foldPlan(id);
  const { pieces, phases } = plan;
  const touching = neighbours(pieces);
  const total = phases.reduce((sum, phase) => sum + phase.weight, 0);
  const foldMs = total * PHASE_MS;
  const cycle = OPEN_MS + foldMs + HOLD_MS + FADE_MS;

  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'diagram');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  const nodes = pieces.map(() => {
    const g = document.createElementNS(SVG, 'g');
    const fill = document.createElementNS(SVG, 'polygon');
    const edge = document.createElementNS(SVG, 'path');
    fill.setAttribute('class', 'face');
    edge.setAttribute('class', 'edge');
    edge.setAttribute('vector-effect', 'non-scaling-stroke');
    fill.setAttribute('vector-effect', 'non-scaling-stroke');
    g.append(fill, edge);
    svg.append(g);
    return { g, fill, edge };
  });

  // Phase k at amount t of its swing.
  function draw(k, t) {
    const placed = pieces.map((piece) => {
      const M = piece.maps[k];
      const moving = k < phases.length && piece.moves[k] && t > 0;
      let points = piece.poly.map((point) => apply(M, point));
      if (moving) {
        const { p, n } = phases[k].line;
        const pull = 1 - Math.cos(Math.PI * t);
        points = points.map(([x, y]) => {
          const s = n[0] * (x - p[0]) + n[1] * (y - p[1]);
          return [x - n[0] * s * pull, y - n[1] * s * pull];
        });
      }
      const flips = piece.moves.slice(0, k).filter(Boolean).length + (moving && t > 0.5 ? 1 : 0);
      const z = piece.z[moving && t > 0.5 ? k + 1 : k];
      return { points, moving, flips, z, swing: moving ? Math.sin(Math.PI * t) : 0 };
    });

    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    placed.forEach(({ points }) => points.forEach(([x, y]) => {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }));
    const size = Math.max(x1 - x0, y1 - y0, MIN_VIEW * Math.max(plan.w, plan.h)) * (1 + 2 * PAD);
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    svg.setAttribute('viewBox', `${cx - size / 2} ${-cy - size / 2} ${size} ${size}`);

    placed.forEach(({ points, moving, flips, swing }, i) => {
      const { fill, edge } = nodes[i];
      const flat = points.map(([x, y]) => [x, -y]);
      fill.setAttribute('points', flat.map((q) => q.join(',')).join(' '));
      const color = shade(flips % 2 ? BACK : FRONT, 0.16 * swing);
      fill.setAttribute('fill', color);
      fill.setAttribute('stroke', color);
      // Only paper edges and creases are drawn, not cuts within one flat stretch.
      const path = flat.map((a, e) => {
        const joined = touching[i][e].some((j) => placed[j].moving === moving
          && sameMap(pieces[j].maps[k], pieces[i].maps[k]));
        if (joined) return '';
        const b = flat[(e + 1) % flat.length];
        return `M${a[0]},${a[1]}L${b[0]},${b[1]}`;
      }).join('');
      edge.setAttribute('d', path);
    });

    const order = placed.map((_, i) => i).sort((a, b) => placed[a].z - placed[b].z);
    order.forEach((i, rank) => {
      if (svg.children[rank] !== nodes[i].g) svg.append(...order.slice(rank).map((j) => nodes[j].g));
    });
  }

  function at(ms) {
    let left = (ms - OPEN_MS) / PHASE_MS;
    if (left <= 0) return [0, 0];
    for (let k = 0; k < phases.length; k++) {
      if (left < phases[k].weight) {
        const u = left / phases[k].weight;
        return [k, u * u * (3 - 2 * u)];
      }
      left -= phases[k].weight;
    }
    return [phases.length, 0];
  }

  if (still) {
    draw(phases.length, 0);
    return svg;
  }

  let start = performance.now();
  let last = '';
  function frame(now) {
    if (!svg.isConnected) return;
    requestAnimationFrame(frame);
    if (!svg.getClientRects().length) {
      start = now;
      return;
    }
    const ms = (now - start) % cycle;
    const [k, t] = at(ms);
    const fade = ms > cycle - FADE_MS ? (cycle - ms) / FADE_MS : ms < OPEN_MS / 2 ? ms / (OPEN_MS / 2) : 1;
    svg.style.opacity = fade.toFixed(3);
    const key = `${k}:${t.toFixed(4)}`;
    if (key === last) return;
    last = key;
    draw(k, t);
  }
  draw(0, 0);
  requestAnimationFrame(frame);
  return svg;
}
