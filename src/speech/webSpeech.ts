import type { SpeechEngine, SpeechHandlers } from './types';

/*
 * Minimal type declarations for the Web Speech API. TypeScript's built-in DOM
 * types don't include it (it's still non-standard), so we describe just the
 * parts we use.
 */
interface SRAlternative { transcript: string; confidence: number }
interface SRResult { isFinal: boolean; length: number; [i: number]: SRAlternative }
interface SRResultList { length: number; [i: number]: SRResult }
interface SREvent extends Event { resultIndex: number; results: SRResultList }
interface SRErrorEvent extends Event { error: string; message: string }
interface SR extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  onaudiostart: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
}
type SRConstructor = new () => SR;

/** Find the constructor — Safari only exposes the "webkit"-prefixed name. */
function getCtor(): SRConstructor | undefined {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition) as SRConstructor | undefined;
}

/**
 * Speech engine backed by the browser's built-in recognizer.
 * On iPhone this uses Apple's dictation service (needs Siri/Dictation enabled).
 */
export class WebSpeechEngine implements SpeechEngine {
  readonly name = 'Web Speech API (webkitSpeechRecognition)';
  handlers: SpeechHandlers = {};

  private rec: SR | null = null;
  /** Final text pieces collected during the current clip. */
  private finalParts: string[] = [];
  /** Latest interim text (used if we stop before Safari marks it final). */
  private lastInterim = '';
  private delivered = false;

  isSupported(): boolean {
    return !!getCtor();
  }

  start(): void {
    const Ctor = getCtor();
    if (!Ctor) {
      this.handlers.onError?.('unsupported', 'Speech recognition is not available in this browser/mode.');
      return;
    }
    // Make a fresh recognizer per clip — Safari is more reliable this way.
    this.rec?.abort();
    const rec = new Ctor();
    rec.lang = 'en-US';
    rec.continuous = true;      // keep listening through short pauses while the button is held
    rec.interimResults = true;  // show words live as you speak
    rec.maxAlternatives = 1;

    this.finalParts = [];
    this.lastInterim = '';
    this.delivered = false;

    rec.onstart = () => this.handlers.onEvent?.('start');
    rec.onaudiostart = () => this.handlers.onEvent?.('audiostart');
    rec.onspeechstart = () => this.handlers.onEvent?.('speechstart');
    rec.onspeechend = () => this.handlers.onEvent?.('speechend');

    rec.onresult = (e) => {
      let interim = '';
      // Rebuild from all results each time; Safari sometimes revises earlier ones.
      const finals: string[] = [];
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finals.push(r[0].transcript);
        else interim += r[0].transcript;
      }
      this.finalParts = finals;
      this.lastInterim = interim;
      this.handlers.onInterim?.((finals.join(' ') + ' ' + interim).trim());
    };

    rec.onerror = (e) => {
      this.handlers.onEvent?.(`error: ${e.error}`);
      // "no-speech" and "aborted" are normal when you release quickly — not real errors.
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        this.delivered = true; // don't let the following "end" event overwrite the error message
        this.handlers.onError?.(e.error, e.message || e.error);
      }
    };

    rec.onend = () => {
      this.handlers.onEvent?.('end');
      this.deliver();
    };

    this.rec = rec;
    rec.start();
  }

  stop(): void {
    // stop() asks Safari to finish processing and fire a last "result" + "end".
    this.rec?.stop();
  }

  abort(): void {
    this.delivered = true; // suppress onFinal
    this.rec?.abort();
    this.rec = null;
  }

  /** Send the transcript exactly once per clip. */
  private deliver(): void {
    if (this.delivered) return;
    this.delivered = true;
    const text = (this.finalParts.join(' ') + ' ' + this.lastInterim).replace(/\s+/g, ' ').trim();
    this.handlers.onFinal?.(text);
    this.rec = null;
  }
}
