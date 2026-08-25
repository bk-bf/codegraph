import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// Vite refuses a request whose Host header it does not know, so serving the viewer behind a
// reverse proxy needs the proxied name declared. It stays opt-in via the environment: a local
// `pnpm dev` keeps Vite's default (localhost only, nothing else accepted), and only a deployment
// that is actually fronted by a proxy names the host it answers to.
const allowed = (process.env.CODEGRAPH_ALLOWED_HOST ?? '')
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean);

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    port: 5185,
    strictPort: true,
    ...(allowed.length ? { allowedHosts: allowed } : {})
  }
});
