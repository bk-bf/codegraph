import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { groupColor } from './colors';
import type { RawGraph } from './types';

/**
 * Build a laid-out graphology graph from extractor output.
 *
 * `level: 'function'` → one node per function/method (the Obsidian-style hairball).
 * `level: 'module'`   → one node per module, edges aggregated (the layered overview).
 *
 * Node size scales with in-degree; colour is the layer/group. ForceAtlas2 lays it
 * out (graphology owns the math we used to hand-roll).
 */
export function buildGraph(data: RawGraph, level: 'function' | 'module' = 'function'): Graph {
  const g = new Graph({ type: 'directed', multi: false, allowSelfLoops: false });

  if (level === 'module') {
    const inDeg = new Map<string, number>();
    for (const e of data.moduleEdges) inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
    const N = data.moduleNodes.length;
    data.moduleNodes.forEach((m, i) => {
      const a = (i / N) * Math.PI * 2;
      g.addNode(m.module, {
        label: m.module.replace(/^game\//, ''),
        x: Math.cos(a),
        y: Math.sin(a),
        size: 4 + Math.sqrt((inDeg.get(m.module) ?? 0) + m.fns) * 1.2,
        color: groupColor(m.group),
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
      g.addNode(n.id, {
        label: n.short,
        x: Math.cos(a),
        y: Math.sin(a),
        size: 2 + Math.sqrt(inDeg.get(n.id) ?? 0) * 1.4,
        color: groupColor(n.group),
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
