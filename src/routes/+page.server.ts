import fs from 'node:fs';
import path from 'node:path';
import type { PageServerLoad } from './$types';
import type { RawGraph } from '$lib/graph/types';

const DATA = path.resolve(process.cwd(), 'data');

export const load: PageServerLoad = ({ url }) => {
  const files = fs.existsSync(DATA) ? fs.readdirSync(DATA).filter((f) => f.endsWith('.json')) : [];
  const projects = files.map((f) => f.replace(/\.json$/, '')).sort();
  const current = url.searchParams.get('project') ?? projects[0] ?? null;

  let graph: RawGraph | null = null;
  if (current && projects.includes(current)) {
    graph = JSON.parse(fs.readFileSync(path.join(DATA, `${current}.json`), 'utf8'));
  }
  return { projects, current, graph };
};
