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
  /** Called at module top level (table builders, import-time wiring), so not dead code. */
  moduleUsed?: boolean;
  /** Declared inside another function — a closure-scoped local. */
  nested?: boolean;
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
/** A declarative architecture rule from the project's codegraph.config.json. */
export interface AdrRule {
  adr: string;
  type?: string;
  severity?: 'error' | 'warn' | 'info';
  msg?: string;
  module?: string;
  allowFrom?: string[];
  callee?: string;
  callees?: string[];
  checkable?: false;
  [k: string]: unknown;
}
/** The slice of the project's config the extractor embeds, so analysis stays generic. */
export interface GraphConfig {
  layers?: Record<string, number>;
  godFunctions?: number;
  adrRules?: AdrRule[];
  namespacePrefix?: string | null;
}
export interface RawGraph {
  generatedAt: string;
  project?: string;
  root: string;
  /** Host that ran the extract, and the revision it was built from. */
  host?: string;
  commit?: string | null;
  dirty?: boolean;
  config?: GraphConfig;
  adrs: { id: string; title: string }[];
  stats: { files: number; functions: number; edges: number; modules: number };
  nodes: GraphNode[];
  edges: GraphEdge[];
  moduleNodes: ModuleNode[];
  moduleEdges: ModuleEdge[];
  files: { file: string; module: string; group: string; fns: number; lang?: string }[];
}
