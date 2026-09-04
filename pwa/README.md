# Sculpo — web app

The modeller itself: Vite + React + TypeScript, three.js through
@react-three/fiber, booleans via Manifold (WebAssembly), state in zustand with undo via
zundo.

```bash
npm install
npm run dev      # proxies /api to the backend on :8020
npm run build
npm run lint
```

All geometry runs client-side, including the booleans and the STL export. See
the [root README](../README.md) for what the app does and how to host it.
