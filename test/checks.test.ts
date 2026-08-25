// The architecture contract — the thing this tool does that a dependency visualizer does
// not. A check that stops firing is indistinguishable from a codebase that stopped
// violating it, so each rule is run against a project built to violate it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { cpSync, mkdtempSync, writeFileSync, readFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runChecks } from '../src/lib/core/analysis.mjs';
import { FIXTURE, extractProject } from './helpers';
import type { RawGraph } from '../src/lib/graph/types';

let dir: string;
let clean: RawGraph;
let violating: RawGraph;
const rulesHit = (g: RawGraph) => new Set(runChecks(g).findings.map((f: any) => f.rule));
const msgs = (g: RawGraph, rule: string) =>
  runChecks(g).findings.filter((f: any) => f.rule === rule).map((f: any) => f.msg);

beforeAll(() => {
  clean = extractProject(FIXTURE).graph;

  dir = mkdtempSync(join(tmpdir(), 'cg-checks-'));
  const proj = join(dir, 'tsproj');
  cpSync(FIXTURE, proj, { recursive: true });

  // core (layer 0) reaching up into services (layer 2), and back again — a layer
  // violation and a module cycle in the same pair.
  appendFileSync(
    join(proj, 'src/lib/core/util.ts'),
    `\nimport { pingBack } from '$lib/services/loop';\n` +
      `export function ping(): number {\n  return pingBack();\n}\n` +
      `\nfunction deadLocal(): number {\n  return 1;\n}\n`
  );
  writeFileSync(
    join(proj, 'src/lib/services/loop.ts'),
    `import { clamp } from '$lib/core/util';\n\nexport function pingBack(): number {\n  return clamp(9, 1, 3);\n}\n`
  );

  // An ADR the config declares but the code breaks, plus one the doc mentions and the
  // config never onboards.
  const cfg = JSON.parse(readFileSync(join(proj, 'codegraph.config.json'), 'utf8'));
  cfg.adrsDoc = 'DECISIONS.md';
  cfg.adrRules = [
    {
      adr: 'ADR-001',
      type: 'restricted-callee',
      callee: 'clamp',
      allowFrom: ['Greeter.greet'],
      severity: 'error',
      msg: 'clamp is fenced behind Greeter'
    }
  ];
  writeFileSync(join(proj, 'codegraph.config.json'), JSON.stringify(cfg, null, 2));
  writeFileSync(join(proj, 'DECISIONS.md'), '## ADR-001: fence clamp\n\n## ADR-002: never onboarded\n');

  violating = extractProject(proj).graph;
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('a project that follows its own rules', () => {
  it('reports no findings', () => {
    const res = runChecks(clean);
    expect(res.findings).toEqual([]);
    expect(res.errors).toBe(0);
  });
});

describe('a project that breaks them', () => {
  it('names the module that depends on a higher layer', () => {
    expect(msgs(violating, 'layers').join(' ')).toMatch(/core\/util \(core\) depends on higher layer services\/loop/);
  });

  it('reports the module cycle as an error', () => {
    const res = runChecks(violating);
    expect(rulesHit(violating).has('cycle')).toBe(true);
    expect(res.errors).toBeGreaterThan(0);
    expect(msgs(violating, 'cycle').join(' ')).toMatch(/core\/util|services\/loop/);
  });

  it('flags a private function nothing calls', () => {
    expect(msgs(violating, 'orphan').join(' ')).toMatch(/deadLocal/);
  });

  it('enforces a declarative ADR rule from the config', () => {
    expect(msgs(violating, 'ADR-001').join(' ')).toMatch(/services\/loop::pingBack calls clamp/);
    // The one caller the rule allows is not reported.
    expect(msgs(violating, 'ADR-001').join(' ')).not.toMatch(/Greeter\.greet calls clamp/);
  });

  it('flags an ADR the decisions doc declares but the config never onboards', () => {
    expect(msgs(violating, 'adr-coverage').join(' ')).toMatch(/ADR-002/);
  });
});
