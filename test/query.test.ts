// The agent-facing query API, answered from the fixture graph. These are the answers an
// agent acts on without being able to check them, so each one is pinned to a graph whose
// every node and edge is known.
import { describe, it, expect, beforeAll } from 'vitest';
import { createApi } from '../src/lib/server/query';
import { FIXTURE, extractProject } from './helpers';
import type { RawGraph } from '../src/lib/graph/types';

let api: ReturnType<typeof createApi>;
let graph: RawGraph;
const get = (path: string, qs = '') => api.dispatch(path, new URLSearchParams(qs));
const body = <T = any>(path: string, qs = ''): T => get(path, qs).body as T;

beforeAll(() => {
  graph = extractProject(FIXTURE).graph;
  api = createApi(graph);
});

describe('lookup', () => {
  it('counts what the graph holds', () => {
    expect(body('/stats')).toMatchObject({ functions: graph.nodes.length, edges: graph.edges.length });
  });

  it('resolves a function by name, with both directions of the call graph', () => {
    const fn = body('/function', 'name=clamp');
    expect(fn.name).toBe('clamp');
    expect(fn.calls.map((c: any) => c.name)).toContain('bounded');
    expect(fn.calledBy.map((c: any) => c.name)).toContain('Greeter.greet');
  });

  it('404s a name that is not there', () => {
    expect(get('/function', 'name=nosuchthing').status).toBe(404);
    expect(get('/nope').status).toBe(404);
  });

  it('finds the shortest call path and reports the hop count', () => {
    const p = body('/path', 'from=greetAll&to=clamp');
    expect(p.hops).toBe(3);
    expect(p.path.map((n: any) => n.name)).toEqual(['greetAll', 'handlers.loud', 'Greeter.greet', 'clamp']);
  });

  it('reports unreachable rather than inventing a path', () => {
    expect(body('/path', 'from=clamp&to=greetAll').reachable).toBe(false);
  });
});

describe('test-coverage filters', () => {
  const names = (qs: string) => body('/functions', qs).functions.map((f: any) => f.name).sort();

  it('separates "a test calls this" from "a test reaches this"', () => {
    // dist2 is called by the rust crate's own #[cfg(test)] fn, greetAll by the .test.ts.
    expect(names('tested=true')).toEqual(['dist2', 'greetAll']);
    expect(names('testReachable=true')).toEqual([
      'Greeter.greet',
      'bounded',
      'clamp',
      'dist2',
      'greetAll',
      'handlers.loud'
    ]);
  });

  it('lists what no test reaches at all', () => {
    expect(names('testReachable=false')).toContain('unreachable');
    expect(names('testReachable=false')).toContain('handlers.quiet');
    expect(names('testReachable=false')).not.toContain('clamp');
  });

  it('filters by how far a test has to reach', () => {
    expect(names('maxTestDepth=0')).toEqual(['dist2', 'greetAll']);
    expect(names('maxTestDepth=1')).toEqual(['dist2', 'greetAll', 'handlers.loud']);
  });

  it('carries the depth on every function row', () => {
    const rows = body('/functions', 'q=clamp').functions;
    expect(rows[0]).toMatchObject({ name: 'clamp', tested: false, testDepth: 3 });
  });
});

describe('modules', () => {
  it('summarises a module and what it depends on', () => {
    const m = body('/module', 'name=services/Greeter');
    expect(m.functionCount).toBeGreaterThan(0);
    expect(m.dependsOn.map((d: any) => d.module)).toContain('core/util');
  });

  it('lists callers of a function across modules', () => {
    expect(body('/callers', 'name=clamp').callers.map((c: any) => c.name)).toEqual(['Greeter.greet']);
  });
});
