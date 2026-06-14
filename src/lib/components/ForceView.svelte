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
  const OUT = '#57c7ff'; // outgoing: this node → others (it calls them)
  const IN = '#f5a623'; // incoming: others → this node (they call it)

  // hover state — read by the reducers passed to Sigma
  let hovered: string | null = null;
  let outN = new Set<string>(); // nodes the hovered node calls
  let inN = new Set<string>(); // nodes that call the hovered node
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function nodeReducer(node: string, data: any) {
    if (!hovered) return data;
    if (node === hovered) return { ...data, highlighted: true, zIndex: 3 };
    if (outN.has(node)) return { ...data, color: OUT, zIndex: 2 };
    if (inN.has(node)) return { ...data, color: IN, zIndex: 2 };
    return { ...data, color: DIM, label: '' };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function edgeReducer(edge: string, data: any) {
    if (!hovered || !renderer) return data;
    const g = renderer.getGraph();
    if (g.source(edge) === hovered) return { ...data, color: OUT, size: (data.size || 1) + 1, zIndex: 2 };
    if (g.target(edge) === hovered) return { ...data, color: IN, size: (data.size || 1) + 1, zIndex: 2 };
    return { ...data, hidden: true };
  }

  // hover "card": just a thin white border around the label, no fill
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function drawHover(context: CanvasRenderingContext2D, data: any, settings: any) {
    if (!data.label) return;
    const size = settings.labelSize ?? 12;
    context.font = `${settings.labelWeight ?? 'normal'} ${size}px ${settings.labelFont ?? 'monospace'}`;
    const pad = 5;
    const tw = context.measureText(data.label).width;
    const x = data.x + data.size + 2;
    const h = size + pad * 2;
    const y = data.y - h / 2;
    context.beginPath();
    context.rect(x, y, tw + pad * 2, h);
    context.strokeStyle = '#ffffff';
    context.lineWidth = 1;
    context.stroke();
    context.fillStyle = '#d7dce3';
    context.textBaseline = 'middle';
    context.fillText(data.label, x + pad, data.y);
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
      // animation rather than a snap. Modules animate at ~1/4 speed (slowDown ×4).
      const slowDown = level === 'module' ? 140 : g.order > 600 ? 60 : 35;
      layout = new fa2.default(g, {
        settings: { ...settings, gravity: 0.6, scalingRatio: 16, slowDown }
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
      // 4× slower modules need a longer window to reach equilibrium
      settle = setTimeout(stop, level === 'module' ? 36000 : g.order > 600 ? 14000 : 10000);
      physicsToggle = () => (running ? stop() : start());

      renderer = new Sigma(g, container, {
        renderLabels: true,
        labelColor: { color: '#d7dce3' },
        labelDensity: 0.6,
        labelRenderedSizeThreshold: level === 'module' ? 6 : 14,
        defaultEdgeColor: '#222a34',
        minCameraRatio: 0.05,
        maxCameraRatio: 12,
        defaultDrawNodeHover: drawHover,
        nodeReducer,
        edgeReducer
      });

      // hover highlight — split neighbours into outgoing/incoming
      renderer.on('enterNode', ({ node }) => {
        hovered = node;
        outN = new Set(g.outNeighbors(node));
        inN = new Set(g.inNeighbors(node));
        renderer!.refresh({ skipIndexation: true });
      });
      renderer.on('leaveNode', () => {
        hovered = null;
        outN = new Set();
        inN = new Set();
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
  {running ? '❙❙' : '▶'}
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
