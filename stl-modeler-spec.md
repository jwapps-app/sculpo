# Self-Hosted STL Modeler — Build Spec

A Tinkercad-style, browser-based 3D modeling tool. Users drag primitive shapes onto a workplane, position/scale/rotate them, mark shapes as **solid** or **hole**, group them to run constructive-solid-geometry (CSG) booleans, and export the result as **.stl**.

## Core Principle

**All geometry compute runs client-side in the browser** (WebGL + WASM). The server only serves static assets and stores/loads project JSON. This must remain true — it is what lets the whole thing run on a low-power NAS. The server never touches meshes.

---

## Tech Stack

### Frontend (does all the work)
- **Vite + React + TypeScript** — build tooling and UI.
- **Three.js** — scene, camera, renderer, workplane grid, primitive geometries.
- **three-bvh-csg** — boolean operations (union / subtract / intersect). This is the "drag a hole into a solid" behavior. Built on BVH-accelerated meshes; robust and fast enough for interactive use.
- **@react-three/fiber** + **@react-three/drei** — React bindings for Three.js plus ready-made helpers (OrbitControls, TransformControls/gizmo, Grid). Optional but strongly recommended; saves a large amount of boilerplate.
- **THREE.STLExporter** (from `three/examples/jsm/exporters/STLExporter.js`) — client-side STL generation (binary preferred).
- **zustand** — lightweight state store for the scene graph.

### Backend (optional, lightweight — build last)
- **FastAPI + PostgreSQL** — CRUD for saving/loading projects.
- Store the **scene graph as JSON** (shape list, transforms, solid/hole flags, group structure) — **never** store the mesh. Regenerate geometry from JSON on load.
- Deployed via **Docker Compose behind a Cloudflare Tunnel**, matching the existing self-hosted stack.

> Build the frontend fully standalone first (projects held in memory + STL export + optional download/upload of the project JSON file). Add the backend only once the modeler works.

---

## Data Model (the scene graph)

The single source of truth. Everything derives from this. It must be JSON-serializable.

```ts
type Vec3 = [number, number, number];

type PrimitiveKind =
  | "box" | "cylinder" | "sphere" | "cone" | "torus" | "text";

interface ShapeNode {
  id: string;
  kind: PrimitiveKind;
  // shape-specific params (e.g. box: {w,h,d}; cylinder: {r,h,segments}; text: {value, size, depth})
  params: Record<string, number | string>;
  position: Vec3;
  rotation: Vec3;   // Euler XYZ, radians
  scale: Vec3;
  role: "solid" | "hole";
  color: string;    // hex, for display only
}

interface GroupNode {
  id: string;
  type: "group";
  childIds: string[];   // ids of ShapeNodes and/or nested GroupNodes
  // a group's exported geometry = CSG of its children by role
}

interface Project {
  id: string;
  name: string;
  version: 1;
  nodes: Record<string, ShapeNode | GroupNode>;
  rootOrder: string[];   // top-level node ids, draw/list order
}
```

---

## CSG Semantics (get this right — it is the heart of the tool)

Mirror Tinkercad's grouping behavior:

1. A **group's** output solid is computed by starting from the union of all **solid** children, then **subtracting** the union of all **hole** children.
2. Ungrouped shapes render independently and are **not** merged into each other.
3. Grouping is what triggers boolean evaluation. Ungrouping restores the individual shapes (keep the original nodes; the grouped result is derived, not destructive).
4. Nested groups: evaluate innermost groups first, treat the resulting solid as a solid child of the parent.
5. Recompute a group's CSG lazily/memoized — only when a descendant changes — so dragging an ungrouped shape stays smooth.

Implementation: use `three-bvh-csg`'s `Evaluator` with `ADDITION` and `SUBTRACTION` operations over `Brush` objects built from each shape's world-space geometry.

---

## Interaction / UX Requirements

- **Workplane**: infinite-feel grid on the XY (or XZ) plane, snap-to-grid toggle, adjustable grid size.
- **Add primitive**: palette of shapes; click or drag to drop one onto the plane at the cursor.
- **Select**: click to select; shift-click for multi-select; marquee optional.
- **Transform gizmo**: translate / rotate / scale modes (drei `TransformControls`), with keyboard shortcuts (e.g. `G/R/S` or `1/2/3`), snapping while a modifier is held.
- **Numeric inspector panel**: exact position/rotation/scale and shape params for the selected node; editable fields.
- **Solid/Hole toggle**: per shape; holes render semi-transparent/wireframe so they read as cutters.
- **Group / Ungroup**: buttons + shortcuts (`Ctrl+G` / `Ctrl+Shift+G`). Grouping runs the CSG.
- **Camera**: OrbitControls; keys for top/front/right/iso views; zoom-to-fit.
- **Undo/redo**: history of scene-graph states (`zustand` + a simple undo stack, or `zundo`). Non-negotiable for a modeling tool.
- **Duplicate / delete** selected nodes.

---

## STL Export

- Button: "Export STL." Optionally export selection-only vs. whole scene.
- For each top-level node: if it's a group, export its evaluated CSG mesh; if it's a lone solid shape, export its mesh. Ignore lone `hole` shapes (a hole with nothing to cut is meaningless — warn the user).
- Merge all exported meshes into one geometry, apply world transforms, then run `STLExporter` in **binary** mode.
- Trigger a browser download (`Blob` + object URL). No server round-trip.
- Sanity-check before export: warn on non-manifold results if cheaply detectable; at minimum ensure the geometry is non-empty.

---

## Suggested Build Order (milestones)

1. **Scene + primitives**: R3F canvas, grid, OrbitControls. Add/select a box. Render it.
2. **Transforms**: gizmo + numeric inspector wired to the scene-graph store. Undo/redo.
3. **All primitives**: box, cylinder, sphere, cone, torus, then text last (text needs a font loader — `TextGeometry` with a typeface JSON, or extrude from an SVG/font path).
4. **Solid/Hole + Group/Ungroup**: implement the CSG evaluator. This is the milestone that makes it "Tinkercad."
5. **STL export**: merge + binary export + download.
6. **Project save/load to a JSON file** (download/upload) — proves serialization works with no backend.
7. **Backend**: FastAPI + Postgres CRUD, Docker Compose, Cloudflare Tunnel. Store scene-graph JSON.

Ship 1–6 as a fully usable standalone tool before touching 7.

---

## Key Libraries / References

- `three` — core.
- `three-bvh-csg` — CSG evaluator (`Brush`, `Evaluator`, `ADDITION`, `SUBTRACTION`, `INTERSECTION`).
- `three-mesh-bvh` — dependency of the above; also useful for fast raycasting/selection.
- `@react-three/fiber`, `@react-three/drei` — React + helpers (`TransformControls`, `Grid`, `OrbitControls`, `Bounds`).
- `three/examples/jsm/exporters/STLExporter.js` — STL output.
- `three/examples/jsm/geometries/TextGeometry.js` + `FontLoader` — text primitive.
- `zustand` (+ `zundo` for undo/redo) — state.

---

## Constraints & Conventions

- Repo under the `jwapps-app` GitHub org.
- No AI attribution anywhere in committed content or commit messages.
- Keep server-side compute at zero — if a feature seems to want server-side geometry, redesign it to stay client-side.
- TypeScript throughout the frontend.
- Binary STL by default; offer ASCII only if a reason arises.

---

## Known Gotchas

- **Non-uniform scale + CSG**: bake scale into geometry (apply the matrix to the `Brush` geometry) before boolean ops; `three-bvh-csg` wants clean world-space geometry, and non-uniform scale on the object transform can distort results.
- **Coplanar faces / z-fighting** between a solid and a hole exactly flush at a face can produce artifacts; nudge holes slightly proud (e.g. extend a through-hole past both faces) — a standard CAD trick.
- **Text geometry** is the fiddliest primitive; defer it. It needs a loaded font and often produces many triangles — watch performance.
- **CSG cost** scales with triangle count. Keep primitive tessellation reasonable (moderate `segments`) so interactive grouping stays fast on modest hardware.
- **Winding/normals** after booleans: ensure `computeVertexNormals()` and consistent winding before export, or STL slicers may complain.
- **Undo granularity**: snapshot on discrete actions (drop, transform-end, group), not on every gizmo frame, or the undo stack explodes.
