// Keeping the served graph in step with the code it describes.
//
// The viewer used to serve whatever JSON was last written, so a graph could be days behind
// the checkout and nothing said so — the same failure the audit ledger guards against, one
// layer up. The extract records the commit it was built from, which makes the check exact
// and cheap: one `git rev-parse` per page load, and a rebuild only when it actually differs.
//
// A rebuild is NOT triggered on a timer or a watcher. Page load is the only moment the
// answer is about to be looked at, so it is the only moment worth spending CPU on.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { loadGraph } from './data';

interface RegEntry {
  name: string;
  path?: string;
  kind?: string;
}

function registry(): RegEntry[] {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'projects.json'), 'utf8')).projects ?? [];
  } catch {
    return [];
  }
}

/** HEAD of a project's checkout, or null when it has no path, is not git, or is not code. */
function headOf(project: string): string | null {
  const entry = registry().find((p) => p.name === project);
  if (!entry?.path || entry.kind === 'filesystem') return null;
  const cwd = path.resolve(process.cwd(), entry.path);
  if (!fs.existsSync(cwd)) return null;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', timeout: 4000 }).trim();
  } catch {
    return null;
  }
}

/**
 * Whether the stored graph describes a different revision than the checkout is on.
 * Unknown (no git, no stamp, a filesystem project) counts as fresh — a graph that cannot
 * be checked must not rebuild on every single page load.
 */
export function isStale(project: string): boolean {
  const head = headOf(project);
  if (!head) return false;
  const g = loadGraph(project) as { commit?: string; dirty?: boolean } | null;
  if (!g || !g.commit) return false;
  return g.commit !== head;
}

// One rebuild at a time, process-wide. Concurrent page loads await the SAME run rather than
// starting a second extraction over the first one's output.
let inFlight: Promise<boolean> | null = null;

export function runExtract(project: string): Promise<boolean> {
  if (inFlight) return inFlight;
  inFlight = new Promise<boolean>((resolve) => {
    // process.execPath = the node running this server, so the rebuild works regardless of
    // PATH (e.g. under a systemd unit).
    const child = spawn(process.execPath, ['bin/codegraph.mjs', 'extract', project], {
      cwd: process.cwd(),
      stdio: 'inherit'
    });
    child.on('exit', (c: number | null) => resolve(c === 0));
    child.on('error', () => resolve(false));
  }).finally(() => {
    inFlight = null;
  }) as Promise<boolean>;
  return inFlight;
}

export const rebuilding = () => inFlight !== null;

/**
 * Bring a project's graph up to date if it is behind, and report what happened so the page
 * can say "this is stale and the rebuild failed" instead of quietly serving old data.
 */
export async function ensureFresh(
  project: string | null
): Promise<{ rebuilt: boolean; stale: boolean }> {
  if (!project || !isStale(project)) return { rebuilt: false, stale: false };
  const ok = await runExtract(project);
  // Still behind after a rebuild that reported success means the extract wrote a graph for
  // some other revision; treat it as stale rather than trusting the exit code.
  return { rebuilt: ok, stale: !ok || isStale(project) };
}
