// The extractor, run for real against test/fixtures/tsproj — a project small enough to
// assert every node and edge by hand. Each assertion below stands in for a claim the tool
// makes about a codebase it has never seen.
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RawGraph, GraphNode } from '../src/lib/graph/types';
import { FIXTURE, extractProject as extract } from './helpers';

let graph: RawGraph;
let stderr: string;
const byName = (n: string) => graph.nodes.find((x) => x.name === n) as GraphNode;
const edge = (from: string, to: string) =>
  graph.edges.some((e) => e.from === byName(from)?.id && e.to === byName(to)?.id);

beforeAll(() => {
  const r = extract(FIXTURE);
  graph = r.graph;
  stderr = r.stderr;
});

describe('nodes', () => {
  it('registers every declaration kind the fixture contains', () => {
    expect(byName('clamp').kind).toBe('function');
    expect(byName('Greeter.greet').kind).toBe('method');
    expect(byName('session').kind).toBe('store');
    expect(byName('App').kind).toBe('component');
    expect(byName('dist2').group).toBe('rust');
  });

  it('gives every node a span, so a consumer can attribute a line to it', () => {
    for (const n of graph.nodes) {
      expect(typeof n.endLine, n.id).toBe('number');
      expect(n.endLine, n.id).toBeGreaterThanOrEqual(n.line);
    }
  });

  it('names the declaration a nested function is written inside', () => {
    const bounded = byName('bounded');
    expect(bounded.nested).toBe(true);
    expect(bounded.parent).toBe(byName('clamp').id);
    expect(bounded.line).toBeGreaterThanOrEqual(byName('clamp').line);
    expect(bounded.endLine).toBeLessThanOrEqual(byName('clamp').endLine);
  });

  it('leaves module-scope declarations without a parent', () => {
    expect(byName('clamp').parent).toBeNull();
    expect(byName('greetAll').parent).toBeNull();
  });

  it('emits no node for an empty component file', () => {
    expect(graph.nodes.some((n) => n.file.endsWith('Empty.svelte'))).toBe(false);
    expect(graph.nodes.some((n) => n.file.endsWith('App.svelte'))).toBe(true);
  });

  it('skips test files as graph sources', () => {
    expect(graph.nodes.some((n) => n.file.endsWith('.test.ts'))).toBe(false);
  });
});

describe('edges', () => {
  it('resolves a call through an object-literal registry', () => {
    expect(edge('greetAll', 'handlers.loud')).toBe(true);
    expect(edge('handlers.loud', 'Greeter.greet')).toBe(true);
  });

  it('resolves a call from a component script', () => {
    expect(edge('App', 'Greeter.greet')).toBe(true);
  });

  it('draws a component -> store edge for a store read in markup', () => {
    expect(edge('App', 'session')).toBe(true);
  });

  it('resolves intra-crate Rust calls', () => {
    expect(edge('nearest', 'dist2')).toBe(true);
  });
});

describe('rust tests', () => {
  it('keeps a crate\'s own #[cfg(test)] functions out of the graph', () => {
    expect(graph.nodes.some((n) => n.name === 'dist2_is_zero_at_origin')).toBe(false);
  });

  it('marks what those tests call, like a .test.ts file does', () => {
    expect(byName('dist2').tested).toBe(true);
    expect(byName('dist2').testDepth).toBe(0);
    expect(byName('nearest').tested).toBe(false);
  });
});

describe('path aliases', () => {
  it('resolves $lib imports declared in the config when the extended tsconfig is missing', () => {
    expect(edge('Greeter.greet', 'clamp')).toBe(true);
  });

  it('warns and loses those edges when neither the generated tsconfig nor the config has them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cg-nopaths-'));
    const proj = join(dir, 'tsproj');
    cpSync(FIXTURE, proj, { recursive: true });
    const cfg = JSON.parse(readFileSync(join(proj, 'codegraph.config.json'), 'utf8'));
    delete cfg.paths;
    writeFileSync(join(proj, 'codegraph.config.json'), JSON.stringify(cfg, null, 2));

    const r = extract(proj);
    expect(r.stderr).toMatch(/WARNING: tsconfig.json extends/);
    const greet = r.graph.nodes.find((n) => n.name === 'Greeter.greet')!;
    const clamp = r.graph.nodes.find((n) => n.name === 'clamp')!;
    expect(r.graph.edges.some((e) => e.from === greet.id && e.to === clamp.id)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('rust crates', () => {
  it('names a crate that is present but not configured, rather than dropping it silently', () => {
    expect(stderr).toMatch(/WARNING: "othercrate" is a crate/);
    expect(graph.nodes.some((n) => n.file.includes('othercrate'))).toBe(false);
  });
});

describe('test coverage flags', () => {
  it('marks only direct calls from a test file as tested', () => {
    expect(byName('greetAll').tested).toBe(true);
    expect(byName('Greeter.greet').tested).toBe(false);
  });

  it('measures how far a test reaches, in hops', () => {
    expect(byName('greetAll').testDepth).toBe(0);
    expect(byName('handlers.loud').testDepth).toBe(1);
    expect(byName('Greeter.greet').testDepth).toBe(2);
    expect(byName('clamp').testDepth).toBe(3);
    expect(byName('bounded').testDepth).toBe(4);
  });

  it('leaves code no test reaches at null', () => {
    expect(byName('unreachable').testDepth).toBeNull();
    expect(byName('handlers.quiet').testDepth).toBeNull();
  });
});

describe('determinism', () => {
  it('produces the same nodes and edges on a re-run', () => {
    const again = extract(FIXTURE).graph;
    expect(JSON.stringify(again.nodes)).toBe(JSON.stringify(graph.nodes));
    expect(JSON.stringify(again.edges)).toBe(JSON.stringify(graph.edges));
  });
});
