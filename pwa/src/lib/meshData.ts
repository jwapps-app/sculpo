import * as THREE from "three";

// Imported mesh geometry is stored inside the node's params as base64 so the
// whole project stays a single JSON document (the server, when it exists,
// never sees binary meshes — same rule as everything else).

function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(out);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function encodeMeshParams(geo: THREE.BufferGeometry): Record<string, string> {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const params: Record<string, string> = {
    pos: bytesToBase64(
      new Uint8Array(pos.array.buffer, pos.array.byteOffset, pos.array.byteLength),
    ),
  };
  if (geo.index) {
    const idx = new Uint32Array(geo.index.array);
    params.idx = bytesToBase64(new Uint8Array(idx.buffer));
  }
  return params;
}

export function decodeMeshGeometry(
  params: Record<string, number | string>,
): THREE.BufferGeometry | null {
  if (typeof params.pos !== "string") return null;
  try {
    const posBytes = base64ToBytes(params.pos);
    const positions = new Float32Array(
      posBytes.buffer,
      posBytes.byteOffset,
      Math.floor(posBytes.byteLength / 4),
    );
    if (positions.length < 9 || positions.length % 3 !== 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions.slice(), 3));
    if (typeof params.idx === "string") {
      const idxBytes = base64ToBytes(params.idx);
      const indices = new Uint32Array(
        idxBytes.buffer,
        idxBytes.byteOffset,
        Math.floor(idxBytes.byteLength / 4),
      );
      geo.setIndex(new THREE.BufferAttribute(indices.slice(), 1));
    }
    geo.computeVertexNormals();
    return geo;
  } catch {
    return null;
  }
}
