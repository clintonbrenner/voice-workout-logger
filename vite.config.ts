import { defineConfig } from 'vite';

// Dev server settings so your iPhone can reach the app.
// - host: true      → listen on your Wi-Fi address, not just this PC
// - allowedHosts    → accept requests that come through a Cloudflare quick tunnel
//                     (that's how we get real HTTPS, which the mic requires)
//
// base: GitHub Pages serves the site from /voice-workout-logger/, so production
// builds need that prefix. During development (npm run dev) it stays at '/'.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/voice-workout-logger/' : '/',
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts: ['.trycloudflare.com'],
  },
}));
