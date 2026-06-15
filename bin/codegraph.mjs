#!/usr/bin/env node
// @ts-check
/**
 * codegraph CLI — onboard projects and run the extractor/checker against any of
 * them. Each project is identified by name and an absolute path to a directory
 * that contains a `codegraph.config.json`.
 *
 *   codegraph onboard <path>     register a project (reads its config for the name)
 *   codegraph list               show registered projects
 *   codegraph extract [name]     (re)build the graph for one project, or all
 *   codegraph check   <name>     run architecture checks
 *   codegraph diff    <name>     diff against the saved snapshot (--save to snapshot)
 *
 * Graphs are written to data/<name>.json (consumed by the SvelteKit viewer).
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/lib/core/config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const DATA = path.join(REPO, 'data');
const REGISTRY = path.join(REPO, 'projects.json');

const readRegistry = () =>
  fs.existsSync(REGISTRY) ? JSON.parse(fs.readFileSync(REGISTRY, 'utf8')) : { projects: [] };
const writeRegistry = (r) => fs.writeFileSync(REGISTRY, JSON.stringify(r, null, 2) + '\n');
const resolveProject = (reg, name) => reg.projects.find((p) => p.name === name);

async function runExtract(project) {
  const projectDir = path.resolve(REPO, project.path);
  const cfg = loadConfig(projectDir);
  process.env.CG_PROJECT = projectDir;
  process.env.CG_OUT = path.join(DATA, `${cfg.name}.json`);
  // extract.mjs runs on import; cache-bust so repeated calls re-run in one process.
  await import('../src/lib/core/extract.mjs?ts=' + Date.now());
}

const [cmd, arg] = process.argv.slice(2);
const reg = readRegistry();

switch (cmd) {
  case 'onboard': {
    if (!arg) throw new Error('usage: codegraph onboard <path-to-project>');
    const abs = path.resolve(arg);
    const cfg = loadConfig(abs); // throws if no codegraph.config.json
    const existing = resolveProject(reg, cfg.name);
    if (existing) existing.path = abs;
    else reg.projects.push({ name: cfg.name, path: abs });
    writeRegistry(reg);
    console.error(`Onboarded ${cfg.name} -> ${abs}`);
    break;
  }
  case 'list':
    for (const p of reg.projects) console.error(`${p.name}\t${p.path}`);
    if (!reg.projects.length) console.error('(no projects onboarded — run: codegraph onboard <path>)');
    break;
  case 'extract': {
    const targets = arg ? [resolveProject(reg, arg)].filter(Boolean) : reg.projects;
    if (!targets.length) throw new Error(arg ? `unknown project: ${arg}` : 'no projects onboarded');
    fs.mkdirSync(DATA, { recursive: true });
    for (const p of targets) await runExtract(p);
    break;
  }
  case 'check': {
    const p = arg ? resolveProject(reg, arg) : reg.projects[0];
    if (!p) throw new Error(arg ? `unknown project: ${arg}` : 'no projects onboarded');
    fs.mkdirSync(DATA, { recursive: true });
    await runExtract(p);
    const cfg = loadConfig(path.resolve(REPO, p.path));
    const graph = JSON.parse(fs.readFileSync(path.join(DATA, `${cfg.name}.json`), 'utf8'));
    const { runChecks } = await import('../src/lib/core/analysis.mjs');
    const res = runChecks(graph);
    for (const rule of res.rules) {
      const hits = res.findings.filter((f) => f.rule === rule);
      const mark = hits.some((f) => f.level === 'error') ? '✗' : hits.length ? '!' : '✓';
      console.error(`\n${mark} ${rule}${hits.length ? ` (${hits.length})` : ''}`);
      for (const f of hits) console.error(`    ${f.msg}${f.file ? `  [${f.file}:${f.line}]` : ''}`);
    }
    console.error(`\n${res.errors} error(s), ${res.warnings} warning(s)`);
    if (res.errors || (process.argv.includes('--strict') && res.warnings)) process.exit(1);
    break;
  }
  case 'watch': {
    const p = arg ? resolveProject(reg, arg) : reg.projects[0];
    if (!p) throw new Error(arg ? `unknown project: ${arg}` : 'no projects onboarded');
    fs.mkdirSync(DATA, { recursive: true });
    const cfg = loadConfig(path.resolve(REPO, p.path));
    await runExtract(p);
    console.error(`[codegraph] watching ${cfg.svelteRootAbs} — re-extracts on .ts/.svelte change`);
    let timer = null;
    fs.watch(cfg.svelteRootAbs, { recursive: true }, (_ev, file) => {
      if (!file || !/\.(ts|svelte)$/.test(file) || /\.test\.ts$/.test(file)) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        runExtract(p)
          .then(() => console.error(`[codegraph] re-extracted (${new Date().toLocaleTimeString()})`))
          .catch((e) => console.error('[codegraph] extract failed:', e.message));
      }, 400);
    });
    await new Promise(() => {}); // keep alive
    break;
  }
  case 'diff':
  case 'snapshot': {
    const save = cmd === 'snapshot' || process.argv.includes('--save');
    const named = arg && arg !== '--save' ? arg : null;
    const p = named ? resolveProject(reg, named) : reg.projects[0];
    if (!p) throw new Error(named ? `unknown project: ${named}` : 'no projects onboarded');
    fs.mkdirSync(DATA, { recursive: true });
    await runExtract(p);
    const cfg = loadConfig(path.resolve(REPO, p.path));
    const curPath = path.join(DATA, `${cfg.name}.json`);
    const snapPath = path.join(DATA, `${cfg.name}.snapshot.json`);
    if (save) {
      fs.copyFileSync(curPath, snapPath);
      console.error(`✓ saved baseline → data/${cfg.name}.snapshot.json`);
      break;
    }
    if (!fs.existsSync(snapPath)) {
      console.error(`No snapshot for ${cfg.name}. Create one first:  codegraph snapshot ${cfg.name}`);
      process.exit(2);
    }
    const { diffGraphs } = await import('../src/lib/core/diff.mjs');
    diffGraphs(JSON.parse(fs.readFileSync(snapPath, 'utf8')), JSON.parse(fs.readFileSync(curPath, 'utf8')), `${cfg.name}.snapshot`);
    break;
  }
  default:
    console.error('commands: onboard <path> | list | extract [name] | watch [name] | check <name> | diff <name>');
    process.exit(cmd ? 1 : 0);
}
