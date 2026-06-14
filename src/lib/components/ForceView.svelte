<script lang="ts">
  import type { RawGraph } from '$lib/graph/types';
  import type { Sigma } from 'sigma';
  import { selection, plainLabels, coverage, forceFocus, allLabels } from '$lib/graph/stores';

  let { graph, level }: { graph: RawGraph; level: 'module' | 'function' } = $props();

  let container: HTMLDivElement | undefined = $state();
  let renderer: Sigma | null = null;
  let running = $state(false);
  let plain = $state(false);
  let cov = $state(false);
  let focusMod = $state<string | null>(null);
  let physicsToggle = $state<() => void>(() => {});
  plainLabels.subscribe((v) => (plain = v));
  coverage.subscribe((v) => (cov = v));
  forceFocus.subscribe((v) => (focusMod = v));
  let showAll = $state(false);
  allLabels.subscribe((v) => (showAll = v));
  const shortMod = (m: string) => m.replace(/^game\//, '');

  const DIM = '#222831';
  const OUT = '#57c7ff'; // outgoing: this node → others (it calls them)
  const IN = '#f5a623'; // incoming: others → this node (they call it)

  // hover state — read by the reducers passed to Sigma
  let hovered: string | null = null;
  let outN = new Set<string>(); // nodes the hovered node calls
  let inN = new Set<string>(); // nodes that call the hovered node
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function nodeReducer(node: string, data: any) {
    const base = showAll ? { ...data, forceLabel: true } : data;
    if (!hovered) return base;
    if (node === hovered) return { ...base, highlighted: true, forceLabel: true, zIndex: 3 };
    if (outN.has(node)) return { ...base, color: OUT, zIndex: 2 };
    if (inN.has(node)) return { ...base, color: IN, zIndex: 2 };
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

  const wrapCache = new Map<string, string[]>();
  function wrapText(s: string, n: number): string[] {
    const key = n + '|' + s;
    const cached = wrapCache.get(key);
    if (cached) return cached;
    let lines: string[];
    if (s.length <= n) lines = [s];
    else {
      lines = [];
      let cur = '';
      for (const w of s.split(' ')) {
        if (cur && (cur + ' ' + w).length > n) {
          lines.push(cur);
          cur = w;
        } else cur = cur ? cur + ' ' + w : w;
      }
      if (cur) lines.push(cur);
    }
    wrapCache.set(key, lines);
    return lines;
  }

  // Hide labels while the layout animates (drawing+reflowing them every frame is
  // the jank); show them again once it settles.
  function setRunning(v: boolean) {
    running = v;
    if (renderer) {
      renderer.setSetting('renderLabels', !v);
      if (!v) renderer.refresh({ skipIndexation: true });
    }
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
    void focusMod;
    if (!container) return;
    let killed = false;
    let raf = 0;
    // EASE per frame: each node moves this fraction of the remaining distance to
    // its settled target. Exponential → monotonic → no overshoot/oscillation.
    // Smaller = slower. Modules crawl; the function hairball eases a bit faster.
    const EASE = level === 'module' ? 0.012 : 0.022;
    const MAX_FRAMES = level === 'module' ? 1800 : 900;

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

      const g = buildGraph(graph, level, {
        plain,
        coverage: cov,
        seed: true,
        moduleFilter: level === 'function' ? (focusMod ?? undefined) : undefined
      });
      const settings = { ...fa2.default.inferSettings(g), gravity: 0.6, scalingRatio: 16, barnesHutOptimize: g.order > 500 };

      // 1. remember the seed (start) positions
      const seed = new Map<string, { x: number; y: number }>();
      g.forEachNode((n, a) => seed.set(n, { x: a.x, y: a.y }));
      // 2. compute the fully-settled target layout in one shot (FA2's adaptive
      //    damping runs to completion here → no oscillation), then capture it
      fa2.default.assign(g, { iterations: 500, settings });
      const target = new Map<string, { x: number; y: number }>();
      g.forEachNode((n, a) => target.set(n, { x: a.x, y: a.y }));
      // 3. snap back to the seed so we can animate the settle smoothly
      g.forEachNode((n) => {
        const s = seed.get(n)!;
        g.setNodeAttribute(n, 'x', s.x);
        g.setNodeAttribute(n, 'y', s.y);
      });

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

      // ---- smooth ease toward the precomputed target ----
      let frames = 0;
      const step = () => {
        if (killed || !running) return;
        let moved = 0;
        g.forEachNode((n, a) => {
          const t = target.get(n)!;
          const dx = (t.x - a.x) * EASE;
          const dy = (t.y - a.y) * EASE;
          moved += Math.abs(dx) + Math.abs(dy);
          g.setNodeAttribute(n, 'x', a.x + dx);
          g.setNodeAttribute(n, 'y', a.y + dy);
        });
        renderer!.refresh({ skipIndexation: true });
        frames++;
        if (moved / g.order < 0.08 || frames > MAX_FRAMES) {
          setRunning(false);
          return;
        }
        raf = requestAnimationFrame(step);
      };
      physicsToggle = () => {
        if (running) {
          setRunning(false);
          cancelAnimationFrame(raf);
        } else {
          // replay: scatter back to the seed and ease in again
          g.forEachNode((n) => {
            const s = seed.get(n)!;
            g.setNodeAttribute(n, 'x', s.x);
            g.setNodeAttribute(n, 'y', s.y);
          });
          frames = 0;
          setRunning(true);
          raf = requestAnimationFrame(step);
        }
      };
      setRunning(true);
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

      // ---- dragging: free-move a node; it keeps where you drop it ----
      let dragged: string | null = null;
      const captor = renderer.getMouseCaptor();
      renderer.on('downNode', (e) => {
        dragged = e.node;
        if (!renderer!.getCustomBBox()) renderer!.setCustomBBox(renderer!.getBBox());
      });
      captor.on('mousemovebody', (e) => {
        if (!dragged) return;
        const pos = renderer!.viewportToGraph(e);
        g.setNodeAttribute(dragged, 'x', pos.x);
        g.setNodeAttribute(dragged, 'y', pos.y);
        target.set(dragged, { x: pos.x, y: pos.y }); // pin its target so the ease keeps it there
        e.preventSigmaDefault();
        e.original.preventDefault();
        e.original.stopPropagation();
      });
      captor.on('mouseup', () => {
        dragged = null;
      });
    })();

    return () => {
      killed = true;
      cancelAnimationFrame(raf);
      renderer?.kill();
      renderer = null;
    };
  });

  // toggling "all names" just re-runs the reducers — no relayout
  $effect(() => {
    void showAll;
    renderer?.refresh({ skipIndexation: true });
  });

  // arrow-key panning of the camera (ignored while typing in an input)
  function onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (!renderer || (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable))) return;
    const cam = renderer.getCamera();
    const s = cam.getState();
    const step = (e.shiftKey ? 0.3 : 0.12) * s.ratio;
    let { x, y } = s;
    if (e.key === 'ArrowRight') x += step;
    else if (e.key === 'ArrowLeft') x -= step;
    else if (e.key === 'ArrowDown') y -= step;
    else if (e.key === 'ArrowUp') y += step;
    else return;
    cam.setState({ x, y });
    e.preventDefault();
  }
</script>

<svelte:window onkeydown={onKey} />
<div class="canvas" bind:this={container}></div>
{#if level === 'function' && focusMod}
  <button class="back" onclick={() => forceFocus.set(null)}>← all functions ({shortMod(focusMod)} + callers/callees)</button>
{/if}
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
  .back {
    position: absolute;
    top: 12px;
    left: 12px;
    font-size: 11px;
    padding: 4px 9px;
  }
</style>
