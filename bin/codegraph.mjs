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
  default:
    console.error('commands: onboard <path> | list | extract [name] | check <name> | diff <name>');
    process.exit(cmd ? 1 : 0);
}
