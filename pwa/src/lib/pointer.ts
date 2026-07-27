import { useSyncExternalStore } from "react";

// Whether to lay the UI out for a fingertip or a cursor.
//
// The obvious test — matchMedia("(pointer: coarse)") — asks what the device's
// *primary* pointer is, and an iPad with a mouse attached answers "fine". That
// is right for the mouse and wrong the moment the same hand touches the screen,
// so going by it alone strands whoever is holding the other input.
//
// So: last input wins. The media query only seeds the answer for the first
// paint, before anything has been touched or clicked. After that every pointer
// event re-decides, and React re-renders through the hook below.
type PointerMode = "coarse" | "fine";

const listeners = new Set<() => void>();
let mode: PointerMode = "fine";

function apply(next: PointerMode) {
  if (next === mode) return;
  mode = next;
  // CSS reads the same answer off the root element, since a media query has no
  // way to know which input was used last.
  document.documentElement.dataset.pointer = next;
  for (const l of listeners) l();
}

if (typeof window !== "undefined") {
  const query = window.matchMedia?.("(pointer: coarse)");
  mode = query?.matches ? "coarse" : "fine";
  document.documentElement.dataset.pointer = mode;

  // Plugging a mouse in or unplugging it changes the answer even when nothing
  // has been pressed yet.
  query?.addEventListener?.("change", (e) => apply(e.matches ? "coarse" : "fine"));

  // Capture, so this settles before any handler that asks which mode we are in.
  window.addEventListener(
    "pointerdown",
    (e) => apply(e.pointerType === "mouse" ? "fine" : "coarse"),
    { capture: true, passive: true },
  );
}

/** Live read, for frame loops and event handlers outside React's render. */
export function isCoarsePointer(): boolean {
  return mode === "coarse";
}

/** Render-time read that re-renders the component when the input changes. */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => mode === "coarse",
    () => false,
  );
}
