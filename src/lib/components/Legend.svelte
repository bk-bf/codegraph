<script lang="ts">
  import type { RawGraph } from '$lib/graph/types';
  import { groupColor } from '$lib/graph/colors';

  let { graph }: { graph: RawGraph } = $props();
  let open = $state(true);

  const layers = graph.config?.layers ?? {};
  // groups present in this project, ordered by layer rank then name
  const groups = [...new Set(graph.moduleNodes.map((m) => m.group))].sort(
    (a, b) => (layers[a] ?? 99) - (layers[b] ?? 99) || a.localeCompare(b)
  );
</script>

<div class="legend">
  <button class="lh" onclick={() => (open = !open)} title="Node colour = layer / group">
    {open ? '▾' : '▸'} layers
  </button>
  {#if open}
    <div class="items">
      {#each groups as g}
        <div class="item"><span class="sw" style="background:{groupColor(g)}"></span>{g}</div>
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
  .items {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin-top: 5px;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 7px;
    color: var(--fg);
  }
  .sw {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    flex: none;
  }
</style>
