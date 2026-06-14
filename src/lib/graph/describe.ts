// Description resolution + small view helpers, ported from the original viewer.
// Operates on the graph's embedded `descriptions` ({groups,modules,functions}).
import type { RawGraph, GraphNode, ModuleNode } from './types';

export interface Descriptions {
  groups: Record<string, string>;
  modules: Record<string, string>;
  functions: Record<string, string>;
}

export function describer(graph: RawGraph) {
  const DESC: Descriptions = (graph as unknown as { descriptions?: Descriptions }).descriptions ?? {
    groups: {},
    modules: {},
    functions: {}
  };
  const prefix = graph.config?.namespacePrefix ?? null;
  const root = graph.root ?? '';

  const shortMod = (m: string) => (prefix && m.startsWith(prefix + '/') ? m.slice(prefix.length + 1) : m);
  const fnDesc = (n: GraphNode) =>
    DESC.functions[`${n.module}::${n.short}`] || n.desc || n.doc || n.humanized || n.short;
  const modDesc = (m: ModuleNode) =>
    DESC.modules[m.module] || `${m.fns} functions. No curated description yet.`;
  const vscodeUrl = (n: { file: string; line: number }) => `vscode://file/${root}/${n.file}:${n.line}`;

  return { shortMod, fnDesc, modDesc, vscodeUrl };
}
