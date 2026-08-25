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

/** Paths git reports as modified, added, renamed or untracked, relative to the checkout. */
function changedPaths(cwd: string): string[] {
  try {
    const out = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8', timeout: 4000 });
    return out
      .split('\n')
      .filter(Boolean)
      .map((l) => l.slice(3).trim())
      .map((p) => (p.includes(' -> ') ? p.slice(p.indexOf(' -> ') + 4) : p))
      .map((p) => p.replace(/^"|"$/g, ''));
  } catch {
    return [];
  }
}

/**
 * Whether the stored graph describes a different revision than the checkout is on.
 * Unknown (no git, no stamp, a filesystem project) counts as fresh — a graph that cannot
 * be checked must not rebuild on every single page load.
 *
 * The commit is not the whole answer: most editing happens before a commit, and while the
 * tree is dirty HEAD keeps matching, so a commit-only check serves a graph that predates
 * every uncommitted edit and calls it fresh. Uncommitted source files are therefore checked
 * by mtime against the moment the graph was built.
 */
export function isStale(project: string): boolean {
  const entry = registry().find((p) => p.name === project);
  const head = headOf(project);
  if (!head || !entry?.path) return false;
  const g = loadGraph(project) as
    | { commit?: string; dirty?: boolean; generatedAt?: string; files?: { file: string }[] }
    | null;
  if (!g || !g.commit) return false;
  if (g.commit !== head) return true;

  const cwd = path.resolve(process.cwd(), entry.path);
  const changed = changedPaths(cwd);
  // Built over edits that have since been reverted: same commit, clean tree, but the graph
  // describes code that is no longer there.
  if (g.dirty && changed.length === 0) return true;
  if (!changed.length || !g.generatedAt) return false;

  const built = Date.parse(g.generatedAt);
  if (Number.isNaN(built)) return false;
  const known = new Set((g.files ?? []).map((f) => f.file));
  // Extensions the graph actually covers, so a changed README never costs a 13 s rebuild.
  const exts = new Set([...known].map((f) => f.slice(f.lastIndexOf('.'))));
  for (const p of changed) {
    if (!known.has(p) && !exts.has(p.slice(p.lastIndexOf('.')))) continue;
    try {
      if (fs.statSync(path.join(cwd, p)).mtimeMs > built) return true;
    } catch {
      // deleted since the graph was built — the node set is wrong either way
      return true;
    }
  }
  return false;
}

// One rebuild at a time PER PROJECT. Concurrent page loads for the same project await the
// SAME run rather than starting a second extraction over the first one's output; a load for a
// different project starts its own, because sharing one promise across projects hands the
// second caller the first project's result and its graph is never rebuilt.
const inFlight = new Map<string, Promise<boolean>>();

export function runExtract(project: string): Promise<boolean> {
  const running = inFlight.get(project);
  if (running) return running;
  const p = new Promise<boolean>((resolve) => {
    // process.execPath = the node running this server, so the rebuild works regardless of
    // PATH (e.g. under a systemd unit).
    const child = spawn(process.execPath, ['bin/codegraph.mjs', 'extract', project], {
      cwd: process.cwd(),
      stdio: 'inherit'
    });
    child.on('exit', (c: number | null) => resolve(c === 0));
    child.on('error', () => resolve(false));
  }).finally(() => {
    inFlight.delete(project);
  }) as Promise<boolean>;
  inFlight.set(project, p);
  return p;
}

export const rebuilding = (project?: string) =>
  project ? inFlight.has(project) : inFlight.size > 0;

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
