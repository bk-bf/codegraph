// Run the real extractor over a project directory and hand back the graph it wrote.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { RawGraph } from '../src/lib/graph/types';

export const REPO = resolve(__dirname, '..');
export const FIXTURE = join(REPO, 'test/fixtures/tsproj');

export function extractProject(project: string): { graph: RawGraph; stderr: string } {
  const out = join(mkdtempSync(join(tmpdir(), 'cg-')), 'graph.json');
  // The extractor reports on stderr and writes the graph to CG_OUT.
  const r = spawnSync(process.execPath, ['src/lib/core/extract.mjs'], {
    cwd: REPO,
    encoding: 'utf8',
    env: { ...process.env, CG_PROJECT: project, CG_OUT: out }
  });
  if (r.status !== 0) throw new Error(`extract exited ${r.status}: ${r.stderr}`);
  return { graph: JSON.parse(readFileSync(out, 'utf8')), stderr: r.stderr };
}
