import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { groupColor } from './colors';
import { describer } from './describe';
import type { RawGraph } from './types';

export interface BuildOpts {
  plain?: boolean; // label nodes with their description instead of their name
  coverage?: boolean; // colour by test coverage instead of layer
}

const COV = { good: '#7ee787', mid: '#f5a623', bad: '#ff6b6b' };

/**
 * Build a laid-out graphology graph from extractor output.
 *
 * `level: 'function'` → one node per function/method (the Obsidian-style hairball).
 * `level: 'module'`   → one node per module, edges aggregated (the layered overview).
 */
export function buildGraph(data: RawGraph, level: 'function' | 'module' = 'function', opts: BuildOpts = {}): Graph {
  const g = new Graph({ type: 'directed', multi: false, allowSelfLoops: false });
  const { fnDesc, modDesc } = describer(data);

  if (level === 'module') {
    const inDeg = new Map<string, number>();
    for (const e of data.moduleEdges) inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
    const fnsByMod = new Map<string, { t: number; n: number }>();
    if (opts.coverage)
      for (const n of data.nodes)
        if (n.kind === 'function' || n.kind === 'method') {
          const a = fnsByMod.get(n.module) ?? { t: 0, n: 0 };
          a.n++;
          if (n.tested) a.t++;
          fnsByMod.set(n.module, a);
        }
    const N = data.moduleNodes.length;
    data.moduleNodes.forEach((m, i) => {
      const a = (i / N) * Math.PI * 2;
      let color = groupColor(m.group);
      if (opts.coverage) {
        const c = fnsByMod.get(m.module);
        const r = c && c.n ? c.t / c.n : 0;
        color = !c ? '#3a4453' : r > 0.66 ? COV.good : r > 0.2 ? COV.mid : COV.bad;
      }
      g.addNode(m.module, {
        label: opts.plain ? modDesc(m).split('. ')[0] : m.module.replace(/^game\//, ''),
        x: Math.cos(a),
        y: Math.sin(a),
        size: 4 + Math.sqrt((inDeg.get(m.module) ?? 0) + m.fns) * 1.2,
        color,
        group: m.group
      });
    });
    for (const e of data.moduleEdges) {
      if (e.from === e.to || !g.hasNode(e.from) || !g.hasNode(e.to) || g.hasEdge(e.from, e.to)) continue;
      g.addEdge(e.from, e.to, { weight: e.count, size: Math.min(1 + e.count / 4, 6) });
    }
  } else {
    const inDeg = new Map<string, number>();
    for (const e of data.edges) inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
    const N = data.nodes.length;
    data.nodes.forEach((n, i) => {
      const a = (i / N) * Math.PI * 2;
      let color = groupColor(n.group);
      if (opts.coverage) color = n.kind === 'function' || n.kind === 'method' ? (n.tested ? COV.good : COV.bad) : '#3a4453';
      g.addNode(n.id, {
        label: opts.plain ? fnDesc(n) : n.short,
        x: Math.cos(a),
        y: Math.sin(a),
        size: 2 + Math.sqrt(inDeg.get(n.id) ?? 0) * 1.4,
        color,
        group: n.group
      });
    });
    for (const e of data.edges) {
      if (e.from === e.to || !g.hasNode(e.from) || !g.hasNode(e.to) || g.hasEdge(e.from, e.to)) continue;
      g.addEdge(e.from, e.to, { weight: e.count, size: 1 });
    }
  }

  const settings = forceAtlas2.inferSettings(g);
  forceAtlas2.assign(g, {
    iterations: g.order > 600 ? 120 : 250,
    settings: { ...settings, gravity: 1.2, scalingRatio: 12, barnesHutOptimize: g.order > 500 }
  });
  return g;
}
