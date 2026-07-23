// Touch-primary devices (iPad, phone) have no hover state and need hit
// targets suited to a fingertip rather than a cursor. Checked live rather
// than cached, since a device can gain a trackpad mid-session.
export function isCoarsePointer(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}
