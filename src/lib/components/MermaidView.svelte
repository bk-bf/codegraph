<script lang="ts">
  import type { RawGraph } from '$lib/graph/types';
  import type { GraphIndex } from '$lib/graph/indexes';
  import { groupColor } from '$lib/graph/colors';
  import { selection, focusModule } from '$lib/graph/stores';

  let { graph, index }: { graph: RawGraph; index: GraphIndex } = $props();
  const prefix = graph.config?.namespacePrefix ?? null;
  const sm = (m: string) => (prefix && m.startsWith(prefix + '/') ? m.slice(prefix.length + 1) : m);

  let viewport: HTMLDivElement | undefined = $state();
  let focus = $state<string | null>(null);
  focusModule.subscribe((f) => (focus = f));

  let pz = $state({ x: 0, y: 0, k: 0.85 });
  let seq = 0;
  // svg <g> ↔ graph id, for click/hover wiring after each render.
  let gidBySvg = new Map<Element, string>();
  let svgByGid = new Map<string, Element>();
  let eList: { from: string; to: string }[] = [];

  // ---- mermaid source builders (ported) ----
  const esc = (s: string) => String(s).replace(/["#;{}]/g, ' ').replace(/\s+/g, ' ').trim();
  function shade(hex: string) {
    const c = hex.replace('#', '');
    const p = (i: number) => Math.round(parseInt(c.slice(i, i + 2), 16) * 0.28).toString(16).padStart(2, '0');
    return `#${p(0)}${p(2)}${p(4)}`;
  }

  function buildOverview() {
    const grouped: Record<string, typeof graph.moduleNodes> = {};
    for (const m of graph.moduleNodes) (grouped[m.group] ||= []).push(m);
    let src = 'flowchart TB\n';
    const idMap = new Map<string, string>();
    let i = 0;
    for (const m of graph.moduleNodes) idMap.set(m.module, 'm' + i++);
    const styles: string[] = [];
    for (const [grp, mods] of Object.entries(grouped)) {
      src += `subgraph G_${grp}["${grp.toUpperCase()}"]\n`;
      for (const m of mods) {
        const sid = idMap.get(m.module)!;
        src += `  ${sid}["${esc(m.module.split('/').pop()!)}<br/>${m.fns} fn"]\n`;
        styles.push(`style ${sid} fill:${shade(groupColor(grp))},stroke:${groupColor(grp)},color:#e6edf3`);
      }
      src += 'end\n';
    }
    const edges: { from: string; to: string }[] = [];
    for (const e of graph.moduleEdges) {
      const a = idMap.get(e.from), b = idMap.get(e.to);
      if (!a || !b) continue;
      src += `${a} ${e.count >= 6 ? '==>' : '-->'} ${b}\n`;
      edges.push({ from: e.from, to: e.to });
    }
    src += styles.join('\n') + '\n';
    return { src, idMap, eList: edges };
  }

  function buildModule(modName: string) {
    const fns = graph.nodes.filter((n) => n.module === modName);
    const fnIds = new Set(fns.map((n) => n.id));
    const neigh = new Set<string>();
    for (const n of fns) {
      for (const c of index.callees.get(n.id) ?? []) if (!fnIds.has(c.id)) neigh.add(c.id);
      for (const c of index.callers.get(n.id) ?? []) if (!fnIds.has(c.id)) neigh.add(c.id);
    }
    const visible = new Set([...fnIds, ...neigh]);
    const idMap = new Map<string, string>();
    let i = 0;
    for (const id of visible) idMap.set(id, 'f' + i++);
    let src = 'flowchart TB\n';
    const styles: string[] = [];
    src += `subgraph FOCUS["${esc(sm(modName))}"]\n`;
    for (const n of fns) {
      const sid = idMap.get(n.id)!;
      src += `  ${sid}["${esc(n.short)}"]\n`;
      const c = groupColor(n.group);
      styles.push(`style ${sid} fill:${shade(c)},stroke:${c},color:#e6edf3`);
    }
    src += 'end\n';
    const byMod: Record<string, string[]> = {};
    for (const id of neigh) {
      const n = index.nodeById.get(id)!;
      (byMod[n.module] ||= []).push(id);
    }
    let gi = 0;
    for (const [mod, list] of Object.entries(byMod)) {
      src += `subgraph N${gi++}["${esc(sm(mod))}"]\n`;
      for (const id of list) {
        const n = index.nodeById.get(id)!;
        const sid = idMap.get(id)!;
        src += `  ${sid}(["${esc(n.short)}"])\n`;
        const c = groupColor(n.group);
        styles.push(`style ${sid} fill:#161b22,stroke:${c},color:${c}`);
      }
      src += 'end\n';
    }
    const edges: { from: string; to: string }[] = [];
    for (const e of graph.edges) {
      if (!visible.has(e.from) || !visible.has(e.to)) continue;
      const a = idMap.get(e.from), b = idMap.get(e.to);
      const internal = fnIds.has(e.from) && fnIds.has(e.to);
      src += `${a} ${internal ? '-->' : '-.->'} ${b}\n`;
      edges.push({ from: e.from, to: e.to });
    }
    src += styles.join('\n') + '\n';
    return { src, idMap, eList: edges };
  }

  async function render() {
    if (!viewport) return;
    const mySeq = ++seq;
    const { default: mermaid } = await import('mermaid');
    mermaid.initialize({
      startOnLoad: false,
      theme: 'dark',
      securityLevel: 'loose',
      flowchart: { useMaxWidth: false, htmlLabels: false, curve: 'basis', nodeSpacing: 45, rankSpacing: 70 },
      themeVariables: {
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: '13px',
        lineColor: '#5b6675',
        mainBkg: '#1c232d',
        clusterBkg: '#13181f',
        clusterBorder: '#2a313c'
      }
    });
    const built = focus ? buildModule(focus) : buildOverview();
    let svg: string;
    try {
      ({ svg } = await mermaid.render('mmd' + mySeq, built.src));
    } catch (e) {
      if (viewport && mySeq === seq) viewport.innerHTML = `<pre class="err">${(e as Error).message}</pre>`;
      return;
    }
    if (!viewport || mySeq !== seq) return;
    viewport.innerHTML = svg;
    eList = built.eList;
    gidBySvg = new Map();
    svgByGid = new Map();
    const rev = new Map([...built.idMap.entries()].map(([gid, sid]) => [sid, gid]));
    const svgEl = viewport.querySelector('svg')!;
    svgEl.removeAttribute('width');
    svgEl.removeAttribute('height');
    svgEl.querySelectorAll('g.node').forEach((g) => {
      const m = /flowchart-(m\d+|f\d+)-/.exec(g.id) || /(m\d+|f\d+)/.exec(g.id);
      const gid = m && rev.get(m[1]);
      if (!gid) return;
      gidBySvg.set(g, gid);
      svgByGid.set(gid, g);
      g.addEventListener('mouseenter', () => highlight(gid));
      g.addEventListener('mouseleave', clearHighlight);
      g.addEventListener('click', (ev) => {
        ev.stopPropagation();
        onNodeClick(gid);
      });
    });
    const paths = [...svgEl.querySelectorAll('g.edgePaths > path')];
    paths.forEach((p, idx) => {
      const e = built.eList[idx];
      if (!e) return;
      p.addEventListener('mouseenter', () => {
        svgEl.classList.add('has-focus');
        p.classList.add('hot');
        [e.from, e.to].forEach((g) => svgByGid.get(g)?.classList.add('hot'));
      });
      p.addEventListener('mouseleave', clearHighlight);
    });
    (svgEl as SVGElement & { _paths?: Element[] })._paths = paths;
  }

  function highlight(gid: string) {
    const svgEl = viewport?.querySelector('svg');
    if (!svgEl) return;
    svgEl.classList.add('has-focus');
    svgByGid.get(gid)?.classList.add('hot', 'origin');
    const paths = (svgEl as SVGElement & { _paths?: Element[] })._paths ?? [];
    eList.forEach((e, idx) => {
      if (e.from === gid || e.to === gid) {
        paths[idx]?.classList.add('hot');
        svgByGid.get(e.from === gid ? e.to : e.from)?.classList.add('hot');
      }
    });
  }
  function clearHighlight() {
    const svgEl = viewport?.querySelector('svg');
    if (!svgEl) return;
    svgEl.classList.remove('has-focus');
    svgEl.querySelectorAll('.hot, .origin').forEach((el) => el.classList.remove('hot', 'origin'));
  }

  function onNodeClick(gid: string) {
    if (focus) selection.set({ type: 'node', id: gid });
    else selection.set({ type: 'module', module: gid });
  }

  // pan / zoom
  let drag: { x: number; y: number; ox: number; oy: number } | null = null;
  function down(e: MouseEvent) {
    if ((e.target as Element).closest('.node') || (e.target as Element).closest('path')) return;
    drag = { x: e.clientX, y: e.clientY, ox: pz.x, oy: pz.y };
  }
  function move(e: MouseEvent) {
    if (!drag) return;
    pz = { ...pz, x: drag.ox + (e.clientX - drag.x), y: drag.oy + (e.clientY - drag.y) };
  }
  function up() {
    drag = null;
  }
  function wheel(e: WheelEvent) {
    e.preventDefault();
    const k = Math.max(0.15, Math.min(3, pz.k * (e.deltaY < 0 ? 1.1 : 0.9)));
    pz = { ...pz, k };
  }

  $effect(() => {
    void focus;
    render();
  });
</script>

<svelte:window onmousemove={move} onmouseup={up} />
<div
  class="stage"
  role="application"
  onmousedown={down}
  onwheel={wheel}
  onclick={(e) => {
    if (e.target === e.currentTarget) selection.set(null);
  }}
>
  <div class="viewport" bind:this={viewport} style="transform: translate({pz.x}px,{pz.y}px) scale({pz.k})"></div>
  {#if focus}
    <button class="back" onclick={() => focusModule.set(null)}>← all modules</button>
  {/if}
</div>

<style>
  .stage {
    position: absolute;
    inset: 0;
    overflow: hidden;
    cursor: grab;
  }
  .stage:active {
    cursor: grabbing;
  }
  .viewport {
    position: absolute;
    top: 20px;
    left: 50%;
    transform-origin: top center;
    will-change: transform;
  }
  .back {
    position: absolute;
    top: 12px;
    left: 12px;
    z-index: 2;
  }
  .viewport :global(g.node) {
    cursor: pointer;
  }
  .viewport :global(svg.has-focus g.node:not(.hot)) {
    opacity: 0.18;
  }
  .viewport :global(svg.has-focus g.edgePaths path:not(.hot)) {
    opacity: 0.07;
  }
  .viewport :global(g.node.hot .label) {
    font-weight: 600;
  }
  .viewport :global(path.hot) {
    stroke: var(--accent2) !important;
    stroke-width: 2.5px !important;
  }
  .viewport :global(.err) {
    color: #ff6b6b;
    padding: 20px;
  }
</style>
