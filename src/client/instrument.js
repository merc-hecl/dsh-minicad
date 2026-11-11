import * as THREE from "three";

const PENTATONIC = [0, 2, 4, 7, 9];
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const cache = new WeakMap();

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const clamp01 = value => clamp(value, 0, 1);

// Eigenvalues of a symmetric 3x3 matrix, ascending. The principal moments are
// the only shape signal the synthesis needs, so eigenvectors are unnecessary.
function eigenvalues([m00, m01, m02, m11, m12, m22]) {
  const p1 = m01 * m01 + m02 * m02 + m12 * m12;
  const q = (m00 + m11 + m22) / 3;
  const p2 = (m00 - q) ** 2 + (m11 - q) ** 2 + (m22 - q) ** 2 + 2 * p1;
  if (p2 < 1e-18) return [q, q, q];
  const p = Math.sqrt(p2 / 6);
  const b00 = (m00 - q) / p, b11 = (m11 - q) / p, b22 = (m22 - q) / p;
  const b01 = m01 / p, b02 = m02 / p, b12 = m12 / p;
  const determinant = b00 * (b11 * b22 - b12 * b12)
    - b01 * (b01 * b22 - b12 * b02)
    + b02 * (b01 * b12 - b11 * b02);
  const phi = Math.acos(clamp(determinant / 2, -1, 1)) / 3;
  const first = q + 2 * p * Math.cos(phi);
  const third = q + 2 * p * Math.cos(phi + (2 * Math.PI) / 3);
  const second = 3 * q - first - third;
  return [first, second, third].sort((left, right) => left - right);
}

function finalizeBody(body, name, index) {
  const volume = Math.abs(body.volume) > 1e-9 ? Math.abs(body.volume) : 0;
  const scale = Math.max(volume, 1e-9);
  const centroid = new THREE.Vector3(body.first[0] / scale, body.first[1] / scale, body.first[2] / scale);
  const [xx, yy, zz, xy, xz, yz] = body.second;
  const trace = xx + yy + zz;
  const inertia = [
    trace - xx, -xy, -xz,
    trace - yy, -yz,
    trace - zz,
  ];
  // Parallel axis: move the inertia tensor from the origin to the centroid.
  const [cx, cy, cz] = centroid.toArray();
  const c2 = cx * cx + cy * cy + cz * cz;
  const shifted = [
    inertia[0] - volume * (c2 - cx * cx), inertia[1] + volume * cx * cy, inertia[2] + volume * cx * cz,
    inertia[3] - volume * (c2 - cy * cy), inertia[4] + volume * cy * cz,
    inertia[5] - volume * (c2 - cz * cz),
  ];
  const extents = body.box.isEmpty()
    ? [0, 0, 0]
    : [body.box.max.x - body.box.min.x, body.box.max.y - body.box.min.y, body.box.max.z - body.box.min.z]
      .sort((left, right) => left - right);
  let maxRadius = 0;
  if (!body.box.isEmpty())
    for (const x of [body.box.min.x, body.box.max.x])
      for (const y of [body.box.min.y, body.box.max.y])
        for (const z of [body.box.min.z, body.box.max.z])
          maxRadius = Math.max(maxRadius, Math.hypot(x - cx, y - cy, z - cz));
  return {
    index, name, centroid, volume, area: body.area, extents,
    maxRadius: Math.max(maxRadius, 1e-3), eigen: eigenvalues(shifted),
  };
}

function buildAnalysis(preview, parts) {
  const positions = preview.positions, indices = preview.indices, faceIndices = preview.faceIndices;
  const groups = parts?.length
    ? parts.map((part, index) => ({ index, name: part.name || "", faceStart: part.faceStart, faceCount: part.faceCount }))
    : [{ index: 0, name: "", faceStart: 0, faceCount: Infinity }];
  let faceCount = 0;
  if (parts?.length) for (const part of parts) faceCount = Math.max(faceCount, part.faceStart + part.faceCount);
  const faceGroup = parts?.length ? new Int16Array(Math.max(faceCount, 1)).fill(-1) : null;
  if (faceGroup) parts.forEach((part, index) => faceGroup.fill(index, part.faceStart, part.faceStart + part.faceCount));
  const bodies = groups.map(() => ({
    volume: 0, area: 0, first: [0, 0, 0],
    second: [0, 0, 0, 0, 0, 0],
    box: new THREE.Box3(),
  }));
  const edgeA = new THREE.Vector3(), edgeB = new THREE.Vector3(), normal = new THREE.Vector3();
  const vertex = new THREE.Vector3();
  const triangleCount = Math.floor(indices.length / 3);
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const a = indices[triangle * 3], b = indices[triangle * 3 + 1], c = indices[triangle * 3 + 2];
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
    const cx = positions[c * 3], cy = positions[c * 3 + 1], cz = positions[c * 3 + 2];
    const group = faceGroup ? faceGroup[faceIndices[triangle]] ?? 0 : 0;
    const body = bodies[group] || bodies[0];
    const volume = (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
    body.volume += volume;
    body.first[0] += volume * (ax + bx + cx) / 4;
    body.first[1] += volume * (ay + by + cy) / 4;
    body.first[2] += volume * (az + bz + cz) / 4;
    const sx = ax + bx + cx, sy = ay + by + cy, sz = az + bz + cz;
    const weight = volume / 20;
    body.second[0] += weight * (ax * ax + bx * bx + cx * cx + sx * sx);
    body.second[1] += weight * (ay * ay + by * by + cy * cy + sy * sy);
    body.second[2] += weight * (az * az + bz * bz + cz * cz + sz * sz);
    body.second[3] += weight * (ax * ay + bx * by + cx * cy + sx * sy);
    body.second[4] += weight * (ax * az + bx * bz + cx * cz + sx * sz);
    body.second[5] += weight * (ay * az + by * bz + cy * cz + sy * sz);
    edgeA.set(bx - ax, by - ay, bz - az);
    edgeB.set(cx - ax, cy - ay, cz - az);
    body.area += normal.crossVectors(edgeA, edgeB).length() / 2;
    body.box.expandByPoint(vertex.set(ax, ay, az));
    body.box.expandByPoint(vertex.set(bx, by, bz));
    body.box.expandByPoint(vertex.set(cx, cy, cz));
  }
  const mesh = new THREE.Mesh(
    (() => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      return geometry;
    })(),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  return {
    mesh,
    parts,
    bodies: bodies.map((body, index) => finalizeBody(body, groups[index]?.name || "", index)),
  };
}

export function analyze(preview, parts) {
  if (!preview) return null;
  const cached = cache.get(preview);
  if (cached) return cached;
  const analysis = buildAnalysis(preview, parts);
  cache.set(preview, analysis);
  return analysis;
}

function partForFace(parts, face) {
  if (!parts?.length) return 0;
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (face >= part.faceStart && face < part.faceStart + part.faceCount) return index;
  }
  return 0;
}

function localThickness(analysis, point, normal) {
  const direction = new THREE.Vector3(-normal[0], -normal[1], -normal[2]).normalize();
  const origin = new THREE.Vector3(point[0], point[1], point[2]).addScaledVector(direction, 0.001);
  const ray = new THREE.Raycaster(origin, direction, 0, 1e6);
  const hit = ray.intersectObject(analysis.mesh, false).find(item => item.distance > 0.002);
  return hit ? hit.distance + 0.001 : null;
}

function foldFrequency(value) {
  let frequency = Math.max(1, value);
  while (frequency < 110) frequency *= 2;
  while (frequency >= 880) frequency /= 2;
  return frequency;
}

function quantize(midi) {
  const pitchClass = ((midi % 12) + 12) % 12;
  let best = 0, distance = Infinity;
  for (const step of PENTATONIC) {
    const gap = Math.min(Math.abs(pitchClass - step), 12 - Math.abs(pitchClass - step));
    if (gap < distance) { distance = gap; best = step; }
  }
  return midi + best - pitchClass;
}

// Move up the pentatonic scale starting from the body's own note, so every
// position lands on a note of the same scale instead of shifting the C offsets.
function pentatonicAbove(base, degree) {
  const baseClass = ((base % 12) + 12) % 12;
  const scale = PENTATONIC.slice().sort((left, right) => left - right);
  let cursor = scale.indexOf(baseClass);
  if (cursor < 0) cursor = 0;
  let octave = 0, offset = 0;
  for (let step = 0; step < degree; step++) {
    cursor += 1;
    if (cursor >= scale.length) { cursor = 0; octave += 1; }
    offset = scale[cursor] + 12 * octave - baseClass;
  }
  return base + offset;
}

export function strike(analysis, hit) {
  const index = partForFace(analysis.parts, hit.face);
  const body = analysis.bodies[index] || analysis.bodies[0];
  const [t0, t1, t2] = body.extents;
  const area = Math.max(body.area, 1e-6);
  // Equivalent plate thickness and largest span drive the base pitch.
  const thickness = Math.max(0.2, (2 * body.volume) / area);
  const span = Math.max(1, t2);
  let midi = 69 + 12 * Math.log2(foldFrequency(800 * (thickness / 1000) / (span / 1000) ** 2) / 440);
  midi = quantize(Math.round(midi));
  const distance = Math.hypot(hit.point[0] - body.centroid.x, hit.point[1] - body.centroid.y, hit.point[2] - body.centroid.z);
  const radius = clamp01(distance / body.maxRadius);
  midi = clamp(pentatonicAbove(midi, Math.round(radius * 8)), 21, 108);
  const frequency = 440 * 2 ** ((midi - 69) / 12);
  // Continuous shape profile: thin, elongated, hollow, compact.
  const thin = clamp01(1 - t0 / Math.max(t1, 1e-6));
  const long = clamp01((t2 / Math.max(t1, 1e-6) - 1) / 4);
  const boxArea = 2 * (t0 * t1 + t1 * t2 + t0 * t2);
  const hollow = clamp01((area / Math.max(boxArea, 1e-6) - 1) / 3);
  const compact = clamp01((1 - thin) * (1 - long));
  const local = localThickness(analysis, hit.point, hit.normal);
  const localRatio = clamp(local === null ? 1 : local / Math.max(thickness, 0.1), 0.2, 3);
  const decay = clamp(0.32 + 0.9 * clamp01(span / 250) + 0.4 * hollow - 0.22 * compact, 0.18, 2.2);
  const high = (0.45 + 0.55 * thin) * (0.55 + 0.45 * radius) * (1 - 0.35 * compact);
  const partials = [
    { ratio: 1, amp: clamp(0.7 + 0.25 * hollow - 0.2 * compact, 0.2, 1), decay },
    { ratio: 2.76, amp: 0.6 * high, decay: decay * 0.7 },
    { ratio: 5.4, amp: 0.34 * high, decay: decay * 0.5 },
    { ratio: 8.93, amp: 0.16 * high * (0.6 + 0.4 * radius), decay: decay * 0.35 },
  ];
  const velocity = Math.round(clamp(54 + 62 * clamp01(localRatio / 2) * (0.7 + 0.3 * radius), 1, 127));
  return {
    partIndex: index,
    partName: body.name,
    midi, frequency, decay, partials,
    noise: 0.04 + 0.22 * compact,
    gain: 0.14 + 0.06 * (velocity / 127),
    velocity,
    radius,
    thickness: local === null ? thickness : local,
  };
}

let audio = null;
let master = null;
let noiseBuffer = null;

function audioContext() {
  if (!audio) {
    const Context = window.AudioContext || window.webkitAudioContext;
    audio = new Context();
    master = audio.createDynamicsCompressor();
    master.threshold.value = -18;
    master.knee.value = 18;
    master.ratio.value = 6;
    master.attack.value = 0.003;
    master.release.value = 0.25;
    master.connect(audio.destination);
    noiseBuffer = audio.createBuffer(1, Math.floor(audio.sampleRate * 0.12), audio.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let index = 0; index < data.length; index++) data[index] = Math.random() * 2 - 1;
  }
  if (audio.state === "suspended") audio.resume();
  return audio;
}

export function playVoice(voice) {
  const context = audioContext();
  const now = context.currentTime + 0.005;
  const output = context.createGain();
  output.gain.value = voice.gain;
  output.connect(master);
  for (const partial of voice.partials) {
    if (!(partial.amp > 0.002)) continue;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = voice.frequency * partial.ratio;
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(partial.amp, now + 0.004);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + partial.decay);
    oscillator.connect(envelope).connect(output);
    oscillator.start(now);
    oscillator.stop(now + partial.decay + 0.02);
  }
  const source = context.createBufferSource();
  source.buffer = noiseBuffer;
  const filter = context.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = Math.min(12000, voice.frequency * 5);
  filter.Q.value = 0.8;
  const transient = context.createGain();
  transient.gain.setValueAtTime(voice.noise, now);
  transient.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
  source.connect(filter).connect(transient).connect(output);
  source.start(now);
  source.stop(now + 0.1);
  const lifetime = Math.max(...voice.partials.map(partial => partial.decay)) + 0.25;
  window.setTimeout(() => output.disconnect(), lifetime * 1000);
}

export function noteName(midi) {
  const number = clamp(Math.round(midi), 0, 127);
  return `${NOTE_NAMES[number % 12]}${Math.floor(number / 12) - 1}`;
}

function variableLength(value) {
  const bytes = [value & 0x7F];
  let rest = value >> 7;
  while (rest > 0) {
    bytes.unshift((rest & 0x7F) | 0x80);
    rest >>= 7;
  }
  return bytes;
}

// Standard MIDI file, format 0: one track whose note times come from the
// performance recorded in the app.
export function encodeMidi(events, { tempo = 120, ppq = 96 } = {}) {
  const ticksPerMs = (ppq * tempo) / 60000;
  const timeline = [];
  for (const event of events) {
    const start = Math.max(0, Math.round(event.at * ticksPerMs));
    const length = Math.max(1, Math.round(event.duration * ticksPerMs * 0.55));
    timeline.push({ tick: start, order: 1, bytes: [0x90, clamp(event.midi, 0, 127), clamp(Math.round(event.velocity), 1, 127)] });
    timeline.push({ tick: start + length, order: 0, bytes: [0x80, clamp(event.midi, 0, 127), 0] });
  }
  timeline.sort((left, right) => left.tick - right.tick || left.order - right.order);
  const track = [];
  const push = (...values) => track.push(...values);
  push(0x00, 0xFF, 0x51, 0x03,
    (Math.round(60000000 / tempo) >> 16) & 0xFF,
    (Math.round(60000000 / tempo) >> 8) & 0xFF,
    Math.round(60000000 / tempo) & 0xFF);
  const name = [0x4D, 0x69, 0x6E, 0x69, 0x43, 0x41, 0x44];
  push(0x00, 0xFF, 0x03, name.length, ...name);
  push(0x00, 0xC0, 0x00);
  let last = 0;
  for (const item of timeline) {
    push(...variableLength(item.tick - last), ...item.bytes);
    last = item.tick;
  }
  push(0x00, 0xFF, 0x2F, 0x00);
  const header = [0x4D, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x01, (ppq >> 8) & 0xFF, ppq & 0xFF];
  const chunk = [0x4D, 0x54, 0x72, 0x6B,
    (track.length >> 24) & 0xFF, (track.length >> 16) & 0xFF, (track.length >> 8) & 0xFF, track.length & 0xFF,
    ...track];
  return new Uint8Array([...header, ...chunk]);
}
