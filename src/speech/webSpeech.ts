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

  /*
   * ONE recognizer, reused for every clip. iPhone Safari can keep the microphone
   * tied to a finished recognizer, so making a new one per clip meant only the
   * first clip worked. We only build a new one if Safari refuses to restart.
   */
  private rec: SR | null = null;
  /** True between start() and Safari's "end" event. */
  private running = false;
  /** Final text pieces collected during the current clip. */
  private finalParts: string[] = [];
  /** Latest interim text (used if we stop before Safari marks it final). */
  private lastInterim = '';
  private delivered = true;
  private clip = 0;

  isSupported(): boolean {
    return !!getCtor();
  }

  private create(Ctor: SRConstructor): SR {
    const rec = new Ctor();
    rec.lang = 'en-US';
    rec.continuous = true;      // keep listening through short pauses while the button is held
    rec.interimResults = true;  // show words live as you speak
    rec.maxAlternatives = 1;
    // Ignore late events from a recognizer we've already replaced.
    const mine = (fn: () => void) => () => {
      if (rec === this.rec) fn();
    };
    rec.onstart = mine(() => this.handlers.onEvent?.('start'));
    rec.onaudiostart = mine(() => this.handlers.onEvent?.('audiostart'));
    rec.onspeechstart = mine(() => this.handlers.onEvent?.('speechstart'));
    rec.onspeechend = mine(() => this.handlers.onEvent?.('speechend'));
    rec.onresult = (e) => {
      if (rec !== this.rec) return;
      this.onResult(e);
    };
    rec.onerror = (e) => {
      if (rec !== this.rec) return;
      this.handlers.onEvent?.(`error: ${e.error}`);
      // "no-speech" and "aborted" are normal when you release quickly — not real errors.
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        this.delivered = true; // don't let the following "end" event overwrite the error message
        this.handlers.onError?.(e.error, e.message || e.error);
      }
    };
    rec.onend = () => {
      if (rec !== this.rec) return;
      this.running = false;
      this.handlers.onEvent?.('end');
      this.deliver();
    };
    return rec;
  }

  start(): void {
    const Ctor = getCtor();
    if (!Ctor) {
      this.handlers.onError?.('unsupported', 'Speech recognition is not available in this browser/mode.');
      return;
    }
    this.clip++;
    this.handlers.onEvent?.(`clip ${this.clip}: starting${this.rec ? ' (reusing recognizer)' : ''}`);
    // Previous clip still winding down? Drop it so its late result can't land on this one.
    if (this.running && this.rec) {
      this.handlers.onEvent?.('previous clip still running → aborting it');
      const old = this.rec;
      this.rec = null; // its events are ignored from now on
      old.abort();
      this.running = false;
    }
    this.finalParts = [];
    this.lastInterim = '';
    this.delivered = false;

    this.rec ??= this.create(Ctor);
    try {
      this.rec.start();
      this.running = true;
    } catch (err) {
      // Safari refused to restart this one: build a fresh recognizer and try once more.
      this.handlers.onEvent?.(`restart refused (${(err as Error).name}) → new recognizer`);
      this.rec = this.create(Ctor);
      try {
        this.rec.start();
        this.running = true;
      } catch (err2) {
        this.handlers.onError?.('start-failed', (err2 as Error).message);
      }
    }
  }

  private onResult(e: SREvent): void {
    {
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
    }
  }

  stop(): void {
    // stop() asks Safari to finish processing and fire a last "result" + "end".
    if (this.running) this.rec?.stop();
    else this.deliver(); // already ended on its own: hand over what we have
  }

  abort(): void {
    this.delivered = true; // suppress onFinal
    if (this.running) this.rec?.abort();
  }

  /** Send the transcript exactly once per clip. */
  private deliver(): void {
    if (this.delivered) return;
    this.delivered = true;
    const text = (this.finalParts.join(' ') + ' ' + this.lastInterim).replace(/\s+/g, ' ').trim();
    this.handlers.onFinal?.(text);
  }
}
