// Binary-image connected components (8-connected) with the statistics marker
// detection needs: area, bounding box, centroid, holes, and a quadrilateral fit.

import type { Point } from './homography.ts';

export interface Component {
  id: number;
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Centroid in continuous coordinates (pixel centres at i + 0.5). */
  cx: number;
  cy: number;
}

export interface Labels {
  width: number;
  height: number;
  labels: Int32Array;
  components: Component[];
}

/** Label 8-connected foreground (mask = 1) regions. Two-pass union-find. */
export function labelComponents(mask: Uint8Array, width: number, height: number): Labels {
  const labels = new Int32Array(width * height);
  const parent: number[] = [0];
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  let next = 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      let l = 0;
      const nb = [
        x > 0 ? labels[i - 1] : 0,
        y > 0 && x > 0 ? labels[i - width - 1] : 0,
        y > 0 ? labels[i - width] : 0,
        y > 0 && x < width - 1 ? labels[i - width + 1] : 0,
      ];
      for (const n of nb) {
        if (!n) continue;
        if (!l) l = n;
        else if (n !== l) union(l, n);
      }
      if (!l) {
        l = next++;
        parent.push(l);
      }
      labels[i] = l;
    }
  }
  const remap = new Int32Array(next);
  const comps: Component[] = [];
  for (let l = 1; l < next; l++) {
    const r = find(l);
    if (!remap[r]) {
      comps.push({ id: comps.length + 1, area: 0, minX: width, minY: height, maxX: -1, maxY: -1, cx: 0, cy: 0 });
      remap[r] = comps.length;
    }
    remap[l] = remap[r];
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!labels[i]) continue;
      const id = remap[labels[i]];
      labels[i] = id;
      const c = comps[id - 1];
      c.area++;
      c.cx += x + 0.5;
      c.cy += y + 0.5;
      if (x < c.minX) c.minX = x;
      if (x > c.maxX) c.maxX = x;
      if (y < c.minY) c.minY = y;
      if (y > c.maxY) c.maxY = y;
    }
  }
  for (const c of comps) {
    c.cx /= c.area;
    c.cy /= c.area;
  }
  return { width, height, labels, components: comps };
}

export interface HoleInfo {
  /** Background pixels enclosed by the component (not reachable from outside its bounding box). */
  holeArea: number;
  /** The largest single enclosed region (the orientation hole, if any) and its centroid. */
  largestHole: number;
  hcx: number;
  hcy: number;
  /** Centroid of component + holes (the filled shape). */
  fcx: number;
  fcy: number;
}

export function holes(L: Labels, c: Component): HoleInfo {
  const x0 = c.minX - 1;
  const y0 = c.minY - 1;
  const w = c.maxX - c.minX + 3;
  const h = c.maxY - c.minY + 3;
  const seen = new Uint8Array(w * h);
  const inComp = (x: number, y: number) => {
    const gx = x + x0;
    const gy = y + y0;
    return gx >= 0 && gy >= 0 && gx < L.width && gy < L.height && L.labels[gy * L.width + gx] === c.id;
  };
  const stack: number[] = [0];
  seen[0] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (seen[j] || inComp(nx, ny)) continue;
      seen[j] = 1;
      stack.push(j);
    }
  }
  // Every enclosed pixel is a hole pixel; group them into separate holes.
  let holeArea = 0;
  let hx = 0;
  let hy = 0;
  let largest = 0;
  let lx = c.cx;
  let ly = c.cy;
  for (let start = 0; start < w * h; start++) {
    const sx = start % w;
    const sy = (start / w) | 0;
    if (seen[start] || inComp(sx, sy)) continue;
    let n = 0;
    let ax = 0;
    let ay = 0;
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w;
      const y = (i / w) | 0;
      n++;
      ax += x + x0 + 0.5;
      ay += y + y0 + 0.5;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (seen[j] || inComp(nx, ny)) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    holeArea += n;
    hx += ax;
    hy += ay;
    if (n > largest) {
      largest = n;
      lx = ax / n;
      ly = ay / n;
    }
  }
  const total = c.area + holeArea;
  return {
    holeArea,
    largestHole: largest,
    hcx: lx,
    hcy: ly,
    fcx: (c.cx * c.area + hx) / total,
    fcy: (c.cy * c.area + hy) / total,
  };
}

/** Morphological closing with a 3x3 square (dilate, then erode): fills pinholes and 1-2 px speckle gaps. */
export function closeMask(mask: Uint8Array, w: number, h: number): Uint8Array {
  const pass = (src: Uint8Array, want: 0 | 1) => {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let hit = want === 1 ? 0 : 1;
        for (let dy = -1; dy <= 1 && hit !== want; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            const v = xx < 0 || yy < 0 || xx >= w || yy >= h ? 0 : src[yy * w + xx];
            if (v === want) {
              hit = want;
              break;
            }
          }
        out[y * w + x] = want === 1 ? hit : hit === 0 ? 0 : 1;
      }
    return out;
  };
  return pass(pass(mask, 1), 0);
}

/**
 * Fit a quadrilateral to a blob: the farthest pixel from the centroid, the
 * farthest from that, then the farthest on each side of the line between them.
 * Works at any rotation and under perspective. Corners are returned in
 * clockwise order in image coordinates (y down).
 */
export function fitQuad(L: Labels, c: Component): Point[] {
  const pts: [number, number][] = [];
  for (let y = c.minY; y <= c.maxY; y++)
    for (let x = c.minX; x <= c.maxX; x++) if (L.labels[y * L.width + x] === c.id) pts.push([x + 0.5, y + 0.5]);
  const far = (from: Point) => {
    let best = pts[0];
    let bd = -1;
    for (const p of pts) {
      const d = (p[0] - from[0]) ** 2 + (p[1] - from[1]) ** 2;
      if (d > bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  };
  const p1 = far([c.cx, c.cy]);
  const p3 = far(p1);
  const side = (p: Point) => (p3[0] - p1[0]) * (p[1] - p1[1]) - (p3[1] - p1[1]) * (p[0] - p1[0]);
  let p2 = p1;
  let p4 = p1;
  let s2 = 0;
  let s4 = 0;
  for (const p of pts) {
    const s = side(p);
    if (s > s2) {
      s2 = s;
      p2 = p;
    }
    if (s < s4) {
      s4 = s;
      p4 = p;
    }
  }
  const quad: Point[] = [p1, p2, p3, p4];
  // Order clockwise around the centroid (y down: increasing atan2).
  return quad.sort((a, b) => Math.atan2(a[1] - c.cy, a[0] - c.cx) - Math.atan2(b[1] - c.cy, b[0] - c.cx));
}
