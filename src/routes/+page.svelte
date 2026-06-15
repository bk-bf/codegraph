<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { buildIndex } from '$lib/graph/indexes';
  import { viewMode, focusModule, forceFocus, selection, stageClick, plainLabels, coverage, allLabels, type ViewMode } from '$lib/graph/stores';
  import { onMount } from 'svelte';
  import MermaidView from '$lib/components/MermaidView.svelte';
  import ForceView from '$lib/components/ForceView.svelte';
  import DetailPanel from '$lib/components/DetailPanel.svelte';
  import InsightsPanel from '$lib/components/InsightsPanel.svelte';
  import ListsPanel from '$lib/components/ListsPanel.svelte';
  import Legend from '$lib/components/Legend.svelte';
  import SearchBar from '$lib/components/SearchBar.svelte';
  import type { ListType } from '$lib/graph/stores';

  let { data } = $props();
  const index = $derived(data.graph ? buildIndex(data.graph) : null);

  let mode = $state<ViewMode>('layered');
  viewMode.subscribe((m) => (mode = m));
  let plain = $state(false);
  let cov = $state(false);
  let names = $state(false);
  plainLabels.subscribe((v) => (plain = v));
  coverage.subscribe((v) => (cov = v));
  allLabels.subscribe((v) => (names = v));
  let panel = $state<'detail' | 'insights' | 'list'>('detail');
  let listType = $state<ListType>('functions');
  let asideOpen = $state(false);
  let menuOpen = $state(false);
  // Selecting reveals the detail panel; deselecting it closes the panel.
  selection.subscribe((s) => {
    if (s) {
      panel = 'detail';
      asideOpen = true;
    } else if (panel === 'detail') {
      asideOpen = false;
    }
  });
  // A click on empty graph space closes whatever the panel is showing
  // (selection.set(null) alone won't notify when nothing was selected).
  stageClick.subscribe(() => (asideOpen = false));
  function openList(t: ListType) {
    if (panel === 'list' && listType === t && asideOpen) asideOpen = false;
    else {
      listType = t;
      panel = 'list';
      asideOpen = true;
    }
  }
  function toggleInsights() {
    if (panel === 'insights' && asideOpen) asideOpen = false;
    else {
      panel = 'insights';
      asideOpen = true;
    }
  }
  // Close the overflow menu when focus leaves it (click/tab outside).
  function onMenuBlur(e: FocusEvent) {
    const cur = e.currentTarget as HTMLElement;
    if (!cur.contains(e.relatedTarget as Node | null)) menuOpen = false;
  }

  // Persist view prefs across reloads.
  const LS = 'codegraph:view';
  onMount(() => {
    try {
      const s = JSON.parse(localStorage.getItem(LS) || '{}');
      if (s.mode) viewMode.set(s.mode);
      if (s.plain) plainLabels.set(true);
      if (s.cov) coverage.set(true);
      if (s.names) allLabels.set(true);
    } catch {
      /* ignore */
    }
  });
  $effect(() => {
    try {
      localStorage.setItem(LS, JSON.stringify({ mode, plain, cov, names }));
    } catch {
      /* ignore */
    }
  });

  function setMode(m: ViewMode) {
    if (m === 'layered' && mode !== 'layered') focusModule.set(null);
    forceFocus.set(null); // the toggle shows everything at this level
    viewMode.set(m);
  }
  function switchProject(e: Event) {
    goto(`/?project=${encodeURIComponent((e.target as HTMLSelectElement).value)}`, { invalidateAll: true });
  }
  // Rebuild the graph from the current source, on demand (no background watcher).
  let refreshing = $state(false);
  async function refresh() {
    if (refreshing || !data.current) return;
    refreshing = true;
    try {
      const res = await fetch(`/api/refresh?project=${encodeURIComponent(data.current)}`, { method: 'POST' });
      if (res.ok) await invalidateAll();
      else console.error('codegraph: rebuild failed', res.status);
    } catch (e) {
      console.error('codegraph: rebuild error', e);
    } finally {
      refreshing = false;
    }
  }
</script>

<header>
  <strong>codegraph</strong>
  <span class="sep">·</span>
  <button class="seg" class:on={mode === 'layered'} onclick={() => setMode('layered')}>layered</button>
  <button class="seg" class:on={mode === 'modules'} onclick={() => setMode('modules')}>modules</button>
  <button class="seg" class:on={mode === 'functions'} onclick={() => setMode('functions')}>functions</button>
  {#if data.graph}<SearchBar graph={data.graph} />{/if}
  <span class="grow"></span>
  {#if data.graph}
    <span class="stats">
      <button class="statbtn" class:on={panel === 'list' && listType === 'functions'} onclick={() => openList('functions')}>{data.graph.stats.functions} fns</button> ·
      <button class="statbtn" class:on={panel === 'list' && listType === 'calls'} onclick={() => openList('calls')}>{data.graph.stats.edges} calls</button> ·
      <button class="statbtn" class:on={panel === 'list' && listType === 'modules'} onclick={() => openList('modules')}>{data.graph.stats.modules} modules</button> ·
      <button class="statbtn" class:on={panel === 'list' && listType === 'files'} onclick={() => openList('files')}>{data.graph.stats.files} files</button>
    </span>
    <button
      class="icon"
      class:spin={refreshing}
      title="Rebuild the graph from the current source — last built {new Date(data.graph.generatedAt).toLocaleString()}"
      aria-label="Rebuild graph"
      onclick={refresh}
      disabled={refreshing}><span class="ico">↻</span></button>
    <button class="icon" class:on={panel === 'insights' && asideOpen} title="Insights" aria-label="Insights" onclick={toggleInsights}>⚑</button>
  {/if}
  <div class="menu" onfocusout={onMenuBlur}>
    <button class="icon" class:on={menuOpen} title="More" aria-label="More options" onclick={() => (menuOpen = !menuOpen)}>⋯</button>
    {#if menuOpen}
      <div class="menupop">
        {#if data.projects.length}
          <div class="mlabel">Project</div>
          <select onchange={switchProject} value={data.current}>
            {#each data.projects as p}<option value={p}>{p}</option>{/each}
          </select>
        {/if}
        <div class="mlabel">Labels</div>
        <button class="mitem" class:on={plain} onclick={() => plainLabels.set(!plain)}>plain-English descriptions</button>
        <button class="mitem" class:on={cov} onclick={() => coverage.set(!cov)}>test-coverage colours</button>
        {#if mode !== 'layered'}
          <button class="mitem" class:on={names} onclick={() => allLabels.set(!names)}>all node names</button>
        {/if}
        {#if data.current}
          <div class="mlabel">Export</div>
          <a class="mitem" href="/export?project={encodeURIComponent(data.current)}" title="Download a self-contained offline HTML snapshot">⇩ offline HTML snapshot</a>
        {/if}
      </div>
    {/if}
  </div>
</header>

<div class="work">
  <main>
    {#if !data.graph || !index}
      <div class="empty">No graph data. Run <code>node bin/codegraph.mjs extract</code>.</div>
    {:else if mode === 'layered'}
      {#key data.current}<MermaidView graph={data.graph} {index} />{/key}
    {:else}
      {#key data.current + mode}<ForceView graph={data.graph} level={mode === 'modules' ? 'module' : 'function'} />{/key}
    {/if}
    {#if data.graph}<Legend graph={data.graph} />{/if}
  </main>

  <aside class:collapsed={!asideOpen}>
    {#if data.graph && index}
      <button class="aside-close" title="Close panel" onclick={() => (asideOpen = false)}>×</button>
      {#if panel === 'insights'}
        {#key data.current}<InsightsPanel graph={data.graph} />{/key}
      {:else if panel === 'list'}
        {#key data.current + listType}<ListsPanel graph={data.graph} {index} type={listType} />{/key}
      {:else}
        <DetailPanel graph={data.graph} {index} />
      {/if}
    {/if}
  </aside>
</div>

<style>
  header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-panel);
    height: 36px;
  }
  /* Same-sized view-mode buttons. */
  .seg {
    min-width: 78px;
    text-align: center;
  }
  /* Square icon buttons (Insights, overflow menu). */
  .icon {
    min-width: 0;
    width: 28px;
    padding: 3px 0;
    text-align: center;
    font-size: 13px;
    line-height: 1;
  }
  /* Active state: a yellow outline + text rather than a heavy filled highlight,
     so an active button doesn't read as "thicker" than the others. */
  .seg.on,
  .icon.on {
    background: var(--bg);
    border-color: var(--accent);
    color: var(--accent);
  }
  .icon:disabled {
    cursor: default;
    opacity: 0.7;
  }
  /* Spin only the glyph, not the whole button. */
  .icon .ico {
    display: inline-block;
    line-height: 1;
  }
  .icon.spin {
    color: var(--accent);
  }
  .icon.spin .ico {
    animation: cg-spin 0.8s linear infinite;
  }
  @keyframes cg-spin {
    to {
      transform: rotate(360deg);
    }
  }
  header strong {
    color: var(--accent);
    letter-spacing: 1px;
  }
  .sep {
    color: var(--fg-dim);
  }
  .grow {
    flex: 1;
  }
  /* Stat shortcuts (fns / calls / modules / files) — link-like, never filled. */
  .stats {
    color: var(--fg-dim);
    white-space: nowrap;
  }
  .statbtn {
    background: none;
    border: 0;
    min-width: 0;
    color: var(--fg-dim);
    padding: 2px 3px;
    font: inherit;
    cursor: pointer;
  }
  .statbtn:hover,
  .statbtn.on {
    background: none;
    color: var(--accent2);
  }
  /* Overflow menu: project picker, label toggles, list shortcuts. */
  .menu {
    position: relative;
  }
  .menupop {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 30;
    min-width: 210px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 6px 22px rgba(0, 0, 0, 0.45);
  }
  .mlabel {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--fg-dim);
    padding: 6px 7px 2px;
  }
  .menupop select {
    width: 100%;
  }
  .mitem {
    width: 100%;
    text-align: left;
    background: none;
    border: 0;
    border-radius: 4px;
    padding: 4px 7px;
    color: var(--fg);
    text-decoration: none;
  }
  .mitem:hover {
    background: var(--bg-panel);
    border-color: transparent;
    color: var(--accent2);
  }
  .mitem.on {
    background: var(--bg-panel);
    color: var(--accent);
  }
  .work {
    position: relative;
    height: calc(100vh - 36px);
  }
  main {
    position: absolute;
    inset: 0;
    overflow: hidden;
    /* signature dotted-grid backdrop from the original viewer */
    background: radial-gradient(circle at 1px 1px, #1a2029 1px, transparent 0) 0 0 / 26px 26px var(--bg);
  }
  /* Overlay panel — sits on top of the graph instead of pushing it, so opening
     it never resizes <main> (which would re-fit/re-render the graph = jank). */
  aside {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 340px;
    z-index: 10;
    border-left: 1px solid var(--border);
    background: var(--bg-panel);
    overflow-y: auto;
    box-shadow: -8px 0 24px rgba(0, 0, 0, 0.35);
  }
  aside.collapsed {
    display: none;
  }
  .aside-close {
    position: absolute;
    top: 9px;
    right: 12px;
    z-index: 5;
    background: none;
    border: 0;
    color: var(--fg-dim);
    font-size: 18px;
    line-height: 1;
    padding: 0 4px;
    cursor: pointer;
  }
  .aside-close:hover {
    color: var(--accent2);
  }
  .empty {
    padding: 40px;
    color: var(--fg-dim);
  }
  code {
    color: var(--accent2);
  }
</style>
