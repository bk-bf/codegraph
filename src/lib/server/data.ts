import fs from 'node:fs';
import path from 'node:path';
import type { RawGraph } from '$lib/graph/types';

const DATA = path.resolve(process.cwd(), 'data');

export function listProjects(): string[] {
  if (!fs.existsSync(DATA)) return [];
  return fs
    .readdirSync(DATA)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

export function loadGraph(name: string): RawGraph | null {
  const file = path.join(DATA, `${name}.json`);
  if (!listProjects().includes(name) || !fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
