import { defineConfig } from 'vite';

// Dev server settings so your iPhone can reach the app.
// - host: true      → listen on your Wi-Fi address, not just this PC
// - allowedHosts    → accept requests that come through a Cloudflare quick tunnel
//                     (that's how we get real HTTPS, which the mic requires)
//
// base: GitHub Pages serves the site from /voice-workout-logger/, so production
// builds need that prefix. During development (npm run dev) it stays at '/'.
//
// VERSION: a timestamp baked into each build. The app shows it under Plan →
// Diagnostics, and compares it with /version.json to spot updates.
const VERSION = new Date().toISOString().slice(0, 16).replace('T', ' ');

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/voice-workout-logger/' : '/',
  define: { __APP_VERSION__: JSON.stringify(VERSION) },
  plugins: [
    {
      name: 'version-json',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: VERSION }) });
      },
    },
  ],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts: ['.trycloudflare.com'],
  },
}));
