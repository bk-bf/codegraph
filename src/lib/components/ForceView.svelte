<script lang="ts">
  import type { RawGraph } from '$lib/graph/types';
  import type { Sigma } from 'sigma';
  import { selection, plainLabels, coverage } from '$lib/graph/stores';

  let { graph, level }: { graph: RawGraph; level: 'module' | 'function' } = $props();

  let container: HTMLDivElement | undefined = $state();
  let renderer: Sigma | null = null;
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
    if (node === hovered) return { ...data, highlighted: true, forceLabel: true, zIndex: 3 };
    if (outN.has(node)) return { ...data, color: OUT, zIndex: 2 };
    if (inN.has(node)) return { ...data, color: IN, zIndex: 2 };
    return { ...data, color: DIM, label: '' };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function edgeReducer(edge: string, data: any) {
    if (!hovered || !renderer) return data;
    const g = renderer.getGraph();
    if (g.source(edge) === hovered) return { ...data, color: OUT, size: (data.size || 1) + 1.5, zIndex: 2 };
    if (g.target(edge) === hovered) return { ...data, color: IN, size: (data.size || 1) + 1.5, zIndex: 2 };
    return { ...data, hidden: true };
  }

  function wrapText(s: string, n: number): string[] {
    if (s.length <= n) return [s];
    const lines: string[] = [];
    let cur = '';
    for (const w of s.split(' ')) {
      if (cur && (cur + ' ' + w).length > n) {
        lines.push(cur);
        cur = w;
      } else cur = cur ? cur + ' ' + w : w;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  // default (non-hover) node label: word-wrapped + slightly transparent to cut clutter
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function drawLabel(context: CanvasRenderingContext2D, data: any, settings: any) {
    if (!data.label) return;
    const size = settings.labelSize ?? 12;
    context.font = `${settings.labelWeight ?? 'normal'} ${size}px ${settings.labelFont ?? 'monospace'}`;
    const lines = wrapText(String(data.label), 26);
    const lineH = size + 2;
    const x = data.x + data.size + 3;
    const startY = data.y - ((lines.length - 1) * lineH) / 2;
    context.fillStyle = 'rgba(215, 220, 227, 0.58)';
    context.textBaseline = 'middle';
    lines.forEach((l, i) => context.fillText(l, x, startY + i * lineH));
  }

  // hover "card": opaque dark fill + thin white border so the label reads over edges
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function drawHover(context: CanvasRenderingContext2D, data: any, settings: any) {
    if (!data.label) return;
    const size = settings.labelSize ?? 12;
    context.font = `${settings.labelWeight ?? 'normal'} ${size}px ${settings.labelFont ?? 'monospace'}`;
    const pad = 6;
    const lineH = size + 4;
    const lines = wrapText(String(data.label), 34);
    const tw = Math.max(...lines.map((l) => context.measureText(l).width));
    const x = data.x + data.size + 3;
    const boxH = lines.length * lineH + pad * 2 - 4;
    const y = data.y - boxH / 2;
    context.fillStyle = '#0e1116';
    context.fillRect(x, y, tw + pad * 2, boxH);
    context.strokeStyle = '#ffffff';
    context.lineWidth = 1;
    context.strokeRect(x, y, tw + pad * 2, boxH);
    context.fillStyle = '#d7dce3';
    context.textBaseline = 'middle';
    lines.forEach((l, i) => context.fillText(l, x + pad, y + pad + lineH * i + lineH / 2 - 2));
  }

  $effect(() => {
    void level;
    void graph;
    void plain;
    void cov;
    if (!container) return;
    let killed = false;
    let raf = 0;
    let acc = 0;
    let iters = 0;
    let auto = true;
    // iterations advanced per animation frame — the real speed knob. Modules
    // crawl; the function hairball needs more iterations so it goes a bit faster.
    const STEP = level === 'module' ? 0.15 : 1;
    const MAX = level === 'module' ? 320 : 600;

    (async () => {
      const [{ default: Sigma }, { buildGraph }, fa2, rendering] = await Promise.all([
        import('sigma'),
        import('$lib/graph/build'),
        import('graphology-layout-forceatlas2'),
        import('sigma/rendering')
      ]);
      if (killed || !container) return;
      cancelAnimationFrame(raf);
      renderer?.kill();

      const g = buildGraph(graph, level, { plain, coverage: cov, seed: true });
      const settings = { ...fa2.default.inferSettings(g), gravity: 0.6, scalingRatio: 16, barnesHutOptimize: g.order > 500 };

      renderer = new Sigma(g, container, {
        renderLabels: true,
        labelColor: { color: '#d7dce3' },
        labelDensity: 0.6,
        labelRenderedSizeThreshold: level === 'module' ? 6 : 14,
        defaultEdgeColor: '#222a34',
        defaultEdgeType: 'arrow',
        edgeProgramClasses: { arrow: rendering.EdgeArrowProgram },
        minCameraRatio: 0.05,
        maxCameraRatio: 12,
        defaultDrawNodeLabel: drawLabel,
        defaultDrawNodeHover: drawHover,
        nodeReducer,
        edgeReducer
      });

      // ---- manual layout stepping (controllable speed) ----
      const step = () => {
        if (killed || !running) return;
        acc += STEP;
        const n = Math.floor(acc);
        if (n >= 1) {
          acc -= n;
          fa2.default.assign(g, { iterations: n, settings });
          iters += n;
          renderer!.refresh({ skipIndexation: true });
        }
        if (auto && iters >= MAX) {
          running = false;
          return;
        }
        raf = requestAnimationFrame(step);
      };
      const startLoop = () => {
        if (!running) {
          running = true;
          raf = requestAnimationFrame(step);
        }
      };
      physicsToggle = () => {
        if (running) {
          running = false;
          cancelAnimationFrame(raf);
        } else {
          auto = false; // manual run keeps going until toggled off
          startLoop();
        }
      };
      running = true;
      raf = requestAnimationFrame(step);

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

      // ---- dragging: pause stepping while dragging, resume on drop ----
      let dragged: string | null = null;
      const captor = renderer.getMouseCaptor();
      renderer.on('downNode', (e) => {
        dragged = e.node;
        running = false;
        cancelAnimationFrame(raf);
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
        if (auto && iters >= MAX) iters = MAX - 80; // let neighbours re-settle
        startLoop();
      });
    })();

    return () => {
      killed = true;
      cancelAnimationFrame(raf);
      renderer?.kill();
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
