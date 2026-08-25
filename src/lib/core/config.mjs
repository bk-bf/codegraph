// @ts-check
/**
 * Project-config loader. An onboarded project ships a `codegraph.config.json`
 * at its root — pure JSON, no code execution (so analysing a project can never
 * run that project's code). Everything the extractor and analyser need to stop
 * being Fantasia4x-specific is declared here.
 *
 * Schema (all paths are relative to the project root):
 *   name         string   display name
 *   tsconfig     string   tsconfig to drive module resolution        ("tsconfig.json")
 *   srcDir       string   only .ts under here are graph sources       ("src/lib")
 *   svelteRoot   string   directory scanned for .svelte components     ("src")
 *   rustCrates   string[] crate dirs (each with a src/) to parse       ([])
 *   adrsDoc      string?  markdown file listing "ADR-NN: title" lines  (null)
 *   descriptions string?  curated descriptions json                    (null)
 *   godFunctions number   module size warning threshold                (40)
 *   paths        Record<string,string[]>  extra tsconfig `paths` aliases, merged
 *                over the ones the tsconfig resolves to. Needed when a project's
 *                tsconfig `extends` a generated file that is not checked in
 *                (SvelteKit's .svelte-kit/tsconfig.json holds `$lib`): without it
 *                every aliased import resolves to nothing and the graph silently
 *                loses those edges.                                    ({})
 *   group        { namespacePrefix?: string }  group-derivation rule
 *   layers       Record<string,number>  layer rank per group (higher depends on lower; -1 exempt)
 *   adrRules     AdrRule[]  declarative architecture rules (see analysis.mjs)
 */
import fs from 'node:fs';
import path from 'node:path';

const DEFAULTS = {
  name: 'project',
  tsconfig: 'tsconfig.json',
  srcDir: 'src/lib',
  svelteRoot: 'src',
  rustCrates: [],
  adrsDoc: null,
  descriptions: null,
  godFunctions: 40,
  paths: {},
  group: {},
  layers: {},
  adrRules: []
};

const norm = (p) => p.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');

/** Load + normalise a project's codegraph.config.json. Throws if missing. */
export function loadConfig(projectDir) {
  const root = path.resolve(projectDir);
  const cfgPath = path.join(root, 'codegraph.config.json');
  if (!fs.existsSync(cfgPath)) {
    throw new Error(`No codegraph.config.json found in ${root} — onboard the project first.`);
  }
  const cfg = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(cfgPath, 'utf8')), root };

  cfg.tsconfigPath = path.join(root, cfg.tsconfig);
  cfg.srcDirAbs = path.join(root, cfg.srcDir);
  cfg.svelteRootAbs = path.join(root, cfg.svelteRoot);
  cfg.adrsDocPath = cfg.adrsDoc ? path.join(root, cfg.adrsDoc) : null;
  cfg.descriptionsPath = cfg.descriptions ? path.join(root, cfg.descriptions) : null;
  // Path token used to decide if a file is a graph source, e.g. "/src/lib/".
  cfg.srcToken = `/${norm(cfg.srcDir)}/`;

  // `paths` values are project-relative; TypeScript resolves them against baseUrl.
  cfg.pathsBaseUrl = root;

  // group-of: first module segment, unless a namespacePrefix is set, in which
  // case `<prefix>/<x>/...` groups as `<x>` (e.g. game/services/Foo -> services).
  const pref = cfg.group && cfg.group.namespacePrefix;
  cfg.groupOf = (m) => {
    const a = String(m).split('/');
    return pref && a[0] === pref ? (a[1] ?? a[0]) : a[0];
  };
  return cfg;
}
