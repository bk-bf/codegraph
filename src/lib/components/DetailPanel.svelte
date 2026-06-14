<script lang="ts">
  import type { RawGraph } from '$lib/graph/types';
  import type { GraphIndex } from '$lib/graph/indexes';
  import { describer } from '$lib/graph/describe';
  import { groupColor } from '$lib/graph/colors';
  import { selection, focusModule, viewMode, type Selection } from '$lib/graph/stores';

  let { graph, index }: { graph: RawGraph; index: GraphIndex } = $props();
  const { shortMod, fnDesc, modDesc, vscodeUrl } = describer(graph);

  let sel = $state<Selection>(null);
  selection.subscribe((s) => (sel = s));

  const node = (id: string) => index.nodeById.get(id);
  const mod = (m: string) => index.modByName.get(m);

  function selNode(id: string) {
    selection.set({ type: 'node', id });
  }
  function selModule(m: string) {
    selection.set({ type: 'module', module: m });
  }
  function openInGraph(m: string) {
    focusModule.set(m);
    viewMode.set('layered');
    selModule(m);
  }
</script>

{#if !sel}
  <div class="empty">Select a node, module, or edge.</div>
{:else if sel.type === 'node' && node(sel.id)}
  {@const n = node(sel.id)!}
  {@const callees = index.callees.get(n.id) ?? []}
  {@const callers = index.callers.get(n.id) ?? []}
  <div class="dh">
    <div class="kind" style="color:{groupColor(n.group)}">{n.kind}{n.exported ? ' · exported' : ''}</div>
    <h2>{n.short}</h2>
  </div>
  <div class="body">
    <div class="row"><div class="lbl">What it does</div><div class="desc">{fnDesc(n)}</div></div>
    <div class="row"><div class="lbl">Signature</div><div class="sig">{n.signature}</div></div>
    <div class="row">
      <div class="lbl">Location</div>
      <a href={vscodeUrl(n)}>{n.file}:{n.line}</a> ·
      <button class="link" onclick={() => openInGraph(n.module)}>module graph</button>
    </div>
    <div class="row">
      <div class="lbl">Calls ({callees.length})</div>
      <ul>
        {#each callees as c}
          <li><button class="link" onclick={() => selNode(c.id)}>{c.short}</button><span class="cnt">{shortMod(c.module)}</span></li>
        {:else}
          <li class="none">— leaf —</li>
        {/each}
      </ul>
    </div>
    <div class="row">
      <div class="lbl">Called by ({callers.length})</div>
      <ul>
        {#each callers as c}
          <li><button class="link" onclick={() => selNode(c.id)}>{c.short}</button><span class="cnt">{shortMod(c.module)}</span></li>
        {:else}
          <li class="none">— entry point —</li>
        {/each}
      </ul>
    </div>
  </div>
{:else if sel.type === 'module' && mod(sel.module)}
  {@const m = mod(sel.module)!}
  {@const fns = graph.nodes.filter((x) => x.module === m.module).sort((a, b) => b.inDegree - a.inDegree)}
  {@const outs = (index.modOut.get(m.module) ?? []).slice().sort((a, b) => b.count - a.count)}
  {@const ins = (index.modIn.get(m.module) ?? []).slice().sort((a, b) => b.count - a.count)}
  <div class="dh">
    <div class="kind" style="color:{groupColor(m.group)}">{m.group} module</div>
    <h2>{shortMod(m.module)}</h2>
  </div>
  <div class="body">
    <div class="row"><div class="desc">{modDesc(m)}</div></div>
    <div class="row"><div class="lbl">File</div><a href={vscodeUrl({ file: m.file, line: 1 })}>{m.file}</a></div>
    <div class="row"><button class="link" onclick={() => openInGraph(m.module)}>▸ open {fns.length} functions in graph</button></div>
    <div class="row">
      <div class="lbl">Depends on ({outs.length})</div>
      <ul>
        {#each outs as e}
          <li><button class="link" onclick={() => selModule(e.to)}>{shortMod(e.to)}</button><span class="cnt">{e.count}</span></li>
        {:else}
          <li class="none">— none —</li>
        {/each}
      </ul>
    </div>
    <div class="row">
      <div class="lbl">Used by ({ins.length})</div>
      <ul>
        {#each ins as e}
          <li><button class="link" onclick={() => selModule(e.from)}>{shortMod(e.from)}</button><span class="cnt">{e.count}</span></li>
        {:else}
          <li class="none">— none —</li>
        {/each}
      </ul>
    </div>
    <div class="row">
      <div class="lbl">Top functions</div>
      <ul>
        {#each fns.slice(0, 12) as n}
          <li><button class="link" onclick={() => selNode(n.id)}>{n.short}</button><span class="cnt">{n.inDegree}←</span></li>
        {/each}
      </ul>
    </div>
  </div>
{/if}

<style>
  .empty {
    padding: 24px;
    color: var(--fg-dim);
  }
  .dh {
    padding: 14px 16px;
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    background: var(--bg-panel);
  }
  .kind {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .dh h2 {
    margin: 4px 0 0;
    font-size: 14px;
    word-break: break-word;
  }
  .body {
    padding: 12px 16px;
  }
  .row {
    margin-bottom: 14px;
  }
  .lbl {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--fg-dim);
    margin-bottom: 3px;
  }
  .desc {
    line-height: 1.5;
  }
  .sig {
    font-size: 11px;
    color: var(--accent2);
    word-break: break-word;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 2px 0;
    border-bottom: 1px solid #1a2029;
  }
  li.none {
    color: var(--fg-dim);
  }
  .cnt {
    color: var(--fg-dim);
    flex: none;
  }
  button.link,
  a {
    background: none;
    border: 0;
    padding: 0;
    color: var(--accent2);
    cursor: pointer;
    font: inherit;
    text-align: left;
  }
  button.link:hover,
  a:hover {
    text-decoration: underline;
    color: var(--accent2);
  }
</style>
