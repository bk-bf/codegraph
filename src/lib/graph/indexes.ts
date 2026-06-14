// Adjacency + lookup indexes over a RawGraph, shared by the detail panel and views.
import type { RawGraph, GraphNode, ModuleNode, ModuleEdge } from './types';

export interface GraphIndex {
  nodeById: Map<string, GraphNode>;
  modByName: Map<string, ModuleNode>;
  callees: Map<string, GraphNode[]>;
  callers: Map<string, GraphNode[]>;
  modOut: Map<string, ModuleEdge[]>;
  modIn: Map<string, ModuleEdge[]>;
}

export function buildIndex(graph: RawGraph): GraphIndex {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const modByName = new Map(graph.moduleNodes.map((m) => [m.module, m]));
  const callees = new Map<string, GraphNode[]>();
  const callers = new Map<string, GraphNode[]>();
  for (const e of graph.edges) {
    const to = nodeById.get(e.to);
    const from = nodeById.get(e.from);
    if (from && to) {
      (callees.get(e.from) ?? callees.set(e.from, []).get(e.from)!).push(to);
      (callers.get(e.to) ?? callers.set(e.to, []).get(e.to)!).push(from);
    }
  }
  const modOut = new Map<string, ModuleEdge[]>();
  const modIn = new Map<string, ModuleEdge[]>();
  for (const e of graph.moduleEdges) {
    (modOut.get(e.from) ?? modOut.set(e.from, []).get(e.from)!).push(e);
    (modIn.get(e.to) ?? modIn.set(e.to, []).get(e.to)!).push(e);
  }
  return { nodeById, modByName, callees, callers, modOut, modIn };
}
