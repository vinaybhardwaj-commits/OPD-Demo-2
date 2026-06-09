/**
 * Pure, unit-testable platform detection. Kept free of `navigator` access so
 * the core logic can be tested directly; `detectIOS()` is the thin runtime
 * wrapper used by client components.
 *
 * iOS/WebKit matters because MediaRecorder + a WebAudio worklet can't share
 * one mic track there (B18), and Private Browsing disables IndexedDB.
 */
export function isIOSUserAgent(ua: string, platform = "", maxTouchPoints = 0): boolean {
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ reports as desktop Mac but has a touchscreen.
  return platform === "MacIntel" && maxTouchPoints > 1;
}

export function detectIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return isIOSUserAgent(navigator.userAgent || "", navigator.platform || "", navigator.maxTouchPoints || 0);
}

/**
 * Desktop Safari (WebKit on macOS), excluding iOS (handled by isIOSUserAgent)
 * and Chromium/Chrome/Firefox/Edge which all ship "Safari" in their UA. Used to
 * optionally extend the B18 dual-consumer streaming guard to desktop Safari.
 */
export function isDesktopSafariUserAgent(ua: string, platform = "", maxTouchPoints = 0): boolean {
  if (isIOSUserAgent(ua, platform, maxTouchPoints)) return false; // iOS handled separately
  const isSafari = /Safari\//.test(ua) && /Version\//.test(ua);
  const isOtherEngine = /Chrome|Chromium|CriOS|Edg|EdgiOS|OPR|Firefox|FxiOS|Android/.test(ua);
  return isSafari && !isOtherEngine;
}

export function detectDesktopSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  return isDesktopSafariUserAgent(navigator.userAgent || "", navigator.platform || "", navigator.maxTouchPoints || 0);
}
