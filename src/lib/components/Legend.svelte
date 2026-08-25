<script lang="ts">
  import type { RawGraph } from '$lib/graph/types';
  import { groupColor } from '$lib/graph/colors';
  import { hiddenGroups } from '$lib/graph/stores';

  let { graph }: { graph: RawGraph } = $props();
  // Collapsed by default: it overlays the graph's bottom-right corner, and on a
  // phone an expanded census covers a good part of the stage before anything is read.
  let open = $state(false);
  let hidden = $state<Set<string>>(new Set());
  hiddenGroups.subscribe((v) => (hidden = v));

  // node count per group, biggest first — the colour key doubles as a census
  const counts = new Map<string, number>();
  for (const n of graph.nodes) counts.set(n.group, (counts.get(n.group) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const label = (graph as unknown as { kind?: string }).kind === 'filesystem' ? 'file types' : 'layers';

  function toggle(g: string) {
    hiddenGroups.update((s) => {
      const n = new Set(s);
      if (n.has(g)) n.delete(g);
      else n.add(g);
      return n;
    });
  }
  const anyHidden = $derived(hidden.size > 0);
</script>

<div class="legend">
  <div class="lhrow">
    <button class="lh" onclick={() => (open = !open)} title="Node colour = type / group">
      {open ? '▾' : '▸'} {label}
    </button>
    {#if open && anyHidden}
      <button class="reset" onclick={() => hiddenGroups.set(new Set())} title="Show all types">all</button>
    {/if}
  </div>
  {#if open}
    <div class="items">
      {#each groups as [g, c]}
        <button class="item" class:off={hidden.has(g)} onclick={() => toggle(g)} title="Toggle {g}">
          <span class="sw" style="background:{groupColor(g)}"></span>
          <span class="gn">{g}</span>
          <span class="gc">{c.toLocaleString()}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .legend {
    position: absolute;
    bottom: 12px;
    right: 12px;
    z-index: 4;
    background: rgba(22, 27, 34, 0.88);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px 9px;
    font-size: 11px;
  }
  .lhrow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .lh {
    background: none;
    border: 0;
    color: var(--fg-dim);
    cursor: pointer;
    font: inherit;
    padding: 0;
  }
  .lh:hover {
    color: var(--accent2);
  }
  .reset {
    background: none;
    border: 0;
    color: var(--accent2);
    cursor: pointer;
    font: inherit;
    font-size: 10px;
    padding: 0;
  }
  .items {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin-top: 5px;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    background: none;
    border: 0;
    padding: 2px 3px;
    border-radius: 3px;
    color: var(--fg);
    font: inherit;
    cursor: pointer;
    text-align: left;
  }
  .item:hover {
    background: rgba(255, 255, 255, 0.05);
  }
  .item.off {
    opacity: 0.4;
  }
  .item.off .sw {
    filter: grayscale(1);
  }
  .gn {
    flex: 1;
  }
  .gc {
    color: var(--fg-dim);
    font-variant-numeric: tabular-nums;
    padding-left: 12px;
  }
  .sw {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    flex: none;
  }
</style>
