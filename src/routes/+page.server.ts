import type { PageServerLoad } from './$types';
import { listProjects, loadGraph } from '$lib/server/data';

export const load: PageServerLoad = ({ url }) => {
  const projects = listProjects();
  const current = url.searchParams.get('project') ?? projects[0] ?? null;
  const graph = current ? loadGraph(current) : null;
  return { projects, current, graph };
};
