import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { groupColor } from './colors';
import { describer } from './describe';
import type { RawGraph } from './types';

export interface BuildOpts {
  plain?: boolean; // append the plain-English description to the node name
  coverage?: boolean; // colour by test coverage instead of layer
  seed?: boolean; // leave circular seed positions (a live worker will lay it out)
  moduleFilter?: string; // function level: only this module's fns + 1-hop neighbours
}

const COV = { good: '#7ee787', mid: '#f5a623', bad: '#ff6b6b' };

/**
 * Build a laid-out graphology graph from extractor output.
 *
 * `level: 'function'` → one node per function/method (the Obsidian-style hairball).
 * `level: 'module'`   → one node per module, edges aggregated (the overview).
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
      const mShort = m.module.replace(/^game\//, '');
      g.addNode(m.module, {
        label: opts.plain ? `${mShort} — ${modDesc(m).split('. ')[0]}` : mShort,
        x: Math.max(40, Math.sqrt(N) * 4) * Math.cos(a),
        y: Math.max(40, Math.sqrt(N) * 4) * Math.sin(a),
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
    // optional focus: just one module's functions + their 1-hop neighbours
    let nodes = data.nodes;
    if (opts.moduleFilter) {
      const inMod = new Set(data.nodes.filter((n) => n.module === opts.moduleFilter).map((n) => n.id));
      const vis = new Set(inMod);
      for (const e of data.edges) {
        if (inMod.has(e.from)) vis.add(e.to);
        if (inMod.has(e.to)) vis.add(e.from);
      }
      nodes = data.nodes.filter((n) => vis.has(n.id));
    }
    const N = nodes.length;
    nodes.forEach((n, i) => {
      const a = (i / N) * Math.PI * 2;
      let color = groupColor(n.group);
      if (opts.coverage) color = n.kind === 'function' || n.kind === 'method' ? (n.tested ? COV.good : COV.bad) : '#3a4453';
      g.addNode(n.id, {
        label: opts.plain ? `${n.short} — ${fnDesc(n)}` : n.short,
        x: Math.max(40, Math.sqrt(N) * 4) * Math.cos(a),
        y: Math.max(40, Math.sqrt(N) * 4) * Math.sin(a),
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

  // When seeded, leave the circular layout for a live worker to animate from;
  // otherwise lay it out statically (used by the offline export).
  if (!opts.seed) {
    const settings = forceAtlas2.inferSettings(g);
    forceAtlas2.assign(g, {
      iterations: g.order > 600 ? 120 : 250,
      settings: { ...settings, gravity: 1.2, scalingRatio: 12, barnesHutOptimize: g.order > 500 }
    });
  }
  return g;
}
