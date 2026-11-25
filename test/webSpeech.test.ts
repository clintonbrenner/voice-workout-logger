/**
 * Checks the speech engine with a fake Safari recognizer:
 * several clips in a row must each deliver their own transcript.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { WebSpeechEngine } from '../src/speech/webSpeech';

type Handler = ((e?: unknown) => void) | null;

/** Behaves like Safari: start() while running throws; events are fired by the test. */
class FakeRecognizer {
  static instances: FakeRecognizer[] = [];
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  running = false;
  starts = 0;
  onstart: Handler = null;
  onaudiostart: Handler = null;
  onspeechstart: Handler = null;
  onspeechend: Handler = null;
  onresult: Handler = null;
  onerror: Handler = null;
  onend: Handler = null;
  constructor() {
    FakeRecognizer.instances.push(this);
  }
  start() {
    if (this.running) throw Object.assign(new Error('already started'), { name: 'InvalidStateError' });
    this.running = true;
    this.starts++;
    this.onstart?.();
    this.onaudiostart?.();
  }
  stop() {
    this.end();
  }
  abort() {
    this.end();
  }
  say(text: string) {
    const result = Object.assign([{ transcript: text, confidence: 1 }], { isFinal: true });
    this.onresult?.({ resultIndex: 0, results: [result] });
  }
  end() {
    if (!this.running) return;
    this.running = false;
    this.onend?.();
  }
}

describe('WebSpeechEngine — consecutive clips', () => {
  let heard: string[];
  let engine: WebSpeechEngine;

  beforeEach(() => {
    FakeRecognizer.instances = [];
    (globalThis as unknown as { window: unknown }).window = { webkitSpeechRecognition: FakeRecognizer };
    heard = [];
    engine = new WebSpeechEngine();
    engine.handlers = { onFinal: (t) => heard.push(t) };
  });

  it('three clips in a row each deliver their own words, reusing one recognizer', () => {
    for (const text of ['bench 185 for 8', 'same weight 7 reps', '185 for 6']) {
      engine.start();
      FakeRecognizer.instances.at(-1)!.say(text);
      engine.stop();
    }
    expect(heard).toEqual(['bench 185 for 8', 'same weight 7 reps', '185 for 6']);
    expect(FakeRecognizer.instances).toHaveLength(1);
    expect(FakeRecognizer.instances[0].starts).toBe(3);
  });

  it('pressing again before the last clip finished still works', () => {
    engine.start();
    FakeRecognizer.instances[0].say('bench 185 for 8');
    // no stop/end yet — second press
    engine.start();
    FakeRecognizer.instances.at(-1)!.say('squat 225 for 5');
    engine.stop();
    expect(heard.at(-1)).toBe('squat 225 for 5');
  });

  it('a recognizer that ended on its own still hands over its words on release', () => {
    engine.start();
    const rec = FakeRecognizer.instances[0];
    rec.say('curl 30 for 12');
    rec.end(); // Safari stopped by itself (e.g. long pause)
    engine.stop();
    expect(heard).toEqual(['curl 30 for 12']);
  });
});
