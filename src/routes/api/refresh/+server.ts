import type { RequestHandler } from './$types';
import { spawn } from 'node:child_process';
import { listProjects } from '$lib/server/data';

// On-demand graph rebuild, triggered by the viewer's ↻ Refresh button. Runs one
// extraction (no background watcher) so re-analysis only happens when asked —
// it doesn't compete with playtesting/profiling for CPU.
let extracting = false;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export const POST: RequestHandler = async ({ url }) => {
  const projects = listProjects();
  const project = url.searchParams.get('project') ?? projects[0];
  if (!project || !projects.includes(project)) return json({ error: 'unknown project' }, 400);
  if (extracting) return json({ error: 'already rebuilding' }, 429);

  extracting = true;
  try {
    const code = await new Promise<number>((resolve) => {
      // process.execPath = the node binary running this server, so the rebuild
      // works regardless of PATH (e.g. under a systemd unit).
      const child = spawn(process.execPath, ['bin/codegraph.mjs', 'extract', project], {
        cwd: process.cwd(),
        stdio: 'inherit'
      });
      child.on('exit', (c) => resolve(c ?? 1));
      child.on('error', () => resolve(1));
    });
    return code === 0 ? json({ ok: true }) : json({ error: 'extract failed' }, 500);
  } finally {
    extracting = false;
  }
};
