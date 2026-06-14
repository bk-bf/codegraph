<script lang="ts">
  import type { RawGraph } from '$lib/graph/types';
  import type { Sigma } from 'sigma';
  import { selection, plainLabels, coverage } from '$lib/graph/stores';

  let { graph, level }: { graph: RawGraph; level: 'module' | 'function' } = $props();

  let container: HTMLDivElement | undefined = $state();
  let renderer: Sigma | null = null;
  let building = $state(false);
  let plain = $state(false);
  let cov = $state(false);
  plainLabels.subscribe((v) => (plain = v));
  coverage.subscribe((v) => (cov = v));

  $effect(() => {
    void level;
    void graph;
    void plain;
    void cov;
    if (!container) return;
    let killed = false;
    building = true;
    (async () => {
      const [{ default: Sigma }, { buildGraph }] = await Promise.all([import('sigma'), import('$lib/graph/build')]);
      if (killed || !container) return;
      renderer?.kill();
      const g = buildGraph(graph, level, { plain, coverage: cov });
      renderer = new Sigma(g, container, {
        renderLabels: true,
        labelColor: { color: '#d7dce3' },
        labelDensity: 0.6,
        labelRenderedSizeThreshold: level === 'module' ? 6 : 14,
        defaultEdgeColor: '#222a34',
        minCameraRatio: 0.05,
        maxCameraRatio: 12
      });
      renderer.on('clickNode', ({ node }) => {
        selection.set(level === 'module' ? { type: 'module', module: node } : { type: 'node', id: node });
      });
      renderer.on('clickStage', () => selection.set(null));
      building = false;
    })();
    return () => {
      killed = true;
      renderer?.kill();
      renderer = null;
    };
  });
</script>

<div class="canvas" bind:this={container}></div>
{#if building}<div class="badge">laying out…</div>{/if}

<style>
  .canvas {
    position: absolute;
    inset: 0;
  }
  .badge {
    position: absolute;
    bottom: 12px;
    left: 12px;
    padding: 4px 10px;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--accent);
  }
</style>
