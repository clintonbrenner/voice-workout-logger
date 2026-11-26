/**
 * Sends the Diagnostics log to your own Google Sheet (via a small Apps Script
 * web app you deploy once), so it can be read without copy/paste.
 *
 * - Off until you paste the script's web-app link in Plan → Diagnostics.
 * - Sends new lines every 20 seconds, and right away when you leave the app.
 * - Only debug lines are sent (timings, errors, what was heard) — never your
 *   workout history. The link is stored only on this phone.
 */
import { isStandalone } from './device';

const URL_KEY = 'liftlog.logUrl';
const LAST_KEY = 'liftlog.logLastSent';

let queue: { t: string; msg: string }[] = [];

export function logUrl(): string {
  return localStorage.getItem(URL_KEY) ?? '';
}

export function lastSent(): string {
  return localStorage.getItem(LAST_KEY) ?? '';
}

/** Accepts the Apps Script web-app link ("https://script.google.com/macros/s/…/exec"). */
export function setLogUrl(url: string): boolean {
  const clean = url.trim();
  if (!/^https:\/\/script\.google(usercontent)?\.com\/.+/.test(clean)) return false;
  localStorage.setItem(URL_KEY, clean);
  return true;
}

export function clearLogUrl(): void {
  localStorage.removeItem(URL_KEY);
  queue = [];
}

/** Called for every Diagnostics log line. */
export function enqueueLog(msg: string): void {
  if (!logUrl()) return;
  queue.push({ t: new Date().toLocaleString(), msg });
  if (queue.length > 500) queue = queue.slice(-500);
}

export function flushLog(): void {
  const url = logUrl();
  if (!url || queue.length === 0) return;
  const lines = queue;
  queue = [];
  const body = JSON.stringify({
    version: __APP_VERSION__,
    mode: `${isStandalone ? 'Home Screen' : 'Browser'} · ${navigator.userAgent.match(/Version\/[\d.]+/)?.[0] ?? ''}`,
    lines,
  });
  // "no-cors" + plain text: the simple kind of request Google Apps Script accepts
  // from a web page. We can't read the reply, so success is assumed.
  fetch(url, { method: 'POST', mode: 'no-cors', body, headers: { 'Content-Type': 'text/plain' }, keepalive: true })
    .then(() => localStorage.setItem(LAST_KEY, new Date().toLocaleTimeString()))
    .catch(() => {
      // Offline or failed: put the lines back for next time.
      queue = [...lines, ...queue].slice(-500);
    });
}

setInterval(flushLog, 20_000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushLog();
});
