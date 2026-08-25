import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

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
  },
  test: {
    include: ['test/*.test.ts'],
    // The fixture project ships its own .test.ts — it is input to the extractor, not a test
    // for this repo, and its tsconfig deliberately extends a file that is not there.
    exclude: ['test/fixtures/**'],
    // The extractor tests spawn a real extraction over the fixture project.
    testTimeout: 60_000,
    // Several tests chdir into a temp workspace, which is process-wide state.
    fileParallelism: false
  }
});
