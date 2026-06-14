import type { RequestHandler } from './$types';
import { listProjects, loadGraph } from '$lib/server/data';
import { createApi } from '$lib/server/query';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'no-store'
};

export const OPTIONS: RequestHandler = () => new Response(null, { status: 204, headers: CORS });

export const GET: RequestHandler = ({ params, url }) => {
  const projects = listProjects();
  // ?project= selects which graph; defaults to the first.
  const project = url.searchParams.get('project') ?? projects[0];
  const graph = project ? loadGraph(project) : null;
  if (!graph) {
    return json({ error: 'no graph — run `node bin/codegraph.mjs extract`', projects }, 503);
  }
  const { dispatch } = createApi(graph);
  const { status, body } = dispatch('/' + (params.path ?? ''), url.searchParams);
  return json(body, status);
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS }
  });
}
