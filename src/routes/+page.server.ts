import type { PageServerLoad } from './$types';
import { listProjects, loadGraph, listMachines, machineOf } from '$lib/server/data';

export const load: PageServerLoad = ({ url }) => {
  const projects = listProjects();
  const machines = listMachines();
  const current = url.searchParams.get('project') ?? projects[0] ?? null;
  const graph = current ? loadGraph(current) : null;
  const currentMachine = machineOf(current, machines);
  return { projects, machines, current, currentMachine, graph };
};
