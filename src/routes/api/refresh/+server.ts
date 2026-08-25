import type { RequestHandler } from './$types';
import { listProjects } from '$lib/server/data';
import { runExtract, rebuilding } from '$lib/server/freshness';

// On-demand graph rebuild, triggered by the viewer's ↻ button. Page load rebuilds by itself
// when the graph is behind the checkout; this is for forcing one when it is not — after an
// uncommitted edit, say, which no commit comparison can see.
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
  if (rebuilding()) return json({ error: 'already rebuilding' }, 429);
  return (await runExtract(project)) ? json({ ok: true }) : json({ error: 'extract failed' }, 500);
};
