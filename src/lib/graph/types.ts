// Shape of the graph.json produced by the extractor (see src/lib/core/extract.mjs).
export interface GraphNode {
  id: string;
  name: string;
  short: string;
  file: string;
  module: string;
  group: string;
  line: number;
  kind: string;
  className: string | null;
  exported: boolean;
  signature: string;
  doc: string;
  humanized: string;
  desc: string;
  loc: number;
  chars: number;
  numeric: number;
  tested: boolean;
  inDegree: number;
  outDegree: number;
  legacyReactive?: number;
}
export interface GraphEdge {
  from: string;
  to: string;
  count: number;
}
export interface ModuleNode {
  module: string;
  group: string;
  file: string;
  fns: number;
}
export interface ModuleEdge {
  from: string;
  to: string;
  count: number;
}
export interface RawGraph {
  generatedAt: string;
  project?: string;
  root: string;
  adrs: { id: string; title: string }[];
  stats: { files: number; functions: number; edges: number; modules: number };
  nodes: GraphNode[];
  edges: GraphEdge[];
  moduleNodes: ModuleNode[];
  moduleEdges: ModuleEdge[];
  files: { file: string; module: string; group: string; fns: number; lang?: string }[];
}
