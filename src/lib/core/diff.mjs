// @ts-check
/**
 * Graph snapshot + diff — track how the architecture changes over time.
 * Pure: `diffGraphs(base, cur, baseLabel)` prints new/removed modules, size
 * changes, new/removed cross-module deps, and new god-modules. Wired into the
 * CLI as `codegraph diff [name]` / `codegraph diff [name] --save`.
 */
const C = { red: '\x1b[31m', grn: '\x1b[32m', yel: '\x1b[33m', dim: '\x1b[2m', bold: '\x1b[1m', off: '\x1b[0m' };

export function diffGraphs(base, cur, baseLabel = 'snapshot') {
  const god = cur.config?.godFunctions ?? 40;
  const prefix = cur.config?.namespacePrefix ?? null;
  const short = (m) => (prefix && m.startsWith(prefix + '/') ? m.slice(prefix.length + 1) : m);

  const modMap = (g) => new Map(g.moduleNodes.map((m) => [m.module, m]));
  const bMods = modMap(base), cMods = modMap(cur);
  const modDeps = (g) => new Set(g.moduleEdges.map((e) => `${e.from} → ${e.to}`));
  const bDeps = modDeps(base), cDeps = modDeps(cur);

  const line = (sym, color, txt) => console.log(`    ${color}${sym}${C.off} ${txt}`);
  const section = (title) => console.log(`\n  ${C.bold}${title}${C.off}`);
  let changes = 0;

  console.log(`\n${C.bold}Graph diff${C.off}  ${C.dim}baseline ${baseLabel} (${base.generatedAt?.slice(0, 16) || '?'}) → current (${cur.generatedAt?.slice(0, 16) || '?'})${C.off}`);

  const d = (a, b) => (b - a >= 0 ? `+${b - a}` : `${b - a}`);
  section('Totals');
  console.log(`    functions ${base.stats.functions} → ${cur.stats.functions} (${d(base.stats.functions, cur.stats.functions)})   ` +
    `edges ${base.stats.edges} → ${cur.stats.edges} (${d(base.stats.edges, cur.stats.edges)})   ` +
    `modules ${base.stats.modules} → ${cur.stats.modules} (${d(base.stats.modules, cur.stats.modules)})`);

  const added = [...cMods.keys()].filter((m) => !bMods.has(m));
  const removed = [...bMods.keys()].filter((m) => !cMods.has(m));
  if (added.length || removed.length) {
    section('Modules');
    added.forEach((m) => { line('+', C.grn, `${short(m)} ${C.dim}(${cMods.get(m).fns} fns)${C.off}`); changes++; });
    removed.forEach((m) => { line('-', C.red, `${short(m)} ${C.dim}(was ${bMods.get(m).fns} fns)${C.off}`); changes++; });
  }

  const grew = [];
  for (const [m, cm] of cMods) {
    const bm = bMods.get(m);
    if (bm && bm.fns !== cm.fns) grew.push({ m, from: bm.fns, to: cm.fns });
  }
  grew.sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from));
  if (grew.length) {
    section('Module size changes');
    for (const g of grew) {
      const up = g.to > g.from;
      const crossedGod = g.to > god && g.from <= god;
      line(up ? '▲' : '▼', up ? C.yel : C.grn,
        `${short(g.m)} ${g.from} → ${g.to} fns${crossedGod ? `  ${C.red}⚠ now a god-module (>${god})${C.off}` : ''}`);
      changes++;
    }
  }

  const newDeps = [...cDeps].filter((x) => !bDeps.has(x));
  const goneDeps = [...bDeps].filter((x) => !cDeps.has(x));
  if (newDeps.length || goneDeps.length) {
    section('Module dependencies');
    newDeps.slice(0, 30).forEach((x) => { line('+', C.yel, short(x.split(' → ')[0]) + ' → ' + short(x.split(' → ')[1])); changes++; });
    goneDeps.slice(0, 30).forEach((x) => { line('-', C.grn, short(x.split(' → ')[0]) + ' → ' + short(x.split(' → ')[1])); changes++; });
    if (newDeps.length > 30 || goneDeps.length > 30) console.log(`    ${C.dim}… (${newDeps.length} new, ${goneDeps.length} removed)${C.off}`);
  }

  if (!changes) console.log(`\n  ${C.grn}No structural changes.${C.off}`);
  console.log('');
  return changes;
}
