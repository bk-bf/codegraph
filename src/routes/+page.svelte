<script lang="ts">
  import { goto } from '$app/navigation';
  import { buildIndex } from '$lib/graph/indexes';
  import { viewMode, focusModule, selection, plainLabels, coverage, type ViewMode } from '$lib/graph/stores';
  import { onMount } from 'svelte';
  import MermaidView from '$lib/components/MermaidView.svelte';
  import ForceView from '$lib/components/ForceView.svelte';
  import DetailPanel from '$lib/components/DetailPanel.svelte';
  import InsightsPanel from '$lib/components/InsightsPanel.svelte';
  import ListsPanel from '$lib/components/ListsPanel.svelte';
  import type { ListType } from '$lib/graph/stores';

  let { data } = $props();
  const index = $derived(data.graph ? buildIndex(data.graph) : null);

  let mode = $state<ViewMode>('layered');
  viewMode.subscribe((m) => (mode = m));
  let plain = $state(false);
  let cov = $state(false);
  plainLabels.subscribe((v) => (plain = v));
  coverage.subscribe((v) => (cov = v));
  let panel = $state<'detail' | 'insights' | 'list'>('detail');
  let listType = $state<ListType>('functions');
  // Selecting anything flips the panel to detail.
  selection.subscribe((s) => {
    if (s) panel = 'detail';
  });
  function openList(t: ListType) {
    if (panel === 'list' && listType === t) panel = 'detail';
    else {
      listType = t;
      panel = 'list';
    }
  }

  // Persist view prefs across reloads.
  const LS = 'codegraph:view';
  onMount(() => {
    try {
      const s = JSON.parse(localStorage.getItem(LS) || '{}');
      if (s.mode) viewMode.set(s.mode);
      if (s.plain) plainLabels.set(true);
      if (s.cov) coverage.set(true);
    } catch {
      /* ignore */
    }
  });
  $effect(() => {
    try {
      localStorage.setItem(LS, JSON.stringify({ mode, plain, cov }));
    } catch {
      /* ignore */
    }
  });

  function setMode(m: ViewMode) {
    if (m === 'layered' && mode !== 'layered') focusModule.set(null);
    viewMode.set(m);
  }
  function switchProject(e: Event) {
    goto(`/?project=${encodeURIComponent((e.target as HTMLSelectElement).value)}`, { invalidateAll: true });
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
  <button class:on={mode === 'layered'} onclick={() => setMode('layered')}>layered</button>
  <button class:on={mode === 'modules'} onclick={() => setMode('modules')}>modules (force)</button>
  <button class:on={mode === 'functions'} onclick={() => setMode('functions')}>functions (force)</button>
  <span class="sep">·</span>
  <button class:on={plain} onclick={() => plainLabels.set(!plain)} title="Label nodes with plain-English descriptions">plain</button>
  <button class:on={cov} onclick={() => coverage.set(!cov)} title="Colour by test coverage (green tested / red untested)">coverage</button>
  <span class="grow"></span>
  <button class:on={panel === 'insights'} onclick={() => (panel = panel === 'insights' ? 'detail' : 'insights')}>
    ⚑ Insights
  </button>
  {#if data.current}
    <a class="exportbtn" href="/export?project={encodeURIComponent(data.current)}" title="Download a self-contained offline HTML snapshot">⇩ export</a>
  {/if}
  {#if data.graph}
    <span class="sep">·</span>
    <span class="stats">
      <button class="statbtn" class:on={panel === 'list' && listType === 'functions'} onclick={() => openList('functions')}>{data.graph.stats.functions} fns</button> ·
      <button class="statbtn" class:on={panel === 'list' && listType === 'calls'} onclick={() => openList('calls')}>{data.graph.stats.edges} calls</button> ·
      <button class="statbtn" class:on={panel === 'list' && listType === 'modules'} onclick={() => openList('modules')}>{data.graph.stats.modules} modules</button> ·
      <button class="statbtn" class:on={panel === 'list' && listType === 'files'} onclick={() => openList('files')}>{data.graph.stats.files} files</button>
    </span>
  {/if}
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
  </main>

  <aside>
    {#if data.graph && index}
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
  .statbtn {
    background: none;
    border: 0;
    color: var(--fg-dim);
    padding: 2px 3px;
    font: inherit;
    cursor: pointer;
  }
  .statbtn:hover,
  .statbtn.on {
    color: var(--accent2);
  }
  .grow {
    flex: 1;
  }
  .exportbtn {
    font-size: 12px;
    color: var(--fg);
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 4px 9px;
    text-decoration: none;
  }
  .exportbtn:hover {
    border-color: var(--accent2);
    color: var(--accent2);
  }
  .work {
    display: flex;
    height: calc(100vh - 44px);
  }
  main {
    position: relative;
    flex: 1;
    overflow: hidden;
  }
  aside {
    width: 340px;
    flex: none;
    border-left: 1px solid var(--border);
    background: var(--bg-panel);
    overflow-y: auto;
  }
  .empty {
    padding: 40px;
    color: var(--fg-dim);
  }
  code {
    color: var(--accent2);
  }
</style>
