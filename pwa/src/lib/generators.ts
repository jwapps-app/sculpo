import * as THREE from "three";

// Parametric generators for functional parts: screw threads and involute
// spur gears. Both build geometry directly (no booleans), so they stay fast
// and regenerate from params like every other primitive.

function buildFromGrid(
  rows: THREE.Vector3[][],
  closeLoop: boolean,
): THREE.BufferGeometry {
  const verts: number[] = [];
  const push = (v: THREE.Vector3) => verts.push(v.x, v.y, v.z);
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i];
    const b = rows[i + 1];
    const n = closeLoop ? a.length : a.length - 1;
    for (let j = 0; j < n; j++) {
      const j2 = (j + 1) % a.length;
      // Two triangles per quad, counter-clockwise seen from outside: rows
      // run bottom to top and rings anticlockwise, so the outward-facing
      // order is (low, low-next, high-next), then (low, high-next, high).
      // The caps wind the same way, which is what makes the solid closed.
      push(a[j]);
      push(a[j2]);
      push(b[j2]);
      push(a[j]);
      push(b[j2]);
      push(b[j]);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  return geo;
}

function capRing(
  ring: THREE.Vector3[],
  center: THREE.Vector3,
  up: boolean,
): number[] {
  const out: number[] = [];
  for (let j = 0; j < ring.length; j++) {
    const a = ring[j];
    const b = ring[(j + 1) % ring.length];
    if (up) out.push(center.x, center.y, center.z, a.x, a.y, a.z, b.x, b.y, b.z);
    else out.push(center.x, center.y, center.z, b.x, b.y, b.z, a.x, a.y, a.z);
  }
  return out;
}

/**
 * A screw thread as a parametric surface: at every angle and height the
 * radius follows the helical thread profile, so no boolean is needed. The
 * profile is an ISO-style truncated triangle (60° flanks).
 */
export function threadGeometry(params: {
  diameter: number;
  pitch: number;
  length: number;
  segments: number;
  internal: boolean;
}): THREE.BufferGeometry {
  const { diameter, pitch, length, internal } = params;
  const seg = Math.max(24, Math.min(256, Math.round(params.segments)));
  const majorR = diameter / 2;
  // ISO metric: thread height H = 0.866*pitch; truncated to 5/8 H.
  const depth = Math.min(0.613 * pitch, majorR * 0.6);
  const coreR = majorR - depth;
  const rowsPerPitch = 12;
  const heightRows = Math.max(8, Math.ceil((length / pitch) * rowsPerPitch));
  const rows: THREE.Vector3[][] = [];

  // Radius at a given height for a given angle: position within the thread
  // period determines how far out the flank has climbed.
  const radiusAt = (z: number, theta: number) => {
    let t = ((z - (theta / (Math.PI * 2)) * pitch) % pitch) / pitch;
    if (t < 0) t += 1;
    // Truncated triangle: rise, flat crest, fall, flat root.
    const rise = 0.3;
    const crest = 0.2;
    const fall = 0.3;
    let f: number;
    if (t < rise) f = t / rise;
    else if (t < rise + crest) f = 1;
    else if (t < rise + crest + fall) f = 1 - (t - rise - crest) / fall;
    else f = 0;
    return internal ? majorR - depth * (1 - f) : coreR + depth * f;
  };

  for (let i = 0; i <= heightRows; i++) {
    const z = (i / heightRows) * length - length / 2;
    const ring: THREE.Vector3[] = [];
    for (let j = 0; j < seg; j++) {
      const theta = (j / seg) * Math.PI * 2;
      // Flatten the profile into a plain cylinder at both ends so the caps
      // are clean and the part is printable/mateable.
      const edgeFade = Math.min(1, Math.min(i, heightRows - i) / (rowsPerPitch * 0.5));
      const r = THREE.MathUtils.lerp(internal ? majorR : coreR, radiusAt(z, theta), edgeFade);
      ring.push(new THREE.Vector3(r * Math.cos(theta), r * Math.sin(theta), z));
    }
    rows.push(ring);
  }

  const geo = buildFromGrid(rows, true);
  const pos = Array.from(geo.getAttribute("position").array as Float32Array);
  // Caps (solid discs for an external screw; internal threads are a shell the
  // user subtracts, so they get caps too and read as a plug).
  pos.push(...capRing(rows[rows.length - 1], new THREE.Vector3(0, 0, length / 2), true));
  pos.push(...capRing(rows[0], new THREE.Vector3(0, 0, -length / 2), false));
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.computeVertexNormals();
  out.center();
  return out;
}

/**
 * Involute spur gear: the real tooth curve, so printed gears actually mesh.
 * Standard proportions, 20° pressure angle.
 */
export function gearGeometry(params: {
  teeth: number;
  module: number;
  thickness: number;
  bore: number;
}): THREE.BufferGeometry {
  const teeth = Math.max(6, Math.round(params.teeth));
  const m = params.module;
  const thickness = params.thickness;
  const pressure = THREE.MathUtils.degToRad(20);

  const rPitch = (m * teeth) / 2;
  const rBase = rPitch * Math.cos(pressure);
  const rAdd = rPitch + m; // tip
  const rDed = Math.max(rBase * 0.6, rPitch - 1.25 * m); // root
  const bore = Math.min(params.bore, rDed * 1.6) / 2;

  // Involute of the base circle, parameterized so it spans base → tip.
  const invPoints = 8;
  const involuteAt = (r: number) => {
    if (r <= rBase) return 0;
    const a = Math.sqrt((r * r) / (rBase * rBase) - 1);
    return a - Math.atan(a);
  };
  // Tooth thickness at the pitch circle is half the angular pitch.
  const angPitch = (Math.PI * 2) / teeth;
  const halfTooth = angPitch / 4 + involuteAt(rPitch);

  const profile: THREE.Vector2[] = [];
  for (let t = 0; t < teeth; t++) {
    const center = t * angPitch;
    // root before the tooth
    profile.push(
      new THREE.Vector2(
        rDed * Math.cos(center - angPitch / 2),
        rDed * Math.sin(center - angPitch / 2),
      ),
    );
    // rising flank (involute, base → tip)
    for (let i = 0; i <= invPoints; i++) {
      const r = THREE.MathUtils.lerp(Math.max(rDed, rBase), rAdd, i / invPoints);
      const a = center - halfTooth + involuteAt(r);
      profile.push(new THREE.Vector2(r * Math.cos(a), r * Math.sin(a)));
    }
    // falling flank (mirror)
    for (let i = invPoints; i >= 0; i--) {
      const r = THREE.MathUtils.lerp(Math.max(rDed, rBase), rAdd, i / invPoints);
      const a = center + halfTooth - involuteAt(r);
      profile.push(new THREE.Vector2(r * Math.cos(a), r * Math.sin(a)));
    }
    // root after the tooth
    profile.push(
      new THREE.Vector2(
        rDed * Math.cos(center + angPitch / 2),
        rDed * Math.sin(center + angPitch / 2),
      ),
    );
  }

  const shape = new THREE.Shape(profile);
  if (bore > 0.2) {
    const hole = new THREE.Path();
    hole.absarc(0, 0, bore, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: 8,
  });
  geo.center();
  return geo;
}
