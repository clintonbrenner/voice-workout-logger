/**
 * Phone features: haptic taps, keeping the screen awake, and getting the
 * microphone prompt out of the way at the start of a workout.
 */

// ---------- Haptics ----------
// Android: navigator.vibrate. iPhone Safari ignores that, but since iOS 18 tapping a
// "switch" checkbox gives a tiny haptic click — so we keep a hidden one and tap it.
let hapticLabel: HTMLLabelElement | null = null;

export function haptic(): void {
  try {
    if (navigator.vibrate?.(15)) return;
  } catch {
    /* ignore */
  }
  if (!hapticLabel) {
    hapticLabel = document.createElement('label');
    hapticLabel.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none';
    hapticLabel.ariaHidden = 'true';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    hapticLabel.appendChild(input);
    document.body.appendChild(hapticLabel);
  }
  hapticLabel.click();
}

// ---------- Screen wake lock ----------
let wantAwake = false;
let sentinel: WakeLockSentinel | null = null;

export async function keepScreenAwake(on: boolean): Promise<void> {
  wantAwake = on;
  if (!on) {
    await sentinel?.release().catch(() => {});
    sentinel = null;
    return;
  }
  if (!('wakeLock' in navigator) || sentinel) return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => (sentinel = null));
  } catch {
    /* not allowed right now (e.g. low battery mode) */
  }
}
// iOS drops the lock when the app is backgrounded; take it back on return.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wantAwake) void keepScreenAwake(true);
});

// ---------- Microphone warm-up ----------
/** Triggers the mic permission prompt now (at "Start workout"), then lets go of the mic. */
export async function warmUpMic(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return true;
  } catch {
    return false;
  }
}

export const isStandalone =
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as unknown as { standalone?: boolean }).standalone === true;
