// Staleness detection and the rebuild lock, against a throwaway workspace: a real git
// checkout, a real projects.json, and a stub extractor that records which project it was
// asked to rebuild. Both are things the viewer gets wrong silently when they break — it
// serves an old graph, or it never rebuilds the project you asked for.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, utimesSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type Freshness = typeof import('../src/lib/server/freshness');

const BUILT_AT = new Date(Date.now() - 60_000); // the graph was built a minute ago
const OLD = new Date(Date.now() - 120_000); // sources last touched before that
let ws: string;
let cwd: string;
let F: Freshness;

const git = (args: string[], cwd: string) =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' }).trim();

/** Write the stored graph for a project, stamped with a commit and a build time. */
function writeGraph(name: string, commit: string, extra: Record<string, unknown> = {}) {
  writeFileSync(
    join(ws, 'data', `${name}.json`),
    JSON.stringify({
      generatedAt: BUILT_AT.toISOString(),
      commit,
      dirty: false,
      nodes: [],
      edges: [],
      moduleNodes: [],
      moduleEdges: [],
      files: [{ file: 'src/lib/a.ts' }, { file: 'src/App.svelte' }],
      ...extra
    })
  );
}

function touch(rel: string, when: Date) {
  utimesSync(join(ws, 'proj', rel), when, when);
}

beforeAll(async () => {
  cwd = process.cwd();
  ws = mkdtempSync(join(tmpdir(), 'cg-fresh-'));
  mkdirSync(join(ws, 'data'));
  mkdirSync(join(ws, 'bin'));
  mkdirSync(join(ws, 'proj/src/lib'), { recursive: true });
  mkdirSync(join(ws, 'proj2'));

  // A stub extractor: the lock is what is under test, not the extraction.
  writeFileSync(
    join(ws, 'bin/codegraph.mjs'),
    `import fs from 'node:fs';\n` +
      `const project = process.argv[3];\n` +
      `setTimeout(() => { fs.appendFileSync('runs.log', project + '\\n'); process.exit(0); }, 150);\n`
  );

  writeFileSync(join(ws, 'proj/src/lib/a.ts'), 'export const a = 1;\n');
  writeFileSync(join(ws, 'proj/src/App.svelte'), '<p>hi</p>\n');
  writeFileSync(join(ws, 'proj/README.md'), '# fixture\n');
  git(['init', '-q', '-b', 'main'], join(ws, 'proj'));
  git(['add', '-A'], join(ws, 'proj'));
  git(['commit', '-qm', 'first'], join(ws, 'proj'));

  writeFileSync(
    join(ws, 'projects.json'),
    JSON.stringify({
      projects: [
        { name: 'p', path: './proj', kind: 'code' },
        { name: 'q', path: './proj', kind: 'code' },
        { name: 'fs', path: './proj2', kind: 'filesystem' }
      ]
    })
  );
  writeGraph('fs', 'irrelevant');
  writeGraph('q', git(['rev-parse', 'HEAD'], join(ws, 'proj')));

  // data.ts resolves its data directory at import time, so the chdir has to come first.
  process.chdir(ws);
  F = await import('../src/lib/server/freshness');
});

afterAll(() => {
  process.chdir(cwd);
  rmSync(ws, { recursive: true, force: true });
});

beforeEach(() => {
  // Back to: graph built a minute ago, sources older than that, tree clean.
  git(['checkout', '--', '.'], join(ws, 'proj'));
  for (const f of ['src/lib/a.ts', 'src/App.svelte', 'README.md']) touch(f, OLD);
  writeGraph('p', git(['rev-parse', 'HEAD'], join(ws, 'proj')));
});

describe('isStale', () => {
  it('is false when the graph names the commit the checkout is on', () => {
    expect(F.isStale('p')).toBe(false);
  });

  it('is true when the checkout has moved on', () => {
    writeGraph('p', '0'.repeat(40));
    expect(F.isStale('p')).toBe(true);
  });

  it('is true for an uncommitted edit to a file the graph covers', () => {
    writeFileSync(join(ws, 'proj/src/lib/a.ts'), 'export const a = 2;\n');
    touch('src/lib/a.ts', new Date());
    expect(F.isStale('p')).toBe(true);
  });

  it('is false for an uncommitted edit the graph does not cover', () => {
    writeFileSync(join(ws, 'proj/README.md'), '# edited\n');
    touch('README.md', new Date());
    expect(F.isStale('p')).toBe(false);
  });

  it('is true for a new source file the graph has never seen', () => {
    writeFileSync(join(ws, 'proj/src/lib/b.ts'), 'export const b = 1;\n');
    try {
      expect(F.isStale('p')).toBe(true);
    } finally {
      rmSync(join(ws, 'proj/src/lib/b.ts'));
    }
  });

  it('is true for a covered file that has been deleted', () => {
    rmSync(join(ws, 'proj/src/lib/a.ts'));
    expect(F.isStale('p')).toBe(true);
  });

  it('is true when the graph was built over edits that are gone again', () => {
    writeGraph('p', git(['rev-parse', 'HEAD'], join(ws, 'proj')), { dirty: true });
    expect(F.isStale('p')).toBe(true); // clean tree + a graph built dirty = stale
  });

  it('is false for a project with no graph, no stamp, or no checkout', () => {
    expect(F.isStale('fs')).toBe(false);
    expect(F.isStale('nope')).toBe(false);
  });
});

describe('the rebuild lock', () => {
  const runs = () =>
    existsSync(join(ws, 'runs.log'))
      ? readFileSync(join(ws, 'runs.log'), 'utf8').split('\n').filter(Boolean)
      : [];

  it('runs one extraction per project, not one process-wide', async () => {
    rmSync(join(ws, 'runs.log'), { force: true });
    const a1 = F.runExtract('p');
    const a2 = F.runExtract('p');
    const b = F.runExtract('q');
    expect(a2).toBe(a1); // same project -> the same run
    expect(b).not.toBe(a1); // different project -> its own run
    expect(F.rebuilding('p')).toBe(true);
    expect(F.rebuilding('q')).toBe(true);

    expect(await Promise.all([a1, a2, b])).toEqual([true, true, true]);
    expect(runs().sort()).toEqual(['p', 'q']);
    expect(F.rebuilding()).toBe(false);
  });

  it('releases the lock so a later rebuild of the same project still runs', async () => {
    rmSync(join(ws, 'runs.log'), { force: true });
    expect(await F.runExtract('p')).toBe(true);
    expect(await F.runExtract('p')).toBe(true);
    expect(runs()).toEqual(['p', 'p']);
  });
});
