import type { PageServerLoad } from './$types';
import { listProjects, loadGraph, listMachines, machineOf } from '$lib/server/data';
import { ensureFresh } from '$lib/server/freshness';

export const load: PageServerLoad = async ({ url }) => {
  const projects = listProjects();
  const current = url.searchParams.get('project') ?? projects[0] ?? null;
  // Rebuild before reading, not after: a page that renders the old graph and then corrects
  // itself has already been believed. `ensureFresh` is a no-op unless the stored graph names
  // a different commit than the checkout is on, or a source file has been touched since it
  // was built.
  const { rebuilt, stale } = await ensureFresh(current);
  const machines = listMachines();
  const graph = current ? loadGraph(current) : null;
  const currentMachine = machineOf(current, machines);
  return { projects, machines, current, currentMachine, graph, rebuilt, stale };
};
