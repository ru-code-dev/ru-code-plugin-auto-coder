interface DesktopWindow {
  desktopBridge?: unknown;
  nativeApi?: unknown;
}
export const isElectron =
  typeof window !== "undefined" &&
  ((window as DesktopWindow).desktopBridge !== undefined ||
    (window as DesktopWindow).nativeApi !== undefined);
