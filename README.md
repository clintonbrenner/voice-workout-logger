# Lift Log: Voice Workout Logger

A phone-first web app. Hold the big button, say "bench, 185, 8 reps", and it logs the set.

**Live app:** https://clintonbrenner.github.io/voice-workout-logger/

**Current state: Milestone 3.** Workout tab (exercise menu, voice logging with a confirmation
card, Edit/Undo, manual add), Plan tab (one-tap paste import, review, nicknames, settings).
Everything is stored on your phone. History/export and Progress charts come next.

Every `git push` to `main` runs the tests and republishes the site automatically.

### Testing voice on a PC
With `npm run dev` open in a browser, type this into the browser console to simulate speaking:
`simulateVoice("hammer curls 30 for 12")`

### Running the tests
```powershell
npm test
```

---

## One-time setup on your Windows PC

1. **Install Node.js (LTS).** Open PowerShell and run:
   ```powershell
   winget install OpenJS.NodeJS.LTS
   ```
   Then **close PowerShell and open a new window** so it can find `node`.
   Check it worked: `node --version` should print something like `v24.x`.

2. **Install Cloudflare's tunnel tool.** This gives your PC a temporary `https://` web address your
   iPhone can open. The microphone only works over HTTPS. It's free, and you don't need an account.
   ```powershell
   winget install Cloudflare.cloudflared
   ```
   Open a new PowerShell window again afterwards.

3. **Install the project's libraries.** In PowerShell, inside this project folder:
   ```powershell
   npm install
   ```

## Testing on your iPhone (every time)

You need **two** PowerShell windows, both in the project folder:

- **Window 1** runs the app:
  ```powershell
  npm run dev
  ```
- **Window 2** opens the HTTPS tunnel:
  ```powershell
  npm run tunnel
  ```
  After a few seconds it prints an address like `https://random-words-here.trycloudflare.com`.

On your iPhone:

1. Open that `https://…trycloudflare.com` address in **Safari**.
2. **Test A (Safari tab):** hold the blue button, say "bench 185 for 8", then release.
   Allow the microphone and speech prompts when asked. The words should appear on screen.
3. **Test B (Home Screen):** tap Share → **Add to Home Screen** → Add. Open it from the new icon.
   The panel at the top should say **Launched from: Home Screen**. Try the button again.
4. In both modes, also open **Event log** and tap **Test raw mic recording**. This checks the backup
   plan: record audio and transcribe it in the cloud.

The tunnel address changes every time you restart `npm run tunnel`. If it changes, delete the old
Home Screen icon and add it again.

### If it doesn't work
- **"Speech recognition: NOT available"** or error `service-not-allowed`: on the iPhone, go to
  Settings → General → Keyboard and turn on **Enable Dictation**. Also make sure Siri isn't
  restricted in Screen Time.
- **Error `not-allowed`**: Settings → Apps → Safari → Microphone → Allow (or Ask).
- **The page won't load through the tunnel:** make sure Window 1 (`npm run dev`) is still running.

### What to send me after testing
Take a screenshot of the diagnostics panel and transcript in **both** modes (Safari tab and Home
Screen). Also tell me:
- Did the transcript match what you said?
- Roughly how long after you released the button did it appear?
- Did iOS ask for mic permission again every time you opened the Home Screen app?

---

## Deployment (milestone 6, preview)
We'll put it on **GitHub Pages** (free, HTTPS, permanent address). You'll get full step-by-step
instructions then.

## Project layout
```
index.html               page shell (Home Screen meta tags live here)
public/manifest.webmanifest   makes "Add to Home Screen" open full-screen
src/main.ts              spike UI logic: button, diagnostics, log
src/speech/types.ts      the SpeechEngine interface (swap engines without touching the UI)
src/speech/webSpeech.ts  Safari's built-in speech recognition behind that interface
src/data/presets.ts      built-in workouts (Arms), shown in milestone 3
test/fixtures/           sample pasted plans, used to test the importer
```
