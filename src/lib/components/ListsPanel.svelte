<script lang="ts">
  import type { RawGraph, GraphNode } from '$lib/graph/types';
  import type { GraphIndex } from '$lib/graph/indexes';
  import { describer } from '$lib/graph/describe';
  import { selection, focusModule, viewMode, type ListType } from '$lib/graph/stores';

  let { graph, index, type }: { graph: RawGraph; index: GraphIndex; type: ListType } = $props();
  const { shortMod } = describer(graph);

  // per-module loc/chars (for module/file sizes)
  const modSize = new Map<string, { loc: number; chars: number }>();
  for (const n of graph.nodes) {
    const a = modSize.get(n.module) ?? { loc: 0, chars: 0 };
    a.loc += n.loc || 0;
    a.chars += n.chars || 0;
    modSize.set(n.module, a);
  }

  interface Row {
    label: string;
    sub: string;
    keys: Record<string, number | string>;
    onClick?: () => void;
  }

  const SORTS: Record<ListType, [string, string][]> = {
    functions: [['indegree', 'callers'], ['outdegree', 'callees'], ['loc', 'lines'], ['chars', 'chars'], ['name', 'name']],
    calls: [['weight', 'weight'], ['name', 'name']],
    files: [['functions', 'functions'], ['loc', 'lines'], ['chars', 'chars'], ['name', 'name']],
    modules: [['fns', 'functions'], ['loc', 'lines'], ['depOut', 'depends on'], ['depIn', 'used by'], ['name', 'name']]
  };

  let sort = $state(SORTS[type][0][0]);
  let q = $state('');
  $effect(() => {
    void type;
    sort = SORTS[type][0][0];
  });

  function selNode(id: string) {
    selection.set({ type: 'node', id });
  }
  function selModule(m: string) {
    focusModule.set(null);
    viewMode.set('layered');
    selection.set({ type: 'module', module: m });
  }

  const rows = $derived.by<Row[]>(() => {
    if (type === 'functions') {
      return graph.nodes.map((n: GraphNode) => ({
        label: n.short,
        sub: `${shortMod(n.module)} · ${n.loc}ln · ${n.inDegree}←${n.outDegree}→`,
        keys: { indegree: n.inDegree, outdegree: n.outDegree, loc: n.loc, chars: n.chars, name: n.short },
        onClick: () => selNode(n.id)
      }));
    }
    if (type === 'modules') {
      return graph.moduleNodes.map((m) => {
        const sz = modSize.get(m.module) ?? { loc: 0, chars: 0 };
        const depOut = (index.modOut.get(m.module) ?? []).length;
        const depIn = (index.modIn.get(m.module) ?? []).length;
        return {
          label: shortMod(m.module),
          sub: `${m.group} · ${m.fns} fns · ${sz.loc}ln · ${depOut}→ ${depIn}←`,
          keys: { fns: m.fns, loc: sz.loc, depOut, depIn, name: m.module },
          onClick: () => selModule(m.module)
        };
      });
    }
    if (type === 'files') {
      return (graph.files ?? []).map((f) => {
        const sz = modSize.get(f.module) ?? { loc: 0, chars: 0 };
        return {
          label: f.file.replace(/^src\//, ''),
          sub: `${f.group} · ${f.fns} fns · ${sz.loc}ln`,
          keys: { functions: f.fns, loc: sz.loc, chars: sz.chars, name: f.file },
          onClick: () => selModule(f.module)
        };
      });
    }
    // calls
    return graph.edges.map((e) => {
      const a = index.nodeById.get(e.from);
      const b = index.nodeById.get(e.to);
      return {
        label: `${a?.short ?? '?'} → ${b?.short ?? '?'}`,
        sub: `${a ? shortMod(a.module) : ''} → ${b ? shortMod(b.module) : ''} · ${e.count}×`,
        keys: { weight: e.count, name: a?.short ?? '' },
        onClick: () => a && selNode(a.id)
      };
    });
  });

  const shown = $derived.by(() => {
    const ql = q.toLowerCase();
    const filtered = ql ? rows.filter((r) => (r.label + ' ' + r.sub).toLowerCase().includes(ql)) : rows;
    const cmp = (a: Row, b: Row) => {
      const ka = a.keys[sort];
      const kb = b.keys[sort];
      return typeof ka === 'string' ? String(ka).localeCompare(String(kb)) : (kb as number) - (ka as number);
    };
    return filtered.slice().sort(cmp);
  });
</script>

<div class="dh">
  <div class="kind">{type}</div>
  <h2>{rows.length} {type}</h2>
</div>
<div class="body">
  <input class="search" placeholder="filter {type}…" bind:value={q} />
  <div class="sorts">
    {#each SORTS[type] as [key, label]}
      <button class="chip" class:on={sort === key} onclick={() => (sort = key)}>{label}</button>
    {/each}
  </div>
  <div class="count">{shown.length} shown</div>
  {#each shown.slice(0, 300) as r}
    <button class="row" onclick={r.onClick}>
      {r.label}<span class="sub">{r.sub}</span>
    </button>
  {/each}
  {#if shown.length > 300}<div class="sub more">… +{shown.length - 300} more (filter to narrow)</div>{/if}
</div>

<style>
  .dh {
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }
  .kind {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--accent);
  }
  .dh h2 {
    margin: 4px 0 0;
    font-size: 14px;
  }
  .body {
    padding: 10px 14px;
  }
  .search {
    width: 100%;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    color: var(--fg);
    border-radius: 4px;
    padding: 5px 8px;
    font: inherit;
    margin-bottom: 8px;
  }
  .sorts {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 6px;
  }
  .chip {
    font-size: 10px;
    padding: 2px 6px;
  }
  .count {
    font-size: 10px;
    color: var(--fg-dim);
    margin-bottom: 6px;
  }
  .row {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: 0;
    border-bottom: 1px solid #1a2029;
    color: var(--fg);
    padding: 3px 0;
    font: inherit;
    cursor: pointer;
    white-space: normal;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  .row:hover {
    color: var(--accent2);
  }
  .sub {
    display: block;
    font-size: 10px;
    color: var(--fg-dim);
  }
  .more {
    margin-top: 6px;
  }
</style>
