<script lang="ts">
  import type { RawGraph } from '$lib/graph/types';
  // Same analysis code as the CLI checker — reused client-side.
  import { runChecks, portCandidates, orphans, recommendations } from '$lib/core/analysis.mjs';
  import { selection } from '$lib/graph/stores';

  let { graph }: { graph: RawGraph } = $props();

  interface Row {
    label: string;
    sub?: string;
    nav?: ['node' | 'mod', string];
  }
  interface Group {
    section: string;
    sev: 'error' | 'warn' | 'info';
    title: string;
    badge: string | number;
    why?: string;
    rows: Row[];
  }

  const SECTIONS: [string, string][] = [
    ['check', 'Architecture check'],
    ['rec', 'Recommended'],
    ['ports', 'Port candidates'],
    ['orphans', 'Dead-code candidates']
  ];

  const chk = runChecks(graph);
  const groups: Group[] = [];
  for (const rule of chk.rules) {
    const fs = chk.findings.filter((f: any) => f.rule === rule);
    const sev = fs.some((f: any) => f.level === 'error') ? 'error' : fs.length ? 'warn' : 'info';
    groups.push({
      section: 'check',
      sev,
      title: rule,
      badge: fs.length || '✓',
      rows: fs.map((f: any) => ({
        label: f.msg,
        sub: f.file ? `${f.file}:${f.line}` : '',
        nav: f.id ? ['node', f.id] : f.module ? ['mod', f.module] : undefined
      }))
    });
  }
  for (const r of recommendations(graph))
    groups.push({
      section: 'rec',
      sev: r.severity,
      title: r.title,
      badge: r.findings.length,
      why: r.rationale,
      rows: r.findings.map((f: any) => ({ label: f.label, sub: f.sub, nav: f.nav }))
    });
  const ports = portCandidates(graph, 15);
  groups.push({
    section: 'ports',
    sev: 'info',
    title: 'TS→Rust port candidates',
    badge: ports.length,
    why: 'score = compute ÷ coupling',
    rows: ports.map((p: any) => ({
      label: p.module,
      sub: `score ${p.score} · ${p.numericOps} numeric · ${p.loc} loc · coupling ${p.couplingToHigherLayers}`,
      nav: ['mod', p.fullModule]
    }))
  });
  const orph = orphans(graph);
  groups.push({
    section: 'orphans',
    sev: 'info',
    title: 'Dead-code candidates',
    badge: orph.length,
    rows: orph.map((n: any) => ({ label: n.short, sub: `${n.module} · ${n.file}:${n.line}`, nav: ['node', n.id] }))
  });

  let q = $state('');
  let copied = $state(false);

  const shown = $derived(
    groups
      .map((g) => ({
        ...g,
        rows: q ? g.rows.filter((r) => (r.label + ' ' + (r.sub ?? '')).toLowerCase().includes(q.toLowerCase())) : g.rows
      }))
      .filter((g) => !q || g.rows.length || g.title.toLowerCase().includes(q.toLowerCase()))
  );

  function navTo(nav?: ['node' | 'mod', string]) {
    if (!nav) return;
    selection.set(nav[0] === 'node' ? { type: 'node', id: nav[1] } : { type: 'module', module: nav[1] });
  }

  function copyAll() {
    const lines = [`Architecture insights — ${chk.errors} error(s), ${chk.warnings} warning(s)`];
    for (const [sec, label] of SECTIONS) {
      const gs = groups.filter((g) => g.section === sec);
      if (!gs.length) continue;
      lines.push('', `== ${label} ==`);
      for (const g of gs) {
        lines.push('', `[${g.badge}] ${g.title}`);
        if (g.why) lines.push(`  (${g.why})`);
        for (const r of g.rows) lines.push(`  - ${r.label}${r.sub ? `  (${r.sub})` : ''}`);
      }
    }
    navigator.clipboard.writeText(lines.join('\n')).then(
      () => {
        copied = true;
        setTimeout(() => (copied = false), 1500);
      },
      () => {}
    );
  }
</script>

<div class="dh">
  <button class="copy" onclick={copyAll}>{copied ? '✓ copied' : '⧉ copy'}</button>
  <div class="kind">insights</div>
  <h2>Architecture insights <span class="badge">{chk.errors}✗ {chk.warnings}!</span></h2>
</div>
<div class="body">
  <input class="search" placeholder="filter insights…" bind:value={q} />
  {#each SECTIONS as [sec, label]}
    {@const gs = shown.filter((g) => g.section === sec)}
    {#if gs.some((g) => g.rows.length || !q)}
      <div class="sec-h">{label}</div>
      {#each gs as g}
        {#if g.rows.length || !q}
          <div class="group" data-sev={g.sev}>
            <div class="rule"><span class="tag {g.sev}">{g.badge}</span>{g.title}</div>
            {#if g.why}<div class="why">{g.why}</div>{/if}
            {#each g.rows.slice(0, 40) as r}
              <button class="frow" onclick={() => navTo(r.nav)}>
                {r.label}{#if r.sub}<span class="meta">{r.sub}</span>{/if}
              </button>
            {/each}
            {#if g.rows.length > 40}<div class="meta more">… +{g.rows.length - 40} more</div>{/if}
          </div>
        {/if}
      {/each}
    {/if}
  {/each}
</div>

<style>
  .dh {
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    position: relative;
  }
  .copy {
    position: absolute;
    top: 11px;
    right: 12px;
    font-size: 10px;
    padding: 2px 6px;
  }
  .kind {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--accent);
  }
  .dh h2 {
    margin: 4px 0 0;
    font-size: 14px;
  }
  .badge {
    color: var(--fg-dim);
    font-size: 12px;
  }
  .body {
    padding: 10px 14px;
  }
  .search {
    width: 100%;
    margin-bottom: 10px;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    color: var(--fg);
    border-radius: 4px;
    padding: 5px 8px;
    font: inherit;
  }
  .sec-h {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--fg-dim);
    margin: 12px 0 6px;
  }
  .group {
    margin-bottom: 8px;
  }
  .rule {
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 2px;
  }
  .tag {
    min-width: 18px;
    text-align: center;
    border-radius: 3px;
    padding: 0 4px;
    font-size: 11px;
    background: var(--bg-elev);
  }
  .tag.error {
    color: #ff6b6b;
  }
  .tag.warn {
    color: var(--accent);
  }
  .why {
    font-size: 11px;
    color: var(--fg-dim);
    margin: 0 0 4px 24px;
  }
  .frow {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: 0;
    border-left: 2px solid var(--border);
    color: var(--fg);
    padding: 2px 0 2px 8px;
    margin-left: 8px;
    font: inherit;
    cursor: pointer;
  }
  .frow:hover {
    border-left-color: var(--accent2);
    color: var(--accent2);
  }
  .meta {
    display: block;
    font-size: 10px;
    color: var(--fg-dim);
  }
  .more {
    margin-left: 16px;
  }
</style>
