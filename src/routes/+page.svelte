<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { buildIndex } from '$lib/graph/indexes';
  import { viewMode, forceFocus, selection, stageClick, plainLabels, coverage, allLabels, type ViewMode } from '$lib/graph/stores';
  import { onMount } from 'svelte';
  import ForceView from '$lib/components/ForceView.svelte';
  import DetailPanel from '$lib/components/DetailPanel.svelte';
  import InsightsPanel from '$lib/components/InsightsPanel.svelte';
  import ListsPanel from '$lib/components/ListsPanel.svelte';
  import Legend from '$lib/components/Legend.svelte';
  import SearchBar from '$lib/components/SearchBar.svelte';
  import type { ListType } from '$lib/graph/stores';

  let { data } = $props();
  const index = $derived(data.graph ? buildIndex(data.graph) : null);
  // filesystem/infra graphs (Plane B) get file-oriented labels + the force view
  const isFs = $derived((data.graph as unknown as { kind?: string })?.kind === 'filesystem');
  // the machine whose tab is active — its "all" (whole-machine) view + code projects nest under it
  const activeMachine = $derived(data.machines.find((m) => m.name === data.currentMachine) ?? null);

  let mode = $state<ViewMode>('modules');
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
      // 'layered' persists in older browsers' prefs; it is no longer a view.
      if (s.mode === 'modules' || s.mode === 'functions') viewMode.set(s.mode);
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
    forceFocus.set(null); // the toggle shows everything at this level
    viewMode.set(m);
  }
  function switchProject(name: string) {
    if (name === data.current) return;
    goto(`/?project=${encodeURIComponent(name)}`, { invalidateAll: true });
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

<!-- Single top bar — devices shown via the dashboard-style connection pill. -->
<div class="topbar">
  <span class="sw-brand">codegraph</span>
  {#if data.machines.length}
    {@const online = data.machines.filter((m) => m.status === 'online').length}
    {@const curView = activeMachine && data.current === activeMachine.all ? 'all' : data.current}
    <div class="conn">
      <button class="conn-pill" title="{online} of {data.machines.length} machines online — pick a machine · view">
        <span class="dot {activeMachine?.status === 'online' ? 'ok' : activeMachine?.status === 'cached' ? 'stale' : 'off'}"></span>
        <span class="conn-active">{activeMachine?.name ?? '—'}</span>
        <span class="conn-sep">/</span>
        <span class="conn-view">{curView}</span>
        <span class="conn-count">{online}/{data.machines.length}</span>
        <span class="caret">▾</span>
      </button>
      <div class="conn-pop">
        {#each data.machines as m}
          <div class="conn-group">
            <button
              class="conn-head"
              class:active={m.name === data.currentMachine}
              onclick={() => switchProject(m.all ?? m.projects[0])}
              title={m.indexedAt ? 'indexed ' + new Date(m.indexedAt).toLocaleString() : ''}
            >
              <span class="dot {m.status === 'online' ? 'ok' : m.status === 'cached' ? 'stale' : 'off'}"></span>
              <span class="conn-name">{m.name}</span>
              <span class="conn-stat">{m.status}</span>
            </button>
            <div class="conn-items">
              {#if m.all}
                <button class="conn-item" class:active={data.current === m.all} onclick={() => switchProject(m.all!)}>all</button>
              {/if}
              {#each m.projects as p}
                <button class="conn-item" class:active={data.current === p} onclick={() => switchProject(p)}>{p}</button>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
  <span class="vsep"></span>
  <button class="seg" class:on={mode === 'modules'} onclick={() => setMode('modules')}>{isFs ? 'folders' : 'modules'}</button>
  <button class="seg" class:on={mode === 'functions'} onclick={() => setMode('functions')}>{isFs ? 'files' : 'functions'}</button>
  {#if data.graph}<SearchBar graph={data.graph} />{/if}

  <span class="topbar-meta">
    {#if data.graph}
      {#if isFs}
        <span class="stats">
          <button class="statbtn" class:on={panel === 'list' && listType === 'files'} onclick={() => openList('files')}>{data.graph.stats.files.toLocaleString()} files</button> ·
          <button class="statbtn" class:on={panel === 'list' && listType === 'calls'} onclick={() => openList('calls')}>{data.graph.stats.edges.toLocaleString()} links</button> ·
          <button class="statbtn" class:on={panel === 'list' && listType === 'modules'} onclick={() => openList('modules')}>{data.graph.stats.modules.toLocaleString()} folders</button> ·
          <span class="stale" title="files not edited in ≥90 days">{(data.graph.stats as { stale?: number }).stale ?? 0} stale</span>
        </span>
      {:else}
        <span class="stats">
          <button class="statbtn" class:on={panel === 'list' && listType === 'functions'} onclick={() => openList('functions')}>{data.graph.stats.functions} fns</button> ·
          <button class="statbtn" class:on={panel === 'list' && listType === 'calls'} onclick={() => openList('calls')}>{data.graph.stats.edges} calls</button> ·
          <button class="statbtn" class:on={panel === 'list' && listType === 'modules'} onclick={() => openList('modules')}>{data.graph.stats.modules} modules</button> ·
          <button class="statbtn" class:on={panel === 'list' && listType === 'files'} onclick={() => openList('files')}>{data.graph.stats.files} files</button>
        </span>
      {/if}
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
          <div class="mlabel">Labels</div>
          <button class="mitem" class:on={plain} onclick={() => plainLabels.set(!plain)}>plain-English descriptions</button>
          <button class="mitem" class:on={cov} onclick={() => coverage.set(!cov)}>test-coverage colours</button>
          <button class="mitem" class:on={names} onclick={() => allLabels.set(!names)}>all node names</button>
        </div>
      {/if}
    </div>
  </span>
</div>

<div class="work">
  <main>
    {#if !data.graph || !index}
      <div class="empty">No graph data. Run <code>node bin/codegraph.mjs extract</code>.</div>
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
  .sw-brand {
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--accent);
    flex-shrink: 0;
  }
  /* Single top bar (matches the dashboard's .topbar). */
  .topbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 18px;
    background: var(--bg-panel);
    border-bottom: 1px solid var(--border);
  }
  /* Connection pill — machines with live online/cached status (ported from the
     dashboard). The pill shows the active machine + N/total online; hovering
     reveals the switcher, one clickable row per machine. */
  .conn {
    position: relative;
    display: inline-flex;
  }
  .conn-pill {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-size: 12px;
    color: var(--fg);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 3px 11px;
  }
  .conn:hover .conn-pill {
    border-color: var(--fg-dim);
  }
  .conn-active {
    font-weight: 600;
  }
  .conn-sep {
    color: var(--fg-dim);
  }
  .conn-view {
    color: var(--accent);
  }
  .conn-count {
    color: var(--fg-dim);
    font-size: 11px;
    margin-left: 2px;
  }
  .caret {
    color: var(--fg-dim);
    font-size: 9px;
  }
  /* invisible hover bridge so the popup doesn't close in the gap */
  .conn::after {
    content: '';
    position: absolute;
    top: 100%;
    left: 0;
    width: 100%;
    height: 8px;
  }
  .conn-pop {
    position: absolute;
    top: calc(100% + 7px);
    left: 0;
    z-index: 30;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 5px;
    min-width: 200px;
    display: none;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  }
  .conn:hover .conn-pop {
    display: block;
  }
  /* one group per machine: a status header + its nested views (all + projects) */
  .conn-group + .conn-group {
    margin-top: 4px;
    padding-top: 4px;
    border-top: 1px solid var(--border);
  }
  .conn-head {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    background: none;
    border: 0;
    border-radius: 5px;
    padding: 4px 8px;
    font: inherit;
    font-size: 12px;
    color: var(--fg);
    cursor: pointer;
    text-align: left;
  }
  .conn-head:hover {
    background: var(--bg-panel);
  }
  .conn-name {
    flex: 1;
    font-weight: 600;
  }
  .conn-stat {
    color: var(--fg-dim);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .conn-head.active .conn-name {
    color: var(--accent);
  }
  /* nested views under a machine */
  .conn-items {
    display: flex;
    flex-direction: column;
    margin-left: 16px;
    border-left: 1px solid var(--border);
    padding-left: 4px;
  }
  .conn-item {
    text-align: left;
    background: none;
    border: 0;
    border-radius: 4px;
    padding: 3px 8px;
    font: inherit;
    font-size: 12px;
    color: var(--fg-dim);
    cursor: pointer;
  }
  .conn-item:hover {
    background: var(--bg-panel);
    color: var(--fg);
  }
  .conn-item.active {
    color: var(--accent);
  }
  /* status dots */
  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex: none;
  }
  .dot.ok {
    background: #57d9a3;
  }
  .dot.stale {
    background: #e3b341;
  }
  .dot.off {
    background: var(--fg-dim);
  }
  .topbar-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
  }
  .vsep {
    width: 1px;
    height: 18px;
    background: var(--border);
    margin: 0 3px;
  }
  /* Same-sized view-mode buttons. */
  .seg {
    min-width: 74px;
    text-align: center;
  }
  .stale {
    color: #ff8a5c;
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
    flex: 1;
    min-height: 0;
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
