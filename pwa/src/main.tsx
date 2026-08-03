import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { APP_NAME } from "./constants/branding.ts";

document.title = APP_NAME;

// The PWA service worker serves the cached app while a new version installs
// in the background; without this, users keep seeing the old build until
// they happen to reload twice. Reload once as soon as the new version takes
// control (guarded so a first-ever install doesn't trigger it).
if ("serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    window.location.reload();
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
