// JSON query API over a graph — the agent-facing surface, ported from the
// original api.mjs. Pure: takes a RawGraph (with embedded descriptions+config)
// and answers path+query into { status, body, md? }. No HTTP coupling here.
import { runChecks, portCandidates, orphans, recommendations } from '$lib/core/analysis.mjs';
import type { RawGraph, GraphNode, ModuleNode } from '$lib/graph/types';

export interface ApiResult {
  status: number;
  body: unknown;
  md?: string;
}

export function createApi(G: RawGraph) {
  const prefix = G.config?.namespacePrefix ?? null;
  const DESC = (G as unknown as { descriptions?: { modules: Record<string, string>; functions: Record<string, string> } }).descriptions ?? {
    modules: {},
    functions: {}
  };
  const shortMod = (m: string) => (prefix && m.startsWith(prefix + '/') ? m.slice(prefix.length + 1) : m);

  const byId = new Map(G.nodes.map((n) => [n.id, n]));
  const byShort = new Map<string, GraphNode[]>();
  const byMethod = new Map<string, GraphNode[]>();
  const byModule = new Map<string, GraphNode[]>();
  const moduleKey = new Map<string, string>();
  const outAdj = new Map<string, number[]>();
  const inAdj = new Map<string, number[]>();
  const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => (m.get(k) ?? m.set(k, []).get(k)!).push(v);

  for (const n of G.nodes) {
    push(byShort, n.short.toLowerCase(), n);
    push(byMethod, (n.short.split('.').pop() || n.short).toLowerCase(), n);
    push(byModule, n.module, n);
  }
  for (const m of G.moduleNodes)
    for (const key of [m.module, shortMod(m.module), m.module.split('/').pop()!])
      if (!moduleKey.has(key.toLowerCase())) moduleKey.set(key.toLowerCase(), m.module);
  G.edges.forEach((e, i) => {
    push(outAdj, e.from, i);
    push(inAdj, e.to, i);
  });
  const modSize = new Map(G.moduleNodes.map((m) => [m.module, { loc: 0, chars: 0, depIn: 0, depOut: 0 }]));
  for (const n of G.nodes) {
    const a = modSize.get(n.module);
    if (a) {
      a.loc += n.loc || 0;
      a.chars += n.chars || 0;
    }
  }
  for (const e of G.moduleEdges) {
    modSize.get(e.from) && modSize.get(e.from)!.depOut++;
    modSize.get(e.to) && modSize.get(e.to)!.depIn++;
  }

  const describe = (n: GraphNode) => {
    const key = `${n.module}::${n.short}`;
    if (DESC.functions?.[key]) return { text: DESC.functions[key], source: 'curated' };
    if (n.doc) return { text: n.desc, source: 'jsdoc' };
    return { text: n.desc || n.humanized, source: 'inferred' };
  };
  const describeModule = (m: ModuleNode) => DESC.modules?.[m.module] || `${m.fns} functions. No curated description yet.`;

  const fnRow = (n: GraphNode) => {
    const d = describe(n);
    return {
      id: n.id, name: n.short, module: shortMod(n.module), group: n.group, kind: n.kind,
      exported: n.exported, tested: !!n.tested, file: n.file, line: n.line,
      loc: n.loc, chars: n.chars, numeric: n.numeric,
      description: d.text, descriptionSource: d.source, inDegree: n.inDegree, outDegree: n.outDegree
    };
  };
  const fnRef = (n: GraphNode) => ({ name: n.short, module: shortMod(n.module), file: n.file, line: n.line, description: describe(n).text });
  const fnDetail = (n: GraphNode) => ({
    ...fnRow(n),
    signature: n.signature,
    calls: (outAdj.get(n.id) ?? []).map((i) => fnRef(byId.get(G.edges[i].to)!)),
    calledBy: (inAdj.get(n.id) ?? []).map((i) => fnRef(byId.get(G.edges[i].from)!))
  });
  const moduleSummary = (m: ModuleNode) => {
    const sz = modSize.get(m.module)!;
    return {
      module: shortMod(m.module), fullModule: m.module, group: m.group, file: m.file,
      functionCount: m.fns, description: describeModule(m), loc: sz.loc, chars: sz.chars,
      dependsOnCount: sz.depOut, usedByCount: sz.depIn
    };
  };

  const resolveFns = (q: string | null): GraphNode[] => {
    if (!q) return [];
    if (byId.has(q)) return [byId.get(q)!];
    const lq = q.toLowerCase();
    return byShort.get(lq) ?? byMethod.get(lq) ?? G.nodes.filter((n) => n.short.toLowerCase().includes(lq));
  };
  const resolveModule = (q: string | null): ModuleNode | null => {
    if (!q) return null;
    const lq = q.toLowerCase();
    if (moduleKey.has(lq)) return G.moduleNodes.find((m) => m.module === moduleKey.get(lq)) ?? null;
    return G.moduleNodes.find((m) => m.module.toLowerCase().includes(lq)) ?? null;
  };

  const num = (v: string | null, d: number) => (v == null || v === '' || isNaN(+v) ? d : +v);
  const J = (body: unknown, status = 200): ApiResult => ({ status, body });
  const E = (status: number, error: string, extra?: object): ApiResult => ({ status, body: { error, ...extra } });

  const INDEX = {
    service: 'codegraph',
    project: G.project,
    endpoints: {
      'GET /api/stats': 'counts', 'GET /api/graph': 'full graph',
      'GET /api/modules': 'module summaries', 'GET /api/module?name=': 'one module',
      'GET /api/functions?module=&group=&q=&kind=&exported=&tested=&sort=&limit=': 'list/filter functions',
      'GET /api/function?name=|id=': 'one function (callers/callees)',
      'GET /api/callers?name=': 'callers', 'GET /api/callees?name=': 'callees',
      'GET /api/search?q=': 'search', 'GET /api/path?from=&to=': 'shortest call path',
      'GET /api/hubs': 'most-called fns / most-depended modules',
      'GET /api/check': 'architecture findings', 'GET /api/recommendations': 'stack advice',
      'GET /api/port-candidates': 'port targets', 'GET /api/orphans': 'dead code',
      'GET /api/files': 'source files', 'GET /api/calls': 'call edges'
    }
  };

  function dispatch(seg: string, qp: URLSearchParams): ApiResult {
    const p = seg.replace(/\/+$/, '');
    switch (p) {
      case '':
      case '/':
        return J(INDEX);
      case '/stats':
        return J({ ...G.stats, generatedAt: G.generatedAt });
      case '/graph':
        return J({
          stats: G.stats, generatedAt: G.generatedAt,
          nodes: G.nodes.map(fnRow),
          edges: G.edges.map((e) => ({ from: e.from, to: e.to, count: e.count })),
          modules: G.moduleNodes.map(moduleSummary),
          moduleEdges: G.moduleEdges.map((e) => ({ from: shortMod(e.from), to: shortMod(e.to), count: e.count })),
          files: G.files ?? []
        });
      case '/modules':
        return J({ modules: G.moduleNodes.map(moduleSummary) });
      case '/module': {
        const m = resolveModule(qp.get('name'));
        if (!m) return E(404, 'module not found', { hint: 'try /api/modules' });
        const outs = G.moduleEdges.filter((e) => e.from === m.module).sort((a, b) => b.count - a.count);
        const ins = G.moduleEdges.filter((e) => e.to === m.module).sort((a, b) => b.count - a.count);
        const fns = (byModule.get(m.module) ?? []).slice().sort((a, b) => b.inDegree - a.inDegree);
        return J({
          ...moduleSummary(m),
          dependsOn: outs.map((e) => ({ module: shortMod(e.to), callSites: e.count })),
          usedBy: ins.map((e) => ({ module: shortMod(e.from), callSites: e.count })),
          functions: fns.map((n) => ({ name: n.short, line: n.line, inDegree: n.inDegree, description: describe(n).text }))
        });
      }
      case '/functions': {
        let list = G.nodes as GraphNode[];
        const mod = qp.get('module');
        if (mod) {
          const m = resolveModule(mod);
          list = m ? byModule.get(m.module) ?? [] : [];
        }
        const q = (qp.get('q') ?? '').toLowerCase();
        if (q) list = list.filter((n) => n.short.toLowerCase().includes(q) || describe(n).text.toLowerCase().includes(q));
        const kind = qp.get('kind');
        if (kind) list = list.filter((n) => n.kind === kind);
        const grp = qp.get('group');
        if (grp) list = list.filter((n) => n.group === grp);
        const exp = qp.get('exported');
        if (exp != null) list = list.filter((n) => String(n.exported) === exp);
        const tst = qp.get('tested');
        if (tst != null) list = list.filter((n) => String(!!n.tested) === tst);
        const sort = qp.get('sort') ?? 'indegree';
        const conn = (n: GraphNode) => (n.inDegree || 0) + (n.outDegree || 0);
        const cmp: Record<string, (a: GraphNode, b: GraphNode) => number> = {
          indegree: (a, b) => b.inDegree - a.inDegree,
          outdegree: (a, b) => b.outDegree - a.outDegree,
          connected: (a, b) => conn(b) - conn(a),
          loc: (a, b) => (b.loc || 0) - (a.loc || 0),
          chars: (a, b) => (b.chars || 0) - (a.chars || 0),
          name: (a, b) => a.short.localeCompare(b.short)
        };
        const sorted = list.slice().sort(cmp[sort] ?? cmp.indegree);
        return J({ count: list.length, sort, functions: sorted.slice(0, num(qp.get('limit'), 100)).map(fnRow) });
      }
      case '/function': {
        const q = qp.get('id') ?? qp.get('name');
        if (!q) return E(400, 'provide ?name= or ?id=');
        const hits = resolveFns(q);
        if (!hits.length) return E(404, `no function matches "${q}"`);
        if (hits.length > 1) return J({ ambiguous: true, query: q, matches: hits.map(fnRow) });
        return J(fnDetail(hits[0]));
      }
      case '/callers':
      case '/callees': {
        const hits = resolveFns(qp.get('name') ?? qp.get('id'));
        if (!hits.length) return E(404, 'no function match');
        if (hits.length > 1) return J({ ambiguous: true, matches: hits.map(fnRow) });
        const n = hits[0];
        const callers = p === '/callers';
        const idxs = (callers ? inAdj : outAdj).get(n.id) ?? [];
        const refs = idxs.map((i) => fnRef(byId.get(callers ? G.edges[i].from : G.edges[i].to)!));
        return J({ function: n.short, module: shortMod(n.module), [callers ? 'callers' : 'callees']: refs });
      }
      case '/search': {
        const q = qp.get('q');
        if (!q) return E(400, 'provide ?q=');
        const lq = q.toLowerCase();
        const score = (hay: string, isName: boolean) => {
          const h = hay.toLowerCase();
          if (h === lq) return isName ? 100 : 60;
          if (h.startsWith(lq)) return isName ? 70 : 40;
          if (h.includes(lq)) return isName ? 45 : 25;
          return 0;
        };
        const fns = G.nodes
          .map((n) => ({ s: Math.max(score(n.short, true), score(describe(n).text, false)), n }))
          .filter((x) => x.s > 0)
          .sort((a, b) => b.s - a.s || b.n.inDegree - a.n.inDegree);
        const mods = G.moduleNodes
          .map((m) => ({ s: Math.max(score(shortMod(m.module), true), score(describeModule(m), false)), m }))
          .filter((x) => x.s > 0)
          .sort((a, b) => b.s - a.s || b.m.fns - a.m.fns);
        const limit = num(qp.get('limit'), 20);
        return J({ query: q, functions: fns.slice(0, limit).map((x) => fnRow(x.n)), modules: mods.slice(0, limit).map((x) => moduleSummary(x.m)) });
      }
      case '/path': {
        const from = resolveFns(qp.get('from'));
        const to = resolveFns(qp.get('to'));
        if (!from.length) return E(404, `from: no match for "${qp.get('from')}"`);
        if (!to.length) return E(404, `to: no match for "${qp.get('to')}"`);
        if (from.length > 1) return J({ ambiguous: 'from', matches: from.map(fnRow) });
        if (to.length > 1) return J({ ambiguous: 'to', matches: to.map(fnRow) });
        const max = num(qp.get('max'), 12);
        const prev = new Map<string, string | null>([[from[0].id, null]]);
        const queue = [from[0].id];
        let found: GraphNode[] | null = null;
        while (queue.length && !found) {
          const cur = queue.shift()!;
          for (const i of outAdj.get(cur) ?? []) {
            const nxt = G.edges[i].to;
            if (prev.has(nxt)) continue;
            prev.set(nxt, cur);
            if (nxt === to[0].id) {
              const pathArr: GraphNode[] = [];
              let c: string | null = nxt;
              while (c) {
                pathArr.unshift(byId.get(c)!);
                c = prev.get(c) ?? null;
              }
              found = pathArr.length - 1 > max ? null : pathArr;
              break;
            }
            queue.push(nxt);
          }
        }
        if (!found) return J({ from: from[0].short, to: to[0].short, reachable: false });
        return J({ from: from[0].short, to: to[0].short, hops: found.length - 1, path: found.map(fnRef) });
      }
      case '/hubs': {
        const limit = num(qp.get('limit'), 15);
        const fns = G.nodes.slice().sort((a, b) => b.inDegree - a.inDegree).slice(0, limit).map(fnRow);
        const mods = G.moduleNodes
          .map((m) => ({ m, used: G.moduleEdges.filter((e) => e.to === m.module).reduce((s, e) => s + e.count, 0) }))
          .sort((a, b) => b.used - a.used)
          .slice(0, limit)
          .map((x) => ({ ...moduleSummary(x.m), incomingCallSites: x.used }));
        return J({ mostCalledFunctions: fns, mostDependedOnModules: mods });
      }
      case '/check': {
        const { findings, errors, warnings } = runChecks(G);
        return J({ errors, warnings, findings });
      }
      case '/recommendations':
        return J({ recommendations: recommendations(G) });
      case '/port-candidates':
        return J({ candidates: portCandidates(G, num(qp.get('limit'), 15)) });
      case '/orphans': {
        const list = orphans(G).map(fnRow);
        return J({ count: list.length, orphans: list });
      }
      case '/files': {
        let list = (G.files ?? []).map((f) => {
          const sz = modSize.get(f.module) ?? { loc: 0, chars: 0 };
          return { file: f.file, module: shortMod(f.module), group: f.group, lang: f.lang, functions: f.fns, loc: sz.loc, chars: sz.chars };
        });
        const grp = qp.get('group');
        if (grp) list = list.filter((f) => f.group === grp);
        const q = (qp.get('q') ?? '').toLowerCase();
        if (q) list = list.filter((f) => f.file.toLowerCase().includes(q));
        const sort = qp.get('sort') ?? 'functions';
        const cmp: Record<string, (a: typeof list[0], b: typeof list[0]) => number> = {
          functions: (a, b) => b.functions - a.functions,
          loc: (a, b) => b.loc - a.loc,
          chars: (a, b) => b.chars - a.chars,
          name: (a, b) => a.file.localeCompare(b.file)
        };
        list.sort(cmp[sort] ?? cmp.functions);
        return J({ count: list.length, sort, files: list.slice(0, num(qp.get('limit'), 200)) });
      }
      case '/calls': {
        let list = G.edges.map((e) => {
          const a = byId.get(e.from)!;
          const b = byId.get(e.to)!;
          return { caller: a.short, callee: b.short, fromModule: shortMod(a.module), toModule: shortMod(b.module), count: e.count || 1, crossModule: a.module !== b.module, callerId: e.from, calleeId: e.to };
        });
        const mod = qp.get('module');
        if (mod) {
          const m = resolveModule(mod);
          const fm = m ? m.module : null;
          list = list.filter((c) => byId.get(c.callerId)!.module === fm || byId.get(c.calleeId)!.module === fm);
        }
        const q = (qp.get('q') ?? '').toLowerCase();
        if (q) list = list.filter((c) => `${c.caller} ${c.callee} ${c.fromModule} ${c.toModule}`.toLowerCase().includes(q));
        if (qp.get('cross') === 'true') list = list.filter((c) => c.crossModule);
        const sort = qp.get('sort') ?? 'weight';
        list.sort(sort === 'name' ? (a, b) => a.caller.localeCompare(b.caller) : (a, b) => b.count - a.count);
        return J({ count: list.length, sort, calls: list.slice(0, num(qp.get('limit'), 200)) });
      }
      default:
        return E(404, `unknown endpoint /api${p}`, { see: '/api' });
    }
  }

  return { dispatch };
}
