import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import type { RawGraph } from '$lib/graph/types';

const DATA = path.resolve(process.cwd(), 'data');

export function listProjects(): string[] {
  if (!fs.existsSync(DATA)) return [];
  return fs
    .readdirSync(DATA)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.snapshot.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

export function loadGraph(name: string): RawGraph | null {
  const file = path.join(DATA, `${name}.json`);
  if (!listProjects().includes(name) || !fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

interface RegEntry {
  name: string;
  machine?: string;
  kind?: string;
  tsHost?: string; // tailscale hostname, for live reachability
}
export type MachineStatus = 'online' | 'cached' | 'offline';
export interface MachineNav {
  name: string; // machine name (laptop, ubuntuserver…)
  all: string | null; // the filesystem "all" graph for the whole machine
  projects: string[]; // code projects that live on this machine
  tsHost: string | null;
  status: MachineStatus; // online = tailscale-reachable; cached = indexed but not reachable
  indexedAt: string | null; // generatedAt of the machine's "all" graph
}

/** Hostnames tailscale reports as currently online (Self + peers). null = tailscale unavailable. */
function onlineHosts(): Set<string> | null {
  try {
    const j = JSON.parse(execSync('tailscale status --json', { timeout: 2500, stdio: ['ignore', 'pipe', 'ignore'] }).toString());
    const on = new Set<string>();
    if (j.Self?.Online && j.Self?.HostName) on.add(j.Self.HostName);
    for (const k in j.Peer ?? {}) if (j.Peer[k]?.Online && j.Peer[k]?.HostName) on.add(j.Peer[k].HostName);
    return on;
  } catch {
    return null; // no tailscale (e.g. cloud/headless) — fall back to cached
  }
}

/**
 * Group the available graphs into a two-level nav: machines, each with a
 * whole-machine "all" (filesystem) view + the code projects that live on it.
 * Metadata comes from projects.json; a graph with no registry entry falls back
 * to being its own single-project machine so nothing disappears.
 */
export function listMachines(): MachineNav[] {
  const avail = listProjects();
  let reg: RegEntry[] = [];
  try {
    reg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'projects.json'), 'utf8')).projects ?? [];
  } catch {
    /* no registry — everything falls back below */
  }
  const meta = new Map(reg.map((p) => [p.name, p]));

  // A hostname is what a machine calls itself; the registry may know it by a friendlier
  // name through the tsHost of its filesystem entry (cachyos-x8664 → laptop). Resolve to
  // that label when one exists so the same machine is never listed twice under two names.
  const label = (host: string) =>
    reg.find((p) => p.tsHost === host || p.machine === host)?.machine ?? host;
  const byMachine = new Map<string, MachineNav>();
  const tsHostOf = new Map<string, string>(); // machine → tailscale host (from its fs entry)
  for (const name of avail) {
    const m = meta.get(name);
    const isFs = m?.kind === 'filesystem';
    // A filesystem graph is ABOUT a machine, so the registry names which one. A code
    // graph is extracted from a local path, so it belongs to whichever machine built
    // it — read from the graph, or this host when the graph predates the stamp. Taking
    // it from the registry instead is what made a checkout on the server report itself
    // as being on the laptop.
    const machine = isFs
      ? (m?.machine ?? name)
      : label((loadGraph(name) as { host?: string } | null)?.host ?? os.hostname());
    let node = byMachine.get(machine);
    if (!node) {
      node = { name: machine, all: null, projects: [], tsHost: null, status: 'cached', indexedAt: null };
      byMachine.set(machine, node);
    }
    if (isFs) {
      node.all = name;
      const g = loadGraph(name);
      node.indexedAt = g?.generatedAt ?? null;
    } else node.projects.push(name);
    if (m?.tsHost) tsHostOf.set(machine, m.tsHost);
  }
  const online = onlineHosts();
  const here = label(os.hostname());
  for (const node of byMachine.values()) {
    node.tsHost = tsHostOf.get(node.name) ?? null;
    // The machine serving this page is reachable by definition — it does not need
    // tailscale's opinion, and asking for one marks it offline whenever it has no
    // filesystem entry to carry a tsHost.
    if (node.name === here) node.status = 'online';
    // Otherwise online only when tailscale confirms reachability; else a cached index.
    else if (online && node.tsHost) node.status = online.has(node.tsHost) ? 'online' : 'cached';
    else node.status = node.all ? 'cached' : 'offline';
  }
  return [...byMachine.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Which machine a given project belongs to (for highlighting the active tab). */
export function machineOf(project: string | null, machines: MachineNav[]): string | null {
  if (!project) return machines[0]?.name ?? null;
  for (const m of machines) if (m.all === project || m.projects.includes(project)) return m.name;
  return machines[0]?.name ?? null;
}
