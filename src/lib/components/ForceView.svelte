<script lang="ts">
  import type { RawGraph } from '$lib/graph/types';
  import type { Sigma } from 'sigma';
  import { selection, plainLabels, coverage } from '$lib/graph/stores';

  let { graph, level }: { graph: RawGraph; level: 'module' | 'function' } = $props();

  let container: HTMLDivElement | undefined = $state();
  let renderer: Sigma | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let layout: any = null;
  let running = $state(false);
  let plain = $state(false);
  let cov = $state(false);
  let physicsToggle = $state<() => void>(() => {});
  plainLabels.subscribe((v) => (plain = v));
  coverage.subscribe((v) => (cov = v));

  const DIM = '#222831';

  // hover state — read by the reducers passed to Sigma
  let hovered: string | null = null;
  let neighbors = new Set<string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function nodeReducer(node: string, data: any) {
    if (hovered && node !== hovered && !neighbors.has(node)) return { ...data, color: DIM, label: '' };
    if (node === hovered) return { ...data, highlighted: true, zIndex: 2 };
    return data;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function edgeReducer(edge: string, data: any) {
    if (!hovered || !renderer) return data;
    return renderer.getGraph().hasExtremity(edge, hovered)
      ? { ...data, color: '#57c7ff', zIndex: 1 }
      : { ...data, hidden: true };
  }

  $effect(() => {
    void level;
    void graph;
    void plain;
    void cov;
    if (!container) return;
    let killed = false;
    let settle: ReturnType<typeof setTimeout>;

    (async () => {
      const [{ default: Sigma }, { buildGraph }, fa2, fa2sync] = await Promise.all([
        import('sigma'),
        import('$lib/graph/build'),
        import('graphology-layout-forceatlas2/worker'),
        import('graphology-layout-forceatlas2')
      ]);
      if (killed || !container) return;
      layout?.kill();
      renderer?.kill();

      const g = buildGraph(graph, level, { plain, coverage: cov, seed: true });

      // ---- live physics worker: animates from the seed, reacts to drops ----
      const settings = fa2sync.default.inferSettings(g);
      // High slowDown = small steps per tick → a gradual, visible settling
      // animation rather than a snap. Gentle gravity so it drifts in.
      layout = new fa2.default(g, {
        settings: { ...settings, gravity: 0.6, scalingRatio: 16, slowDown: g.order > 600 ? 60 : 35 }
      });
      const start = () => {
        if (layout && !layout.isRunning()) {
          layout.start();
          running = true;
        }
      };
      const stop = () => {
        clearTimeout(settle);
        if (layout?.isRunning()) layout.stop();
        running = false;
      };
      start();
      settle = setTimeout(stop, g.order > 600 ? 14000 : 10000);
      physicsToggle = () => (running ? stop() : start());

      renderer = new Sigma(g, container, {
        renderLabels: true,
        labelColor: { color: '#d7dce3' },
        labelDensity: 0.6,
        labelRenderedSizeThreshold: level === 'module' ? 6 : 14,
        defaultEdgeColor: '#222a34',
        minCameraRatio: 0.05,
        maxCameraRatio: 12,
        nodeReducer,
        edgeReducer
      });

      // hover highlight
      renderer.on('enterNode', ({ node }) => {
        hovered = node;
        neighbors = new Set(g.neighbors(node));
        renderer!.refresh({ skipIndexation: true });
      });
      renderer.on('leaveNode', () => {
        hovered = null;
        neighbors = new Set();
        renderer!.refresh({ skipIndexation: true });
      });
      renderer.on('clickNode', ({ node }) =>
        selection.set(level === 'module' ? { type: 'module', module: node } : { type: 'node', id: node })
      );
      renderer.on('clickStage', () => selection.set(null));

      // ---- dragging: pause physics while dragging, kick it on drop ----
      let dragged: string | null = null;
      const captor = renderer.getMouseCaptor();
      renderer.on('downNode', (e) => {
        dragged = e.node;
        stop(); // freeze layout so the node follows the cursor
        if (!renderer!.getCustomBBox()) renderer!.setCustomBBox(renderer!.getBBox());
      });
      captor.on('mousemovebody', (e) => {
        if (!dragged) return;
        const pos = renderer!.viewportToGraph(e);
        g.setNodeAttribute(dragged, 'x', pos.x);
        g.setNodeAttribute(dragged, 'y', pos.y);
        e.preventSigmaDefault();
        e.original.preventDefault();
        e.original.stopPropagation();
      });
      captor.on('mouseup', () => {
        if (!dragged) return;
        dragged = null;
        start(); // let neighbours settle around the moved node
        settle = setTimeout(stop, 1500);
      });
    })();

    return () => {
      killed = true;
      clearTimeout(settle);
      layout?.kill();
      renderer?.kill();
      layout = null;
      renderer = null;
    };
  });
</script>

<div class="canvas" bind:this={container}></div>
<button class="phys" class:on={running} title="Toggle physics simulation" onclick={() => physicsToggle()}>
  {running ? '❙❙ physics' : '▶ physics'}
</button>

<style>
  .canvas {
    position: absolute;
    inset: 0;
  }
  .phys {
    position: absolute;
    bottom: 12px;
    left: 12px;
    font-size: 11px;
    padding: 4px 9px;
  }
</style>
