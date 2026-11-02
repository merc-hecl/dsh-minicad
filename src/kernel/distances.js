import * as cad from "@classcad/smlibwasm";

const vector = p => [p.x, p.y, p.z];
const separation = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const accuracy = 0.001; // mm; independent of the display preview's tessellation.
const bounds = points => points.reduce((box, p) => {
  for (let i = 0; i < 3; i++) { box.min[i] = Math.min(box.min[i], p[i]); box.max[i] = Math.max(box.max[i], p[i]); }
  return box;
}, { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
function bound(a, b, maximum) {
  return Math.hypot(...[0, 1, 2].map(i => maximum
    ? Math.max(Math.abs(a.min[i] - b.max[i]), Math.abs(a.max[i] - b.min[i]))
    : Math.max(0, a.min[i] - b.max[i], b.min[i] - a.max[i])));
}
const diameter = node => separation(node.box.min, node.box.max);

// Best-first branch and bound. Boxes bound every possible pair; a result is
// accepted only when no remaining box can improve it by more than accuracy.
function extreme(a, b, maximum, accuracy) {
  let best = { value: maximum ? -Infinity : Infinity };
  const heap = [];
  const better = (x, y) => maximum ? x > y : x < y;
  function consider(p, q) {
    const value = separation(p, q);
    if (better(value, best.value)) best = { value, point: p, otherPoint: q };
  }
  function enqueue(a, b) {
    for (const p of a.points) for (const q of b.points) consider(p, q);
    const limit = bound(a.box, b.box, maximum);
    if (!better(limit, best.value + (maximum ? accuracy : -accuracy))) return;
    const entry = { a, b, limit };
    let i = heap.length;
    heap.push(entry);
    while (i) {
      const parent = (i - 1) >> 1;
      if (!better(entry.limit, heap[parent].limit)) break;
      heap[i] = heap[parent]; i = parent;
    }
    heap[i] = entry;
  }
  function pop() {
    const first = heap[0], last = heap.pop();
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1;
        if (child + 1 < heap.length && better(heap[child + 1].limit, heap[child].limit)) child++;
        if (!better(heap[child].limit, last.limit)) break;
        heap[i] = heap[child]; i = child;
      }
      heap[i] = last;
    }
    return first;
  }
  enqueue(a, b);
  while (heap.length) {
    const entry = pop();
    if (!better(entry.limit, best.value + (maximum ? accuracy : -accuracy))) break;
    const { a, b } = entry;
    if (a.split && (!b.split || diameter(a) >= diameter(b)))
      for (const child of a.split()) enqueue(child, b);
    else if (b.split) for (const child of b.split()) enqueue(a, child);
  }
  return best;
}

function curveNode(edge, start = 0, end = 1) {
  const piece = start === 0 && end === 1 ? edge : edge.trim(start, end);
  let box;
  try { const b = piece.bbox(); box = { min: vector(b.min), max: vector(b.max) }; }
  finally { if (piece !== edge) piece.dispose(); }
  const mid = (start + end) / 2;
  let children;
  return { box, points: [start, mid, end].map(t => vector(edge.pointAt(t))),
    split: () => children ||= [curveNode(edge, start, mid), curveNode(edge, mid, end)] };
}

// Parallel circular arcs admit analytic extrema: endpoints, aligned radii,
// and intersections of their in-plane circles. This also handles coaxial arcs
// whose extrema form a continuous family.
function circlePair(a, b, maximum) {
  if (!(a instanceof cad.Edge) || !(b instanceof cad.Edge) || a.geomType !== "circle" || b.geomType !== "circle") return null;
  const normal = a.normal.normalized();
  if (Math.abs(normal.dot(b.normal.normalized())) < 1 - 1e-10) return null;
  const delta = b.arcCenter.sub(a.arcCenter), height = delta.dot(normal);
  const radial = delta.sub(normal.mul(height)), d = radial.length;
  const r = a.radius, s = b.radius, candidates = [];
  const add = (p, q) => candidates.push({ value: p.distanceTo(q), point: vector(p), otherPoint: vector(q), method: "analytic_circles" });
  const onArc = (edge, p) => edge.distanceTo(p) < 1e-7;
  function fromEndpoint(p, edge, swapped) {
    let q;
    if (maximum) {
      const offset = p.sub(edge.arcCenter), radial = offset.sub(normal.mul(offset.dot(normal)));
      q = radial.length > 1e-12 ? edge.closestPoint(edge.arcCenter.sub(radial.normalized().mul(edge.radius))) : edge.start;
    } else q = edge.closestPoint(p);
    if (swapped) add(q, p); else add(p, q);
  }
  for (const p of [a.start, a.end]) fromEndpoint(p, b, false);
  for (const q of [b.start, b.end]) fromEndpoint(q, a, true);
  if (d > 1e-10) {
    const u = radial.mul(1 / d);
    for (const x of [-1, 1]) for (const y of [-1, 1]) {
      const p = a.arcCenter.add(u.mul(x * r)), q = b.arcCenter.add(u.mul(y * s));
      if (onArc(a, p) && onArc(b, q)) add(p, q);
    }
    if (!maximum && d <= r + s && d >= Math.abs(r - s)) {
      const x = (d * d + r * r - s * s) / (2 * d), y = Math.sqrt(Math.max(0, r * r - x * x));
      for (const sign of [-1, 1]) {
        const p = a.arcCenter.add(u.mul(x)).add(normal.cross(u).mul(sign * y)), q = p.add(normal.mul(height));
        if (onArc(a, p) && onArc(b, q)) add(p, q);
      }
    }
  }
  return candidates.reduce((best, pair) => (maximum ? pair.value > best.value : pair.value < best.value) ? pair : best);
}

export function nearestPair(a, b) {
  if (Array.isArray(a) && Array.isArray(b))
    return { value: separation(a, b), point: a, otherPoint: b };
  if (Array.isArray(a)) {
    const q = vector(b.closestPoint(a));
    return { value: separation(a, q), point: a, otherPoint: q };
  }
  if (Array.isArray(b)) {
    const result = nearestPair(b, a);
    return { ...result, point: result.otherPoint, otherPoint: result.point };
  }
  if (a instanceof cad.Face || a instanceof cad.Part || a instanceof cad.Shell) {
    const body = a instanceof cad.Face ? a.toShell() : a;
    try {
      const pair = body.closestPoints(b);
      return { value: pair.distance, point: vector(pair.point), otherPoint: vector(pair.otherPoint) };
    } finally { if (body !== a) body.dispose(); }
  }
  if (b instanceof cad.Face || b instanceof cad.Part || b instanceof cad.Shell) {
    const result = nearestPair(b, a);
    return { ...result, point: result.otherPoint, otherPoint: result.point };
  }
  const circles = circlePair(a, b, false);
  if (circles) return circles;
  if (a.geomType === "line" && b.geomType === "line") {
    const candidates = [
      [a.start, b.closestPoint(a.start)], [a.end, b.closestPoint(a.end)],
      [a.closestPoint(b.start), b.start], [a.closestPoint(b.end), b.end],
    ];
    const u = a.end.sub(a.start), v = b.end.sub(b.start), w = a.start.sub(b.start);
    const aa = u.dot(u), bb = u.dot(v), cc = v.dot(v), dd = u.dot(w), ee = v.dot(w), det = aa * cc - bb * bb;
    if (det > 1e-14 * aa * cc) {
      const s = (bb * ee - cc * dd) / det, t = (aa * ee - bb * dd) / det;
      if (s >= 0 && s <= 1 && t >= 0 && t <= 1) candidates.push([a.start.add(u.mul(s)), b.start.add(v.mul(t))]);
    }
    return candidates.map(([p, q]) => ({ value: p.distanceTo(q), point: vector(p), otherPoint: vector(q) }))
      .reduce((best, pair) => pair.value < best.value ? pair : best);
  }
  return { ...extreme(curveNode(a), curveNode(b), false, accuracy), method: "bounded_curves", accuracy, approximate: true };
}

function pointTree(points) {
  const box = bounds(points);
  if (points.length <= 8) return { box, points };
  const sizes = box.max.map((v, i) => v - box.min[i]);
  const axis = sizes.indexOf(Math.max(...sizes));
  points.sort((a, b) => a[axis] - b[axis]);
  const mid = points.length >> 1;
  let children;
  return { box, points: [points[0], points[mid], points.at(-1)],
    split: () => children ||= [pointTree(points.slice(0, mid)), pointTree(points.slice(mid))] };
}
function maximumNode(item) {
  if (Array.isArray(item)) return { tree: pointTree([item]), approximate: false };
  if (item instanceof cad.Edge) return item.geomType === "line"
    ? { tree: pointTree([vector(item.start), vector(item.end)]), approximate: false }
    : { tree: curveNode(item), approximate: true };
  // Two surfaces contribute their chord tolerances; reserve half the total
  // accuracy for the extremum search itself.
  const mesh = item.mesh(accuracy / 4, 5);
  try {
    const points = [];
    for (let i = 0; i < mesh.vertices.length; i += 3) points.push(Array.from(mesh.vertices.subarray(i, i + 3)));
    const faces = item instanceof cad.Face ? [item] : item.faces();
    const approximate = faces.some(face => face.geomType !== "plane" || face.edges().some(edge => edge.geomType !== "line"));
    return { tree: pointTree(points), approximate, meshed: approximate };
  } finally { mesh.dispose(); }
}
export function farthestPair(a, b) {
  const circles = circlePair(a, b, true);
  if (circles) return circles;
  const left = maximumNode(a), right = maximumNode(b);
  const approximate = left.approximate || right.approximate;
  return { ...extreme(left.tree, right.tree, true, approximate ? accuracy / 2 : 1e-9),
    method: approximate ? (left.meshed || right.meshed ? "tessellated_extrema" : "bounded_curves") : "vertices", ...(approximate ? { accuracy, approximate: true } : {}) };
}
