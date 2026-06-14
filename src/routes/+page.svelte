<script lang="ts">
  import { goto } from '$app/navigation';
  import type { Sigma } from 'sigma';

  let { data } = $props();

  let container: HTMLDivElement | undefined = $state();
  let level = $state<'function' | 'module'>('module');
  let renderer: Sigma | null = null;
  let building = $state(false);
  let hovered = $state<{ label: string; group: string } | null>(null);

  async function render() {
    if (!container || !data.graph) return;
    building = true;
    const [{ default: Sigma }, { buildGraph }] = await Promise.all([
      import('sigma'),
      import('$lib/graph/build')
    ]);
    renderer?.kill();
    const g = buildGraph(data.graph, level);
    renderer = new Sigma(g, container, {
      renderLabels: true,
      labelColor: { color: '#d7dce3' },
      labelDensity: 0.6,
      labelRenderedSizeThreshold: level === 'module' ? 6 : 14,
      defaultEdgeColor: '#222a34',
      minCameraRatio: 0.05,
      maxCameraRatio: 12
    });
    renderer.on('enterNode', ({ node }) => {
      const a = g.getNodeAttributes(node);
      hovered = { label: a.label as string, group: a.group as string };
    });
    renderer.on('leaveNode', () => (hovered = null));
    building = false;
  }

  // Re-render on mount, when the toggle changes, or when a new project loads.
  $effect(() => {
    void data.graph;
    void level;
    render();
    return () => renderer?.kill();
  });

  function switchProject(e: Event) {
    const name = (e.target as HTMLSelectElement).value;
    goto(`/?project=${encodeURIComponent(name)}`, { invalidateAll: true });
  }
</script>

<header>
  <strong>codegraph</strong>
  {#if data.projects.length}
    <select onchange={switchProject} value={data.current}>
      {#each data.projects as p}<option value={p}>{p}</option>{/each}
    </select>
  {/if}
  <span class="sep">·</span>
  <button class:on={level === 'module'} onclick={() => (level = 'module')}>modules</button>
  <button class:on={level === 'function'} onclick={() => (level = 'function')}>functions (force)</button>
  <span class="grow"></span>
  {#if data.graph}
    <span class="stats">
      {data.graph.stats.functions} fns · {data.graph.stats.edges} calls · {data.graph.stats.modules} modules
    </span>
  {/if}
</header>

<main>
  {#if !data.graph}
    <div class="empty">
      No graph data. Run <code>node bin/codegraph.mjs extract</code> first.
    </div>
  {:else}
    <div class="canvas" bind:this={container}></div>
    {#if building}<div class="badge">laying out…</div>{/if}
    {#if hovered}<div class="hover">{hovered.label} <span class="hg">{hovered.group}</span></div>{/if}
  {/if}
</main>

<style>
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-panel);
    height: 44px;
  }
  header strong {
    color: var(--accent);
    letter-spacing: 1px;
  }
  .sep,
  .stats {
    color: var(--fg-dim);
  }
  .grow {
    flex: 1;
  }
  main {
    position: relative;
    height: calc(100vh - 44px);
  }
  .canvas {
    position: absolute;
    inset: 0;
  }
  .empty {
    padding: 40px;
    color: var(--fg-dim);
  }
  .badge,
  .hover {
    position: absolute;
    bottom: 12px;
    padding: 4px 10px;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 4px;
  }
  .badge {
    left: 12px;
    color: var(--accent);
  }
  .hover {
    right: 12px;
  }
  .hg {
    color: var(--fg-dim);
  }
  code {
    color: var(--accent2);
  }
</style>
