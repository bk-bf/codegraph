<script lang="ts">
  import type { RawGraph } from '$lib/graph/types';
  import { selection } from '$lib/graph/stores';
  import { describer } from '$lib/graph/describe';

  let { graph }: { graph: RawGraph } = $props();
  const shortMod = $derived(describer(graph).shortMod);

  interface Hit {
    kind: 'fn' | 'mod';
    key: string; // node id | module path
    label: string;
    sub: string;
  }

  let q = $state('');
  let open = $state(false);
  let active = $state(0);

  // substring match on name; modules first, then functions, ranked by where the
  // match falls (earlier = better) then by importance (in-degree / fn count).
  const matches = $derived.by<Hit[]>(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    const mods = graph.moduleNodes
      .map((m) => ({ m, name: shortMod(m.module), i: shortMod(m.module).toLowerCase().indexOf(s) }))
      .filter((x) => x.i !== -1)
      .sort((a, b) => a.i - b.i || b.m.fns - a.m.fns)
      .slice(0, 4)
      .map((x): Hit => ({ kind: 'mod', key: x.m.module, label: x.name, sub: x.m.group }));
    const fns = graph.nodes
      .map((n) => ({ n, i: n.short.toLowerCase().indexOf(s) }))
      .filter((x) => x.i !== -1)
      .sort((a, b) => a.i - b.i || b.n.inDegree - a.n.inDegree)
      .slice(0, 10)
      .map((x): Hit => ({ kind: 'fn', key: x.n.id, label: x.n.short, sub: shortMod(x.n.module) }));
    return [...mods, ...fns];
  });

  // reset the highlighted row whenever the result set changes
  $effect(() => {
    void matches;
    active = 0;
  });

  function choose(h: Hit) {
    selection.set(h.kind === 'fn' ? { type: 'node', id: h.key } : { type: 'module', module: h.key });
    q = '';
    open = false;
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      open = false;
      (e.target as HTMLElement).blur();
      return;
    }
    if (!matches.length) return;
    if (e.key === 'ArrowDown') {
      active = (active + 1) % matches.length;
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      active = (active - 1 + matches.length) % matches.length;
      e.preventDefault();
    } else if (e.key === 'Enter') {
      choose(matches[active]);
      e.preventDefault();
    }
  }
</script>

<div class="search">
  <input
    type="text"
    placeholder="search functions / modules…"
    bind:value={q}
    onfocus={() => (open = true)}
    onblur={() => (open = false)}
    onkeydown={onKey}
  />
  {#if open && matches.length}
    <div class="results">
      {#each matches as h, i (h.kind + h.key)}
        <!-- mousedown (not click) so it fires before the input's blur closes the list -->
        <button class="res" class:active={i === active} onmousedown={() => choose(h)} onmouseenter={() => (active = i)}>
          <span class="rk {h.kind}">{h.kind === 'mod' ? '▣' : 'ƒ'}</span>
          <span class="rl">{h.label}</span>
          <span class="rs">{h.sub}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .search {
    position: relative;
    flex: 0 1 180px;
    max-width: 180px;
  }
  input {
    width: 100%;
    font: inherit;
    font-size: 11px;
    color: var(--fg);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 3px 8px;
    outline: none;
  }
  input:focus {
    border-color: var(--accent2);
  }
  input::placeholder {
    color: var(--fg-dim);
  }
  .results {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    z-index: 20;
    max-height: 60vh;
    overflow-y: auto;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 3px;
    box-shadow: 0 6px 22px rgba(0, 0, 0, 0.45);
  }
  .res {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    background: none;
    border: 0;
    border-radius: 4px;
    padding: 3px 6px;
    text-align: left;
  }
  .res:hover,
  .res.active {
    background: var(--bg-panel);
    border-color: transparent;
  }
  .rk {
    flex: none;
    width: 12px;
    text-align: center;
    color: var(--accent2);
  }
  .rk.mod {
    color: var(--accent);
  }
  .rl {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg);
  }
  .rs {
    flex: none;
    color: var(--fg-dim);
    font-size: 10px;
    max-width: 45%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
