<script lang="ts">
  import type { RawGraph } from '$lib/graph/types';
  import type { GraphIndex } from '$lib/graph/indexes';
  import { onMount } from 'svelte';
  import { groupColor } from '$lib/graph/colors';
  import { describer } from '$lib/graph/describe';
  import { selection, focusModule, plainLabels, coverage } from '$lib/graph/stores';

  let { graph, index }: { graph: RawGraph; index: GraphIndex } = $props();
  const prefix = graph.config?.namespacePrefix ?? null;
  const sm = (m: string) => (prefix && m.startsWith(prefix + '/') ? m.slice(prefix.length + 1) : m);
  const { fnDesc, modDesc } = describer(graph);
  const COV = { good: '#7ee787', mid: '#f5a623', bad: '#ff6b6b' };
  const SEP = '────────';

  let viewport: HTMLDivElement | undefined = $state();
  let focus = $state<string | null>(null);
  let plain = $state(false);
  let cov = $state(false);
  focusModule.subscribe((f) => (focus = f));
  plainLabels.subscribe((v) => (plain = v));
  coverage.subscribe((v) => (cov = v));

  // user-pinned default zoom % for new views (0 = fit-to-screen)
  let defaultPct = $state(0);
  onMount(() => {
    const v = parseInt(localStorage.getItem('codegraph:mermaidZoom') || '0', 10);
    if (!isNaN(v)) defaultPct = v;
  });

  // coverage stroke for a module (by tested fraction) or function (tested?)
  const covModuleColor = (mod: string) => {
    const fns = graph.nodes.filter((n) => n.module === mod && (n.kind === 'function' || n.kind === 'method'));
    if (!fns.length) return null;
    const r = fns.filter((n) => n.tested).length / fns.length;
    return r > 0.66 ? COV.good : r > 0.2 ? COV.mid : COV.bad;
  };

  let pz = $state({ x: 0, y: 0, k: 0.85 });
  let seq = 0;
  // svg <g> ↔ graph id, for click/hover wiring after each render.
  let gidBySvg = new Map<Element, string>();
  let svgByGid = new Map<string, Element>();
  let eList: { from: string; to: string }[] = [];

  // ---- mermaid source builders (ported) ----
  const esc = (s: string) => String(s).replace(/["#;{}]/g, ' ').replace(/\s+/g, ' ').trim();
  // word-wrap to ~n chars per line, joined with mermaid <br/> breaks
  function wrap(s: string, n = 24): string {
    const e = esc(s);
    if (e.length <= n) return e;
    const lines: string[] = [];
    let cur = '';
    for (const w of e.split(' ')) {
      if (cur && (cur + ' ' + w).length > n) {
        lines.push(cur);
        cur = w;
      } else cur = cur ? cur + ' ' + w : w;
    }
    if (cur) lines.push(cur);
    return lines.join('<br/>');
  }
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
        const lbl = plain ? `${esc(m.module.split('/').pop()!)}<br/>${SEP}<br/>${wrap(modDesc(m).split('. ')[0], 24)}` : `${esc(m.module.split('/').pop()!)}<br/>${m.fns} fn`;
        src += `  ${sid}["${lbl}"]\n`;
        const stroke = (cov && covModuleColor(m.module)) || groupColor(grp);
        styles.push(`style ${sid} fill:${shade(groupColor(grp))},stroke:${stroke},color:#e6edf3${cov ? ',stroke-width:2.5px' : ''}`);
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
      const lbl = plain ? `${esc(n.short)}<br/>${SEP}<br/>${wrap(fnDesc(n), 24)}` : esc(n.short);
      src += `  ${sid}["${lbl}"]\n`;
      const c = groupColor(n.group);
      const stroke = cov ? (n.tested ? COV.good : COV.bad) : c;
      styles.push(`style ${sid} fill:${shade(c)},stroke:${stroke},color:#e6edf3${cov ? ',stroke-width:2.5px' : ''}`);
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
    const svgEl = viewport.querySelector('svg')! as SVGSVGElement;
    // Keep mermaid's explicit px width/height (useMaxWidth:false sets them) so the
    // SVG has an intrinsic size in the absolutely-positioned viewport; just lift
    // the max-width cap so it isn't clamped, and scaling happens via the transform.
    svgEl.style.maxWidth = 'none';
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
    applyInitialZoom(); // pinned default zoom, else centre + fit
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
    setZoom(pz.k * (e.deltaY < 0 ? 1.1 : 0.9));
  }
  const clampK = (k: number) => Math.max(0.15, Math.min(3, k));
  function setZoom(k: number) {
    pz = { ...pz, k: clampK(k) };
  }
  function centerAt(k: number) {
    const svg = viewport?.querySelector('svg') as SVGGraphicsElement | null;
    const stage = viewport?.parentElement;
    if (!svg || !stage) return;
    const b = svg.getBBox();
    if (!b.width || !b.height) return;
    pz = { k, x: (stage.clientWidth - b.width * k) / 2 - b.x * k, y: 24 - b.y * k };
  }
  function fit() {
    const svg = viewport?.querySelector('svg') as SVGGraphicsElement | null;
    const stage = viewport?.parentElement;
    if (!svg || !stage) return;
    const b = svg.getBBox();
    if (!b.width || !b.height) return;
    centerAt(clampK(Math.min(stage.clientWidth / b.width, (stage.clientHeight - 40) / b.height) * 0.92));
  }
  // on (re)render: honour a pinned default zoom, else fit-to-screen
  function applyInitialZoom() {
    if (defaultPct > 0) centerAt(clampK(defaultPct / 100));
    else fit();
  }
  function setZoomPct(v: string) {
    const n = parseInt(v, 10);
    if (!isNaN(n)) setZoom(n / 100);
  }
  function pinDefault() {
    defaultPct = Math.round(pz.k * 100);
    try {
      localStorage.setItem('codegraph:mermaidZoom', String(defaultPct));
    } catch {
      /* ignore */
    }
  }

  $effect(() => {
    void focus;
    void plain;
    void cov;
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
  <div class="zoom">
    <button onclick={() => setZoom(pz.k * 0.83)} title="Zoom out">−</button>
    <span class="readout">
      <input
        class="pct"
        inputmode="numeric"
        autocomplete="off"
        value={Math.round(pz.k * 100)}
        onkeydown={(e) => e.key === 'Enter' && setZoomPct((e.currentTarget as HTMLInputElement).value)}
        onblur={(e) => setZoomPct((e.currentTarget as HTMLInputElement).value)}
      /><span class="sign">%</span>
    </span>
    <button onclick={() => setZoom(pz.k * 1.2)} title="Zoom in">+</button>
    <button onclick={fit} title="Fit to screen">⤢</button>
    <button class:on={defaultPct > 0} onclick={pinDefault} title="Pin current zoom as the default for new views">★</button>
  </div>
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
    top: 0;
    left: 0;
    transform-origin: 0 0;
    will-change: transform;
  }
  .back {
    position: absolute;
    top: 12px;
    left: 12px;
    z-index: 2;
  }
  .zoom {
    position: absolute;
    bottom: 12px;
    left: 12px;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 4px;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 3px 5px;
  }
  .zoom button {
    background: none;
    border: 0;
    color: var(--fg-dim);
    cursor: pointer;
    font: inherit;
    padding: 0 5px;
  }
  .zoom button:hover {
    color: var(--accent2);
  }
  .zoom button.on {
    background: none;
    color: var(--accent);
    font-weight: 400;
  }
  .readout {
    display: inline-flex;
    align-items: center;
    color: var(--fg-dim);
    font-size: 11px;
  }
  .pct {
    width: 30px;
    background: none;
    border: 0;
    color: var(--fg);
    font: inherit;
    text-align: right;
    padding: 0;
    -moz-appearance: textfield;
  }
  .pct:focus {
    outline: none;
    color: var(--accent2);
  }
  .sign {
    color: var(--fg-dim);
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
