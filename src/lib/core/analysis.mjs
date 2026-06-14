// @ts-check
/**
 * Pure graph analysis — architecture checks, port-candidate ranking, orphans.
 *
 * Project-specific knobs (layer ranks, god threshold, ADR rules, the module
 * namespace prefix) are read from `graph.config`, which the extractor embeds
 * from the project's codegraph.config.json. So this file is fully generic: the
 * same code analyses any onboarded project, and callers only pass the graph.
 *
 * Graph theory (strongly-connected components for cycle detection) is delegated
 * to graphology rather than hand-rolled.
 */
import Graph from 'graphology';
import { stronglyConnectedComponents } from 'graphology-components';

/** Strip a project's module namespace prefix for display (e.g. game/services → services). */
export const shortMod = (m, prefix) => (prefix && m.startsWith(prefix + '/') ? m.slice(prefix.length + 1) : m);

/**
 * Declarative ADR rule evaluators. Each project's codegraph.config.json lists
 * `adrRules`; entries with a `type` are checked here, entries with
 * `checkable:false` are acknowledged (and only matter for adr-coverage).
 * Add a new rule type here once; every project can then use it from JSON.
 */
const ADR_RULE_TYPES = {
  // No node outside `module` may have a call edge into it (except allowFrom).
  'forbidden-callee-module': (r, { graph, byId, add, sm }) => {
    const allow = new Set([r.module, ...(r.allowFrom || [])]);
    for (const e of graph.edges) {
      const to = byId.get(e.to);
      if (!to || to.module !== r.module) continue;
      const from = byId.get(e.from);
      if (!from || allow.has(from.module)) continue;
      add(r.severity || 'error', r.adr, `${sm(from.module)}::${from.short} ${r.msg}`, {
        module: from.module,
        id: from.id,
        file: from.file,
        line: from.line
      });
    }
  }
};

/** Architecture rule checks. Returns { findings, errors, warnings, rules }. */
export function runChecks(graph) {
  const cfg = graph.config || {};
  const layers = cfg.layers || {};
  const godFunctions = cfg.godFunctions ?? 40;
  const adrRules = cfg.adrRules || [];
  const prefix = cfg.namespacePrefix || null;
  const sm = (m) => shortMod(m, prefix);

  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const findings = [];
  const add = (level, rule, msg, extra) => findings.push({ level, rule, msg, ...extra });

  // Module dependency graph: a Map for edge metadata + a graphology graph for SCC.
  const modOut = new Map();
  const modEdgeMeta = new Map();
  const mg = new Graph({ type: 'directed', multi: false, allowSelfLoops: false });
  for (const m of graph.moduleNodes) if (!mg.hasNode(m.module)) mg.addNode(m.module);
  for (const e of graph.edges) {
    const fa = byId.get(e.from);
    const fb = byId.get(e.to);
    if (!fa || !fb) continue;
    const a = fa.module;
    const b = fb.module;
    if (a === b) continue;
    if (!modOut.has(a)) modOut.set(a, new Set());
    modOut.get(a).add(b);
    const k = `${a}|${b}`;
    modEdgeMeta.set(k, (modEdgeMeta.get(k) || 0) + (e.count || 1));
    if (!mg.hasNode(a)) mg.addNode(a);
    if (!mg.hasNode(b)) mg.addNode(b);
    if (!mg.hasEdge(a, b)) mg.addEdge(a, b);
  }
  const groupMap = new Map(graph.moduleNodes.map((m) => [m.module, m.group]));
  const groupOf = (m) => groupMap.get(m);

  // 1. ADR rules (declarative, from project config)
  const adrRuleIds = [];
  for (const r of adrRules) {
    if (r.checkable === false || !r.type) continue;
    const evaluator = ADR_RULE_TYPES[r.type];
    if (!evaluator) {
      add('warn', 'adr-coverage', `${r.adr} uses unknown rule type "${r.type}" — add it to ADR_RULE_TYPES in analysis.mjs`, {});
      continue;
    }
    adrRuleIds.push(r.adr);
    evaluator(r, { graph, byId, add, sm });
  }

  // 2. layer direction (higher layers may depend on lower; -1 = exempt)
  for (const [a, tos] of modOut) {
    const ra = layers[groupOf(a)];
    if (ra == null || ra < 0) continue;
    for (const b of tos) {
      const rb = layers[groupOf(b)];
      if (rb == null || rb < 0) continue;
      if (ra < rb) {
        add('warn', 'layers', `${sm(a)} (${groupOf(a)}) depends on higher layer ${sm(b)} (${groupOf(b)}) — ${modEdgeMeta.get(`${a}|${b}`)} call site(s)`, { module: a });
      }
    }
  }

  // 3. cycles (graphology strongly-connected components)
  for (const comp of stronglyConnectedComponents(mg)) {
    if (comp.length > 1) {
      add('error', 'cycle', `circular module dependency (${comp.length}): ${comp.map(sm).join(' → ')} → …`, { module: comp[0] });
    }
  }

  // 4. god modules
  for (const m of graph.moduleNodes) {
    if (m.fns > godFunctions) {
      add('warn', 'god-module', `${sm(m.module)} has ${m.fns} functions (> ${godFunctions}) — consider splitting`, { module: m.module });
    }
  }

  // 5. orphans (standalone private fns with no callers; class methods/stores excluded)
  const inDeg = new Map();
  for (const e of graph.edges) inDeg.set(e.to, (inDeg.get(e.to) || 0) + 1);
  for (const n of graph.nodes) {
    if (n.kind !== 'function' || n.className) continue;
    if (n.exported || n.tested || inDeg.get(n.id) || n.group === 'stores') continue;
    add('warn', 'orphan', `${sm(n.module)}::${n.short} is never called (dead code?)`, { module: n.module, id: n.id, file: n.file, line: n.line });
  }

  // 6. adr-coverage — any ADR declared in the project's decisions doc but not
  //    onboarded into its adrRules.
  const known = new Set(adrRules.map((r) => r.adr));
  for (const a of graph.adrs || []) {
    if (!known.has(a.id)) {
      add('warn', 'adr-coverage', `${a.id} (${a.title}) is not onboarded into the checks — add an adrRules entry (with a type, or checkable:false) in the project's codegraph.config.json`, {});
    }
  }

  const errors = findings.filter((f) => f.level === 'error').length;
  const rules = [...adrRuleIds, 'cycle', 'layers', 'god-module', 'orphan', 'adr-coverage'];
  return { findings, errors, warnings: findings.length - errors, rules };
}

/** Modules ranked as port candidates (e.g. TS→Rust): compute-heavy and low-coupling. */
export function portCandidates(graph, limit = 15) {
  const cfg = graph.config || {};
  const prefix = cfg.namespacePrefix || null;
  const layers = cfg.layers || {};
  // "higher layers" = rank >= 2 (services and above), derived from project config.
  const HIGHER = new Set(Object.keys(layers).filter((g) => layers[g] >= 2));
  const agg = new Map();
  for (const n of graph.nodes) {
    const a = agg.get(n.module) || { fns: 0, loc: 0, numeric: 0, topFn: null };
    a.fns++;
    a.loc += n.loc || 0;
    a.numeric += n.numeric || 0;
    if (!a.topFn || (n.numeric || 0) > a.topFn.numeric) a.topFn = { name: n.short, numeric: n.numeric || 0 };
    agg.set(n.module, a);
  }
  const cross = new Map();
  const groupMap = new Map(graph.moduleNodes.map((m) => [m.module, m.group]));
  for (const e of graph.moduleEdges) {
    if (HIGHER.has(groupMap.get(e.to))) cross.set(e.from, (cross.get(e.from) || 0) + 1);
  }
  return graph.moduleNodes
    .filter((m) => !['rust', 'dev'].includes(m.group))
    .map((m) => {
      const a = agg.get(m.module) || { fns: 0, loc: 0, numeric: 0, topFn: null };
      const coupling = cross.get(m.module) || 0;
      const score = +((a.numeric * Math.log2(a.loc + 2)) / (1 + coupling)).toFixed(1);
      return {
        module: shortMod(m.module, prefix),
        fullModule: m.module,
        group: m.group,
        functions: a.fns,
        loc: a.loc,
        numericOps: a.numeric,
        couplingToHigherLayers: coupling,
        hottestFunction: a.topFn && a.topFn.name,
        score
      };
    })
    .filter((r) => r.numericOps > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit);
}

// Tunable thresholds for the best-practice recommendations.
const COMPONENT_MAX_LINES = 200;
const FUNCTION_MAX_LINES = 80;

/**
 * Stack-specific best-practice recommendations (SvelteKit 5 + TS). Structural
 * rules live in runChecks; this is advisory. Returns ordered
 * { id, severity, title, rationale, findings:[{label,sub,nav}] }.
 */
export function recommendations(graph) {
  const prefix = (graph.config && graph.config.namespacePrefix) || null;
  const sm = (m) => shortMod(m, prefix);
  const inDeg = new Map();
  for (const e of graph.edges) inDeg.set(e.to, (inDeg.get(e.to) || 0) + 1);
  const recs = [];
  const nodeFind = (n, sub) => ({ label: n.short, sub, nav: ['node', n.id] });

  const legacy = graph.nodes
    .filter((n) => n.kind === 'component' && n.legacyReactive > 0)
    .sort((a, b) => b.legacyReactive - a.legacyReactive);
  if (legacy.length)
    recs.push({
      id: 'runes',
      severity: 'warn',
      title: `Migrate ${legacy.length} component(s) from legacy \`$:\` to runes`,
      rationale: 'Svelte 5 favours $state/$derived/$effect over legacy `$:` reactivity — clearer dependencies, smaller bundles, better tree-shaking.',
      findings: legacy.map((n) => nodeFind(n, `${n.legacyReactive} legacy $: statement(s)`))
    });

  const bigComp = graph.nodes
    .filter((n) => n.kind === 'component' && (n.loc || 0) > COMPONENT_MAX_LINES)
    .sort((a, b) => b.loc - a.loc);
  if (bigComp.length)
    recs.push({
      id: 'component-size',
      severity: 'warn',
      title: `${bigComp.length} Svelte component(s) exceed ${COMPONENT_MAX_LINES} lines`,
      rationale: 'Large components are hard to test and re-render less efficiently — extract sub-components.',
      findings: bigComp.map((n) => nodeFind(n, `${n.loc} lines`))
    });

  const bigFns = graph.nodes
    .filter((n) => (n.kind === 'function' || n.kind === 'method') && (n.loc || 0) > FUNCTION_MAX_LINES)
    .sort((a, b) => b.loc - a.loc);
  if (bigFns.length)
    recs.push({
      id: 'function-size',
      severity: 'info',
      title: `${bigFns.length} function(s) over ${FUNCTION_MAX_LINES} lines`,
      rationale: 'Long functions concentrate complexity and resist unit testing. Split the largest into named helpers.',
      findings: bigFns.map((n) => nodeFind(n, `${n.loc} lines · ${sm(n.module)}`))
    });

  const core = graph.nodes.filter(
    (n) => ['services', 'systems'].includes(n.group) && (n.kind === 'function' || n.kind === 'method') && (inDeg.get(n.id) || 0) >= 1
  );
  const untested = core.filter((n) => !n.tested).sort((a, b) => (inDeg.get(b.id) || 0) - (inDeg.get(a.id) || 0));
  if (untested.length)
    recs.push({
      id: 'coverage',
      severity: 'info',
      title: `Test core logic — ${untested.length}/${core.length} used service/engine fns are untested`,
      rationale: 'A layered architecture pays off when the business layer is covered. These have callers but no test — the most-called are the highest-value targets.',
      findings: untested.map((n) => nodeFind(n, `${inDeg.get(n.id) || 0} callers · ${sm(n.module)}`))
    });

  const order = { error: 0, warn: 1, info: 2 };
  return recs.sort((a, b) => order[a.severity] - order[b.severity] || b.findings.length - a.findings.length);
}

/** Standalone private functions with no in-graph callers (dead-code candidates). */
export function orphans(graph) {
  const inDeg = new Map();
  for (const e of graph.edges) inDeg.set(e.to, (inDeg.get(e.to) || 0) + 1);
  return graph.nodes.filter(
    (n) => n.kind === 'function' && !n.className && !n.exported && !n.tested && !inDeg.get(n.id) && n.group !== 'stores'
  );
}
