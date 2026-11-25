/**
 * The speech-to-text "contract" the rest of the app talks to.
 *
 * Today the only implementation is Safari's built-in webkitSpeechRecognition
 * (see webSpeech.ts). Later we can add a second one that records an audio clip
 * and sends it to a cloud service (e.g. Whisper) — the UI won't need to change,
 * because it only ever uses this interface.
 */
export interface SpeechEngine {
  /** Human-readable name, shown in diagnostics. */
  readonly name: string;
  /** True if this engine can run on this device/browser right now. */
  isSupported(): boolean;
  /** Begin listening. MUST be called directly from a tap/press handler on iOS. */
  start(): void;
  /** Stop listening; the final transcript arrives via onFinal shortly after. */
  stop(): void;
  /** Throw away anything heard so far. */
  abort(): void;
  /** Callbacks — set these before calling start(). */
  handlers: SpeechHandlers;
}

export interface SpeechHandlers {
  /** Partial text while you're still talking (may change). */
  onInterim?: (text: string) => void;
  /** The finished transcript for one clip ('' if nothing was heard). */
  onFinal?: (text: string) => void;
  /** Something went wrong (permission denied, no network, etc.). */
  onError?: (code: string, message: string) => void;
  /** Low-level lifecycle events, for the debug log. */
  onEvent?: (name: string) => void;
}
