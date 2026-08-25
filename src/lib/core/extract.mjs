// @ts-check
/**
 * Codebase call-graph extractor.
 *
 * Walks every non-test TypeScript source file under src/lib using the
 * TypeScript compiler API, registers each function / method / arrow-function
 * as a graph node, and resolves call expressions through the type checker to
 * build accurate caller -> callee edges.
 *
 * Output: tools/codegraph/graph.json  (consumed by build-html.mjs)
 *
 * Run with:  node tools/codegraph/extract.mjs
 */
import ts from 'typescript';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extractRust } from './rust.mjs';
import { loadConfig } from './config.mjs';

// Project to analyse: CG_PROJECT (set by the CLI), else the current directory.
const CFG = loadConfig(process.env.CG_PROJECT || process.cwd());
const ROOT = CFG.root;

// ---------------------------------------------------------------------------
// Svelte support: each .svelte component gets a virtual TypeScript twin holding
// just its <script> contents (line positions preserved) so the compiler can
// resolve the calls it makes into stores/services. The twin's path is the real
// .svelte path + this suffix; we map it back when labelling nodes.
// ---------------------------------------------------------------------------
const SV_SUFFIX = '.cg.ts';
/** @type {Map<string,string>} virtual twin path -> TS content */
const svelteVirtual = new Map();
const realPath = (f) => (f.endsWith(SV_SUFFIX) ? f.slice(0, -SV_SUFFIX.length) : f);

/** Keep only <script> contents; blank the rest but preserve newlines (so line numbers map back to the .svelte). */
function svelteToVirtualTs(src) {
  const arr = new Array(src.length);
  for (let i = 0; i < src.length; i++) arr[i] = src[i] === '\n' ? '\n' : ' ';
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(src))) {
    const openEnd = m.index + m[0].indexOf('>') + 1;
    for (let i = 0; i < m[1].length; i++) arr[openEnd + i] = src[openEnd + i];
  }
  return arr.join('');
}

function findSvelteFiles() {
  const root = CFG.svelteRootAbs;
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { recursive: true })
    .map((f) => path.join(root, String(f)))
    .filter((f) => f.endsWith('.svelte'));
}

/** Files we treat as graph sources (definitions + logic), excluding tests. */
function isSourceFile(fileName) {
  if (svelteVirtual.has(fileName)) return true; // virtual .svelte twin
  const f = fileName.replace(/\\/g, '/');
  if (!f.includes(CFG.srcToken)) return false;
  if (!f.endsWith('.ts')) return false;
  if (f.endsWith('.d.ts')) return false;
  if (f.endsWith('.test.ts')) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Build the TypeScript program from the project's tsconfig (so $lib aliases
// and module resolution behave exactly like the real build), plus the virtual
// Svelte twins served through a custom compiler host.
// ---------------------------------------------------------------------------
const configPath = CFG.tsconfigPath;
const parsed = ts.getParsedCommandLineOfConfigFile(
  configPath,
  {},
  {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      console.error(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    }
  }
);
if (!parsed) {
  console.error('Could not parse tsconfig.json');
  process.exit(1);
}

for (const sv of findSvelteFiles()) {
  try {
    svelteVirtual.set(sv + SV_SUFFIX, svelteToVirtualTs(fs.readFileSync(sv, 'utf8')));
  } catch {
    /* unreadable component — skip */
  }
}

// A tsconfig that `extends` a GENERATED file (SvelteKit writes .svelte-kit/tsconfig.json,
// which is not checked in) silently loses that file's `paths`. Module resolution then fails
// for every aliased import — `$lib/...` here — and the extract still succeeds, just with the
// edges missing. Config-declared `paths` fill the gap; the warning names the case where they
// are needed and absent.
const extendsTarget = (() => {
  try {
    const raw = ts.readConfigFile(configPath, ts.sys.readFile).config;
    const ext = raw && raw.extends;
    if (!ext || typeof ext !== 'string' || !ext.startsWith('.')) return null;
    const abs = path.resolve(path.dirname(configPath), ext);
    return fs.existsSync(abs) || fs.existsSync(abs + '.json') ? null : ext;
  } catch {
    return null;
  }
})();
const cfgPaths = CFG.paths && Object.keys(CFG.paths).length ? CFG.paths : null;
if (extendsTarget && !cfgPaths) {
  console.error(
    `WARNING: ${CFG.tsconfig} extends "${extendsTarget}", which does not exist. Any path alias it\n` +
      `         declares will not resolve, and every import using one is dropped from the graph.\n` +
      `         Generate it, or declare the aliases under "paths" in codegraph.config.json.`
  );
}

const compilerOptions = {
  ...parsed.options,
  noEmit: true,
  ...(cfgPaths
    ? {
        baseUrl: parsed.options.baseUrl || CFG.pathsBaseUrl,
        paths: { ...(parsed.options.paths || {}), ...cfgPaths }
      }
    : {})
};
const host = ts.createCompilerHost(compilerOptions);
const _getSourceFile = host.getSourceFile.bind(host);
host.getSourceFile = (fn, langVer, onErr, shouldCreate) => {
  if (svelteVirtual.has(fn)) return ts.createSourceFile(fn, svelteVirtual.get(fn), langVer, true);
  return _getSourceFile(fn, langVer, onErr, shouldCreate);
};
const _readFile = host.readFile.bind(host);
host.readFile = (fn) => (svelteVirtual.has(fn) ? svelteVirtual.get(fn) : _readFile(fn));
const _fileExists = host.fileExists.bind(host);
host.fileExists = (fn) => svelteVirtual.has(fn) || _fileExists(fn);

const program = ts.createProgram({
  rootNames: [...parsed.fileNames, ...svelteVirtual.keys()],
  options: compilerOptions,
  host
});
const checker = program.getTypeChecker();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const rel = (f) => path.relative(ROOT, realPath(f)).replace(/\\/g, '/');

/** Module label e.g. "game/services/JobService" or "components/screens/WorkScreen". */
function moduleOf(fileName) {
  return rel(fileName)
    .replace(/^src\/lib\//, '')
    .replace(/^src\//, '') // routes/* live outside src/lib
    .replace(/\.(ts|svelte)$/, '');
}

/** Top-level group used for colour / clustering (services, systems, core...). */
function groupOf(fileName) {
  return CFG.groupOf(moduleOf(fileName)); // e.g. game/services/JobService -> services
}

/** Turn camelCase / PascalCase identifiers into a readable phrase. */
function humanize(name) {
  const base = name.replace(/Impl$/, '').replace(/Service$/, '');
  const words = base
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_\-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Common abbreviations expanded for readable auto-descriptions.
// Null-prototype so a word like "constructor" can't hit Object.prototype.
const ABBR = Object.assign(Object.create(null), {
  calc: 'calculate', gen: 'generate', init: 'initialize', cfg: 'configure',
  config: 'configuration', ctx: 'context', pos: 'position', dir: 'direction',
  coord: 'coordinate', coords: 'coordinates', prev: 'previous', src: 'source',
  dest: 'destination', msg: 'message', evt: 'event', def: 'definition',
  desc: 'description', util: 'utility', dist: 'distance', req: 'request',
  env: 'environment', sim: 'simulation', stat: 'stat', stats: 'stats',
  num: 'number', avg: 'average', idx: 'index', refuel: 'refuel',
});
function nameWords(name) {
  return name
    .replace(/^_+/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_\-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => ABBR[w.toLowerCase()] || w);
}

// Leading-verb → sentence templates for inferring what a function does.
const VERB = Object.assign(Object.create(null), {
  get: 'Return', return: 'Return', find: 'Find', fetch: 'Fetch', lookup: 'Look up',
  read: 'Read', list: 'List', collect: 'Collect', gather: 'Gather', resolve: 'Resolve',
  calculate: 'Compute', compute: 'Compute', derive: 'Derive', evaluate: 'Evaluate',
  estimate: 'Estimate', measure: 'Measure', score: 'Score', roll: 'Roll',
  update: 'Update', set: 'Set', apply: 'Apply', assign: 'Assign', adjust: 'Adjust',
  modify: 'Modify', change: 'Change', tweak: 'Adjust', recalc: 'Recompute',
  create: 'Create', generate: 'Generate', make: 'Create', build: 'Build', spawn: 'Spawn',
  initialize: 'Initialize', construct: 'Construct', produce: 'Produce',
  add: 'Add', insert: 'Insert', register: 'Register', append: 'Append', attach: 'Attach',
  remove: 'Remove', delete: 'Delete', clear: 'Clear', destroy: 'Destroy', drop: 'Drop',
  release: 'Release', detach: 'Detach', discard: 'Discard',
  consume: 'Consume', spend: 'Spend', pay: 'Pay', deduct: 'Deduct', drain: 'Drain',
  handle: 'Handle', process: 'Process', dispatch: 'Dispatch', route: 'Route',
  render: 'Render', draw: 'Draw', paint: 'Paint', display: 'Display', show: 'Show',
  tick: 'Advance', step: 'Advance', advance: 'Advance', run: 'Run', execute: 'Execute',
  simulate: 'Simulate', progress: 'Progress',
  save: 'Save', write: 'Write', persist: 'Persist', store: 'Store', flush: 'Flush',
  sync: 'Synchronize', ensure: 'Ensure', validate: 'Validate', check: 'Check',
  verify: 'Verify', assert: 'Assert',
  toggle: 'Toggle', reset: 'Reset', refresh: 'Refresh', rebuild: 'Rebuild',
  recompute: 'Recompute', reload: 'Reload', restore: 'Restore',
  move: 'Move', place: 'Place', equip: 'Equip', unequip: 'Unequip', wield: 'Wield',
  start: 'Start', stop: 'Stop', begin: 'Begin', end: 'End', open: 'Open', close: 'Close',
  cancel: 'Cancel', pause: 'Pause', resume: 'Resume', complete: 'Complete', finish: 'Finish',
  select: 'Select', pick: 'Pick', choose: 'Choose', filter: 'Filter', sort: 'Sort',
  group: 'Group', merge: 'Merge', combine: 'Combine', split: 'Split',
  parse: 'Parse', format: 'Format', serialize: 'Serialize', deserialize: 'Deserialize',
  encode: 'Encode', decode: 'Decode', convert: 'Convert', normalize: 'Normalize',
  emit: 'Emit', notify: 'Notify', log: 'Log', report: 'Report', count: 'Count',
  sum: 'Sum', total: 'Total', mark: 'Mark', flag: 'Flag', queue: 'Queue',
  load: 'Load', grant: 'Grant', award: 'Award', gain: 'Gain', lose: 'Lose',
  damage: 'Apply damage from', heal: 'Heal', hit: 'Resolve a hit on', attack: 'Resolve an attack by',
});
const PREDICATE = new Set(['is', 'has', 'can', 'should', 'are', 'was', 'will', 'does', 'did', 'must', 'needs', 'wants']);

/** Infer a readable sentence for a function from its name when it has no JSDoc. */
function autoDescribe(baseName) {
  const ws = nameWords(baseName);
  if (!ws.length) return 'Unnamed function.';
  const lc = ws.map((w) => w.toLowerCase());
  const verb = lc[0];
  const restWs = ws.slice(1);
  const rest = restWs.join(' ').toLowerCase();
  const full = lc.join(' ');
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // getXById / findXById → "Look up the X with the given id."
  if (['get', 'find', 'fetch', 'lookup', 'load'].includes(verb) && lc.includes('by') && lc[lc.length - 1] === 'id') {
    const x = lc.slice(1, lc.indexOf('by')).join(' ') || 'record';
    return `Look up the ${x} with the given id.`;
  }
  // predicates → "Report whether …"
  if (PREDICATE.has(verb)) {
    const tail = restWs.length ? rest : full;
    return `Report whether ${tail}.`;
  }
  if (verb === 'to' && restWs.length) return `Convert to ${rest}.`;
  if (verb === 'from' && restWs.length) return `Build from ${rest}.`;
  if (verb === 'on' && restWs.length) return `Handle the ${rest} event.`;
  if (VERB[verb]) return restWs.length ? `${VERB[verb]} ${rest}.` : `${VERB[verb]}.`;
  return cap(full) + '.';
}

/** A comment line that's just a divider/separator (---- / ==== / //// / ****). */
const isDivider = (l) => /^[\s\-=*_/#~.]+$/.test(l);
/** An ALL-CAPS section banner like "PUBLIC API" or "PRIVATE — JOB GENERATION". */
const isBanner = (l) => l.length <= 48 && /^[A-Z0-9 _\-—&/().]+$/.test(l) && /[A-Z]/.test(l);

/**
 * Extract a clean description from a declaration's leading comment.
 * Prefers the JSDoc block nearest the declaration; falls back to trailing
 * `//` lines. Section banners and divider rules are stripped so they don't
 * leak into descriptions.
 */
function leadingDoc(node, sf) {
  const full = sf.getFullText();
  const ranges = ts.getLeadingCommentRanges(full, node.getFullStart()) || [];
  if (!ranges.length) return '';

  // Prefer the block comment (/* */ or /** */) closest to the declaration —
  // that's the real doc; the // banners above it are noise.
  const block = [...ranges].reverse().find((r) => r.kind === ts.SyntaxKind.MultiLineCommentTrivia);
  const chosen = block ? [block] : ranges.filter((r) => r.kind === ts.SyntaxKind.SingleLineCommentTrivia);

  const lines = chosen
    .map((r) => full.slice(r.pos, r.end))
    .join('\n')
    .replace(/^\s*\/\*\*?/, '')
    .replace(/\*\/\s*$/, '')
    .split('\n')
    .map((l) =>
      l
        .replace(/^\s*\*\s?/, '')
        .replace(/^\s*\/\/\s?/, '')
        // strip surrounding divider runs (=====, -----, ////, ****) that wrap banners
        .replace(/^[=\-*_/#~\s]+/, '')
        .replace(/[=\-*_/#~\s]+$/, '')
        .trim()
    )
    .filter((l) => l && !isDivider(l) && !isBanner(l) && !l.startsWith('@') && !l.startsWith('eslint'));

  let text = lines.join(' ').replace(/\s+/g, ' ').trim();
  if (text.length > 280) text = text.slice(0, 277).replace(/\s+\S*$/, '') + '…';
  return text;
}

/** First line of the declaration's source, trimmed, used as a signature hint. */
function signatureOf(node, sf) {
  let txt = node.getText(sf);
  const brace = txt.indexOf('{');
  const arrow = txt.indexOf('=>');
  let cut = txt.length;
  if (brace >= 0) cut = Math.min(cut, brace);
  if (arrow >= 0) cut = Math.min(cut, arrow + 2);
  txt = txt.slice(0, cut).replace(/\s+/g, ' ').trim();
  if (txt.length > 160) txt = txt.slice(0, 157) + '...';
  return txt;
}

// ---------------------------------------------------------------------------
// Pass 1 — register nodes
// ---------------------------------------------------------------------------
/** @type {Map<ts.Node, string>} declaration AST node -> node id */
const declToId = new Map();
/** @type {Map<string, any>} id -> node record */
const nodes = new Map();
/** list of { id, decl, body } to scan for calls in pass 2 */
const scanList = [];
/** list of { id, sf } Svelte components — every call in their script is an edge */
const componentScan = [];

let idCounter = 0;
function makeId(fileName, qualName, line) {
  return `${moduleOf(fileName)}::${qualName}@${line}#${idCounter++}`;
}

const ARITH = new Set([
  ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken, ts.SyntaxKind.AsteriskAsteriskToken,
]);
/** Lines-of-code span and a "numeric heaviness" score (arithmetic, indexing, loops). */
function bodyMetrics(decl, sf) {
  const start = sf.getLineAndCharacterOfPosition(decl.getStart(sf)).line;
  const end = sf.getLineAndCharacterOfPosition(decl.getEnd()).line;
  let numeric = 0;
  const visit = (n) => {
    if (ts.isBinaryExpression(n) && ARITH.has(n.operatorToken.kind)) numeric++;
    else if (ts.isElementAccessExpression(n)) numeric++; // arr[i]
    else if (ts.isForStatement(n) || ts.isForOfStatement(n) || ts.isWhileStatement(n)) numeric += 2;
    else if (ts.isPrefixUnaryExpression(n) && (n.operator === ts.SyntaxKind.MinusToken || n.operator === ts.SyntaxKind.PlusToken)) numeric++;
    ts.forEachChild(n, visit);
  };
  visit(decl);
  return { loc: Math.max(1, end - start + 1), chars: decl.getEnd() - decl.getStart(sf), numeric };
}

function register(decl, qualName, kind, className, sf) {
  const fileName = sf.fileName;
  const { line } = sf.getLineAndCharacterOfPosition(decl.getStart(sf));
  const id = makeId(fileName, qualName, line + 1);
  declToId.set(decl, id);
  const doc = leadingDoc(decl, sf);
  const met = bodyMetrics(decl, sf);
  nodes.set(id, {
    id,
    name: qualName,
    short: className ? `${className}.${qualName.split('.').pop()}` : qualName,
    file: rel(fileName),
    module: moduleOf(fileName),
    group: groupOf(fileName),
    line: line + 1,
    kind,
    className: className || null,
    exported: isExported(decl),
    signature: signatureOf(decl, sf),
    doc,
    humanized: humanize(qualName.split('.').pop() || qualName),
    // Description shown in the viewer: JSDoc if the function has one, else a
    // verb-aware sentence inferred from its name. Curated overrides live in
    // descriptions.json and win over this at display time.
    desc: doc || autoDescribe(qualName.split('.').pop() || qualName),
    loc: met.loc,
    chars: met.chars,
    numeric: met.numeric,
    // Closure-scoped: declared INSIDE another function (a local helper, an object-literal value in a
    // call argument…). Name collisions across modules are meaningless for these — the duplicate
    // check skips them (a nested `clear`/`logActivity` is not copy-paste of a module-scope one).
    nested: !!ts.findAncestor(decl.parent, (n) => isFunctionLike(n)),
    tested: false
  });
  const body = /** @type {any} */ (decl).body;
  if (body) scanList.push({ id, body, decl });
}

/**
 * Dotted key path for an arrow/fn-expr that is an OBJECT-LITERAL value, walked up the
 * property/object chain to the owning declaration. So in
 *   handlers = { harvest: { complete: (j, g) => … } }
 * the arrow becomes "handlers.harvest.complete" — i.e. data-driven registry handlers
 * (ADR-017 job handlers, the W3 command registry, …) get real, named nodes.
 */
function objectPropChain(fn, sf) {
  const keys = [];
  let p = fn.parent;
  while (p) {
    if (ts.isPropertyAssignment(p) && p.name) keys.unshift(p.name.getText(sf));
    else if ((ts.isVariableDeclaration(p) || ts.isPropertyDeclaration(p)) && p.name) {
      keys.unshift(p.name.getText(sf));
      break;
    } else if (ts.isFunctionLike?.(p) || ts.isClassLike?.(p)) break;
    p = p.parent;
  }
  return keys.length ? keys.join('.') : 'handler';
}

function isExported(decl) {
  const mods = ts.canHaveModifiers(decl) ? ts.getModifiers(decl) : undefined;
  if (mods && mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) return true;
  // exported via variable statement
  let p = decl.parent;
  while (p) {
    if (ts.isVariableStatement(p)) {
      const vm = ts.getModifiers(p);
      return !!vm && vm.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    }
    if (ts.isSourceFile(p)) break;
    p = p.parent;
  }
  return false;
}

const STORE_FACTORIES = /^(writable|readable|derived|writableLocal|persisted|tweened|spring)$/;
function isStoreFactory(expr) {
  const name = ts.isIdentifier(expr) ? expr.text
    : ts.isPropertyAccessExpression(expr) ? expr.name.text : '';
  return STORE_FACTORIES.test(name);
}
/** A store: writable/derived/… call, or a custom object implementing `subscribe`. */
function isStoreInit(init) {
  if (ts.isCallExpression(init)) return isStoreFactory(init.expression);
  if (ts.isObjectLiteralExpression(init)) {
    return init.properties.some((p) => p.name && p.name.getText() === 'subscribe');
  }
  return false;
}

function isFunctionLike(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isGetAccessor(node) ||
    ts.isSetAccessor(node) ||
    ts.isConstructorDeclaration(node)
  );
}

function collectNodes(sf) {
  const visit = (node, ctx) => {
    // class context for method naming
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      const cname = node.name ? node.name.text : ctx.className || 'Anonymous';
      ts.forEachChild(node, (c) => visit(c, { ...ctx, className: cname }));
      return;
    }
    if (ts.isFunctionDeclaration(node) && node.name) {
      register(node, node.name.text, 'function', null, sf);
    } else if (ts.isMethodDeclaration(node) && node.name) {
      const m = node.name.getText(sf);
      register(node, ctx.className ? `${ctx.className}.${m}` : m, 'method', ctx.className, sf);
    } else if ((ts.isGetAccessor(node) || ts.isSetAccessor(node)) && node.name) {
      const m = node.name.getText(sf);
      const tag = ts.isGetAccessor(node) ? 'get ' : 'set ';
      register(
        node,
        ctx.className ? `${ctx.className}.${tag}${m}` : tag + m,
        'accessor',
        ctx.className,
        sf
      );
    } else if (ts.isConstructorDeclaration(node)) {
      register(
        node,
        ctx.className ? `${ctx.className}.constructor` : 'constructor',
        'method',
        ctx.className,
        sf
      );
    } else if (
      (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) &&
      node.name
    ) {
      const nm = node.name.getText(sf);
      const kind = ts.isPropertyDeclaration(node) ? 'method' : 'function';
      register(
        node.initializer,
        ctx.className ? `${ctx.className}.${nm}` : nm,
        kind,
        ctx.className || null,
        sf
      );
      // still descend into the function body for nested fns
    } else if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      node.name &&
      ts.isIdentifier(node.name) &&
      isStoreInit(node.initializer)
    ) {
      // a reactive store: `writable(...)`, `derived(...)`, or a custom store object
      register(node, node.name.text, 'store', null, sf);
    } else if (
      (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
      node.parent &&
      ts.isPropertyAssignment(node.parent) &&
      !declToId.has(node)
    ) {
      // Arrow / function-expression stored as an OBJECT-LITERAL VALUE — i.e. a data-driven
      // handler or command registry, e.g. `handlers = { harvest: { complete: (j,g) => this._completeHarvest(...) } }`.
      // These were never registered, so their bodies were never scanned in pass 2 and the calls they
      // make (→ the real `_complete*`/`_generate*` impls) vanished — making those impls read as having
      // zero callers / unreachable. Registering the arrow makes its calls real edges.
      const chain = objectPropChain(node, sf);
      register(
        node,
        ctx.className ? `${ctx.className}.${chain}` : chain,
        ctx.className ? 'method' : 'function',
        ctx.className || null,
        sf
      );
    }
    ts.forEachChild(node, (c) => visit(c, ctx));
  };
  ts.forEachChild(sf, (n) => visit(n, { className: null }));
}

// A Svelte component is registered as a single node; every call its <script>
// makes into a store/service becomes an edge (component -> function it uses).
function registerComponent(sf) {
  const fileName = sf.fileName;
  const base = path.basename(realPath(fileName), '.svelte');
  const id = makeId(fileName, base, 1);
  const txt = sf.getFullText(); // line-preserving twin → same size as the .svelte file
  nodes.set(id, {
    id,
    name: base,
    short: base,
    file: rel(fileName),
    module: moduleOf(fileName),
    group: groupOf(fileName),
    line: 1,
    kind: 'component',
    className: null,
    exported: true,
    signature: '<svelte component>',
    doc: '',
    humanized: humanize(base),
    desc: `${humanize(base)} — Svelte UI component.`,
    loc: txt.split('\n').length,
    chars: txt.length,
    numeric: 0,
    tested: false,
    // Svelte 5 best practice: prefer runes. Count legacy `$:` reactive statements.
    legacyReactive: (txt.match(/(^|\n)[ \t]*\$:/g) || []).length
  });
  componentScan.push({ id, sf });
}

const sourceFiles = program.getSourceFiles().filter((sf) => isSourceFile(sf.fileName));
const svelteCount = sourceFiles.filter((sf) => svelteVirtual.has(sf.fileName)).length;
console.error(`Scanning ${sourceFiles.length} source files (${svelteCount} Svelte)...`);
for (const sf of sourceFiles) {
  if (svelteVirtual.has(sf.fileName)) registerComponent(sf);
  else collectNodes(sf);
}

// Rust (WASM crates): add Rust fn/method nodes + intra-crate edges, and set up
// the TS↔Rust boundary bridge (the wasm-bindgen export surface, matched by name).
const rust = extractRust(ROOT, rel, CFG.rustCrates);
for (const n of rust.nodes) nodes.set(n.id, n);
const rustExports = rust.exports; // exportName -> rust node id
const rustExportNames = new Set(rust.exports.keys());
const wasmFiles = new Set(
  sourceFiles
    .filter((sf) => /spatial-core-pkg|spatial_core/.test(sf.getFullText()))
    .map((sf) => sf.fileName)
);
console.error(`Registered ${nodes.size} nodes (${rust.nodes.length} Rust).`);

// ---------------------------------------------------------------------------
// Pass 2 — resolve calls into edges
// ---------------------------------------------------------------------------
/** @type {Map<string, {from:string,to:string,count:number}>} */
const edges = new Map();

function resolveTargetId(symbol) {
  if (!symbol) return null;
  let s = symbol;
  if (s.flags & ts.SymbolFlags.Alias) {
    try {
      s = checker.getAliasedSymbol(s);
    } catch {
      /* ignore */
    }
  }
  const decls = s.declarations || [];
  for (const d of decls) {
    if (declToId.has(d)) return declToId.get(d);
    // arrow/function assigned to a variable: symbol decl is the VariableDeclaration
    if (
      (ts.isVariableDeclaration(d) || ts.isPropertyDeclaration(d)) &&
      d.initializer &&
      declToId.has(d.initializer)
    ) {
      return declToId.get(d.initializer);
    }
  }
  return null;
}

function addEdge(from, to) {
  if (!from || !to || from === to) return;
  const key = `${from} ${to}`;
  const e = edges.get(key);
  if (e) e.count++;
  else edges.set(key, { from, to, count: 1 });
}

// TS↔Rust boundary: a call like `mod.find_path(...)` in a file that imports the
// wasm-bindgen package is an edge into the Rust export of that name.
function maybeRustBoundary(node, ownerId) {
  const callee = node.expression;
  if (
    ts.isPropertyAccessExpression(callee) &&
    rustExportNames.has(callee.name.text) &&
    wasmFiles.has(node.getSourceFile().fileName)
  ) {
    addEdge(ownerId, rustExports.get(callee.name.text));
  }
}

// A method call on a store variable (`gameState.update(...)`, `.set`, `.subscribe`)
// is an edge into that store node — captures who writes/reads the store.
function maybeStoreEdge(node, ownerId) {
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.expression)) return;
  const id = resolveTargetId(checker.getSymbolAtLocation(callee.expression));
  if (id && nodes.get(id)?.kind === 'store') addEdge(ownerId, id);
}

// Registry dispatch bridge: a call like `handlers[type].complete(...)` (ADR-017 job handlers, the W3
// command registry, any `Record<K, {fn}>` dispatched dynamically) can't be statically resolved to one
// target — `[type]` is a runtime value. So link the caller to EVERY arrow value at that key in the
// registry's object literal (the correct over-approximation: the dispatch could reach any of them).
// Without this, the real `_complete*`/`_generate*` impls read as unreachable from the tick loop.
/** Resolve a property VALUE to a registered function node: an inline arrow/fn-expr, OR an identifier
 *  that references a named function (`{ [STATE.WORKING]: handleWorking }`). */
function fnIdFromValue(val) {
  if (ts.isArrowFunction(val) || ts.isFunctionExpression(val)) return declToId.get(val) || null;
  if (ts.isIdentifier(val)) return resolveTargetId(checker.getSymbolAtLocation(val));
  return null;
}
/** Collect registered function nodes from a registry object literal. `propName === null` → every
 *  function value (a `registry[key]()` dispatch — the value IS the fn); else only values under that
 *  key (a `registry[key].propName()` dispatch). Recurses through nested object literals. */
function collectRegistryFns(objLit, propName, out) {
  for (const p of objLit.properties) {
    if (!ts.isPropertyAssignment(p) || !p.name) continue;
    const keyMatch = propName === null || p.name.getText() === propName;
    const id = keyMatch ? fnIdFromValue(p.initializer) : null;
    if (id) out.push(id);
    else if (ts.isObjectLiteralExpression(p.initializer))
      collectRegistryFns(p.initializer, propName, out); // nested (e.g. keyed by job type)
  }
}
/** Drill an expression down to the object-literal it ultimately refers to (through `[key]`, locals,
 *  and `this.field`), so a dynamic dispatch base resolves to the registry's literal. */
function registryObjLit(expr, depth = 0) {
  if (!expr || depth > 6) return null;
  if (ts.isElementAccessExpression(expr) || ts.isParenthesizedExpression(expr))
    return registryObjLit(expr.expression, depth + 1);
  let sym;
  if (ts.isPropertyAccessExpression(expr)) sym = checker.getSymbolAtLocation(expr.name);
  else if (ts.isIdentifier(expr)) sym = checker.getSymbolAtLocation(expr);
  else return null;
  for (const d of sym?.declarations || []) {
    const init =
      ts.isVariableDeclaration(d) || ts.isPropertyDeclaration(d) ? d.initializer : undefined;
    if (!init) continue;
    if (ts.isObjectLiteralExpression(init)) return init;
    const nested = registryObjLit(init, depth + 1); // e.g. `const h = this.handlers[type]`
    if (nested) return nested;
  }
  return null;
}
function maybeRegistryDispatch(node, ownerId) {
  if (!ts.isCallExpression(node)) return;
  const callee = node.expression;
  let objLit = null;
  let propName = null;
  if (ts.isPropertyAccessExpression(callee)) {
    objLit = registryObjLit(callee.expression); // registry[key].method(...) or obj.method(...)
    propName = callee.name.text;
  } else {
    // `registry[key](...)`, or a local that holds it (`const h = registry[key]; h(...)`) — the
    // callee itself drills down to the registry, and the value at that key IS the fn (propName null).
    objLit = registryObjLit(callee);
    propName = null;
  }
  if (!objLit) return;
  const out = [];
  collectRegistryFns(objLit, propName, out);
  for (const tid of out) addEdge(ownerId, tid);
}

// Callback bridge: a function REFERENCED as a call argument (`forEach(sortNode)`,
// `addEventListener('scroll', onScroll)`, `setOutputSink(publish)`) or as a function value inside
// an object-literal argument (sink/options bundles: `installLogSink({ logActivity: … })`,
// `pickUpFromTile(gs, …, { acceptTest: (rid) => … })`) is not a CallExpression callee, so it read
// as having zero callers — the false-orphan batch of 2026-07-02. Passing ≠ calling, but the
// receiver invoking it is the overwhelmingly common case: the same over-approximation the registry
// bridge makes, with the same caveat.
/** Strip type-level wrappers (`expr as T`, `expr satisfies T`, `(expr)`, `expr!`) off an argument —
 *  `setSimLogSink({ … } as SimLogSink)` must still expose the object literal underneath. */
function unwrapExpr(e) {
  while (
    e &&
    (ts.isParenthesizedExpression(e) ||
      ts.isAsExpression(e) ||
      (ts.isSatisfiesExpression?.(e) ?? false) ||
      ts.isNonNullExpression(e))
  ) {
    e = e.expression;
  }
  return e;
}
/** Resolve an argument that references a registered function/method to its node id. */
function refArgTargetId(arg) {
  let sym = null;
  if (ts.isIdentifier(arg)) sym = checker.getSymbolAtLocation(arg);
  else if (ts.isPropertyAccessExpression(arg)) sym = checker.getSymbolAtLocation(arg.name);
  const id = resolveTargetId(sym);
  const kind = id && nodes.get(id)?.kind;
  return kind === 'function' || kind === 'method' ? id : null;
}
/** Add caller→callback edges for every function-referencing argument of a call. */
function addCallbackArgEdges(node, ownerId) {
  for (const rawArg of node.arguments || []) {
    const arg = unwrapExpr(rawArg);
    const tid = refArgTargetId(arg);
    if (tid) addEdge(ownerId, tid);
    else if (ts.isObjectLiteralExpression(arg)) {
      const out = [];
      collectRegistryFns(arg, null, out); // every fn value, incl. nested literals
      for (const t of out) addEdge(ownerId, t);
    }
  }
}

function scanCalls(body, ownerId) {
  const visit = (node) => {
    // do not descend into nested registered functions; they own their calls
    if (node !== body && isFunctionLike(node) && declToId.has(node)) return;

    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = node.expression;
      let sym = checker.getSymbolAtLocation(callee);
      if (!sym && ts.isPropertyAccessExpression(callee)) {
        sym = checker.getSymbolAtLocation(callee.name);
      }
      const targetId = resolveTargetId(sym);
      if (targetId) addEdge(ownerId, targetId);
      else {
        maybeRustBoundary(node, ownerId);
        maybeRegistryDispatch(node, ownerId); // dynamic registry dispatch → all matching handlers
      }
      addCallbackArgEdges(node, ownerId); // fn refs passed as arguments (callback bridge)
      maybeStoreEdge(node, ownerId);
    }
    ts.forEachChild(node, visit);
  };
  // Visit the body NODE itself, not just its children: a concise arrow's body IS the expression
  // (e.g. `(job, gs) => this._completeHarvest(job, gs)` — the body is the CallExpression), so
  // iterating only its children dropped the call. For block bodies this is equivalent.
  visit(body);
}

for (const { id, body } of scanList) scanCalls(body, id);

// Components: attribute every resolvable call in the whole <script> to the
// component node (UI logic lives at top level / in handlers, not just in fns).
function scanAllCalls(sf, ownerId) {
  const visit = (node) => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = node.expression;
      let sym = checker.getSymbolAtLocation(callee);
      if (!sym && ts.isPropertyAccessExpression(callee)) sym = checker.getSymbolAtLocation(callee.name);
      const targetId = resolveTargetId(sym);
      if (targetId) addEdge(ownerId, targetId);
      else {
        maybeRustBoundary(node, ownerId);
        maybeRegistryDispatch(node, ownerId); // dynamic registry dispatch → all matching handlers
      }
      addCallbackArgEdges(node, ownerId); // fn refs passed as arguments (callback bridge)
      maybeStoreEdge(node, ownerId);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
}

// Module top-level usage (.ts files): table builders (`raw.map(toDefinition)`), module-scope
// helper calls (`clips('fowl', 1)` building a const record), and wiring like `self.onmessage = …`
// run at import time and have NO registered caller node to hang an edge on. Mark the target
// `moduleUsed` instead — the orphan check treats it like `exported`/`tested` (module init runs it,
// so it is not dead code). Svelte components don't need this: scanAllCalls attributes their whole
// <script> (top level included) to the component node.
function markModuleUsed(id) {
  if (id && nodes.has(id)) nodes.get(id).moduleUsed = true;
}
function scanModuleLevel(sf) {
  const visit = (node) => {
    if (isFunctionLike(node) && declToId.has(node)) return; // registered fns own their calls
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = node.expression;
      let sym = checker.getSymbolAtLocation(callee);
      if (!sym && ts.isPropertyAccessExpression(callee)) sym = checker.getSymbolAtLocation(callee.name);
      markModuleUsed(resolveTargetId(sym));
      for (const rawArg of node.arguments || []) {
        const arg = unwrapExpr(rawArg);
        const tid = refArgTargetId(arg);
        if (tid) markModuleUsed(tid);
        else if (ts.isObjectLiteralExpression(arg)) {
          const out = [];
          collectRegistryFns(arg, null, out);
          for (const t of out) markModuleUsed(t);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
}
for (const sf of sourceFiles) {
  if (!svelteVirtual.has(sf.fileName)) scanModuleLevel(sf);
}

// Svelte reactive reads: `$gameState` auto-subscribes to the gameState store.
// These aren't calls, so match them textually against the component's store imports.
function componentStoreReads(sf, ownerId) {
  const local = new Map(); // imported name -> store node id
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause) continue;
    const nb = st.importClause.namedBindings;
    if (nb && ts.isNamedImports(nb)) {
      for (const el of nb.elements) {
        const id = resolveTargetId(checker.getSymbolAtLocation(el.name));
        if (id && nodes.get(id)?.kind === 'store') local.set(el.name.text, id);
      }
    }
  }
  if (!local.size) return;
  const text = sf.getFullText();
  const re = /\$([A-Za-z_]\w*)/g;
  let m;
  while ((m = re.exec(text))) {
    const id = local.get(m[1]);
    if (id) addEdge(ownerId, id);
  }
}

for (const { id, sf } of componentScan) {
  scanAllCalls(sf, id);
  componentStoreReads(sf, id);
}
for (const e of rust.edges) addEdge(e.from, e.to); // intra-Rust call edges

// Test coverage: mark any node directly called from a *.test.ts file as tested.
const testFiles = program
  .getSourceFiles()
  .filter((sf) => /\.test\.ts$/.test(sf.fileName) && sf.fileName.replace(/\\/g, '/').includes('/src/'));
function markTested(sf) {
  const visit = (node) => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = node.expression;
      let sym = checker.getSymbolAtLocation(callee);
      if (!sym && ts.isPropertyAccessExpression(callee)) sym = checker.getSymbolAtLocation(callee.name);
      const id = resolveTargetId(sym);
      if (id && nodes.has(id)) nodes.get(id).tested = true;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
}
for (const sf of testFiles) markTested(sf);
console.error(`Resolved ${edges.size} edges (${testFiles.length} test files scanned).`);

// ---------------------------------------------------------------------------
// Module-level rollup (file -> file dependency graph for the overview)
// ---------------------------------------------------------------------------
const moduleEdges = new Map();
for (const e of edges.values()) {
  const fromMod = nodes.get(e.from).module;
  const toMod = nodes.get(e.to).module;
  if (fromMod === toMod) continue;
  const key = `${fromMod} ${toMod}`;
  const me = moduleEdges.get(key);
  if (me) me.count += e.count;
  else moduleEdges.set(key, { from: fromMod, to: toMod, count: e.count });
}

const moduleNodes = new Map();
for (const n of nodes.values()) {
  if (!moduleNodes.has(n.module)) {
    moduleNodes.set(n.module, { module: n.module, group: n.group, file: n.file, fns: 0 });
  }
  moduleNodes.get(n.module).fns++;
}

// degree stats for sizing / "hub" detection
const indeg = new Map();
const outdeg = new Map();
for (const e of edges.values()) {
  outdeg.set(e.from, (outdeg.get(e.from) || 0) + 1);
  indeg.set(e.to, (indeg.get(e.to) || 0) + 1);
}
for (const n of nodes.values()) {
  n.inDegree = indeg.get(n.id) || 0;
  n.outDegree = outdeg.get(n.id) || 0;
}

// Full file list (incl. node-less definition files not present as module nodes).
const fnsByModule = new Map();
for (const n of nodes.values()) fnsByModule.set(n.module, (fnsByModule.get(n.module) || 0) + 1);
const fileList = [];
for (const sf of sourceFiles) {
  const mod = moduleOf(sf.fileName);
  fileList.push({
    file: rel(sf.fileName), module: mod, group: groupOf(sf.fileName),
    fns: fnsByModule.get(mod) || 0, lang: svelteVirtual.has(sf.fileName) ? 'svelte' : 'ts',
  });
}
for (const rf of new Set(rust.nodes.map((n) => n.file))) {
  const rn = rust.nodes.filter((n) => n.file === rf);
  fileList.push({ file: rf, module: rn[0].module, group: 'rust', fns: rn.length, lang: 'rust' });
}

// ADRs declared in the project's decisions doc — so the checker can flag any
// not onboarded into the project's adrRules. Skipped if the project has none.
let adrs = [];
if (CFG.adrsDocPath) {
  try {
    const dec = fs.readFileSync(CFG.adrsDocPath, 'utf8');
    adrs = [...dec.matchAll(/^#{2,4}\s+(ADR-\d+)\b[^:\n]*:\s*(.+?)\s*$/gm)].map((m) => ({ id: m[1], title: m[2].trim() }));
  } catch {
    /* decisions doc not found */
  }
}

// Curated plain-English descriptions (groups/modules/functions), embedded so the
// viewer is self-contained. Optional — projects without them still extract.
let descriptions = { groups: {}, modules: {}, functions: {} };
if (CFG.descriptionsPath) {
  try {
    descriptions = JSON.parse(fs.readFileSync(CFG.descriptionsPath, 'utf8'));
  } catch {
    /* no descriptions file */
  }
}

const out = {
  generatedAt: new Date().toISOString(),
  project: CFG.name,
  root: ROOT,
  descriptions,
  // Analysis knobs embedded so analysis.mjs is self-describing (no separate config plumbing).
  config: {
    layers: CFG.layers,
    godFunctions: CFG.godFunctions,
    adrRules: CFG.adrRules,
    namespacePrefix: (CFG.group && CFG.group.namespacePrefix) || null
  },
  adrs,
  stats: {
    files: fileList.length,
    functions: nodes.size,
    edges: edges.size,
    modules: moduleNodes.size
  },
  nodes: [...nodes.values()],
  edges: [...edges.values()],
  moduleNodes: [...moduleNodes.values()],
  moduleEdges: [...moduleEdges.values()],
  files: fileList
};

const outPath = process.env.CG_OUT || path.join(ROOT, 'graph.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
// Atomic write: the viewer may be reading this file while the dev watcher
// re-extracts. Write a temp file then rename (atomic on the same filesystem) so
// a concurrent reader never parses a half-written graph.
const tmpPath = `${outPath}.${process.pid}.tmp`;
fs.writeFileSync(tmpPath, JSON.stringify(out, null, 0));
fs.renameSync(tmpPath, outPath);
console.error(`Wrote ${outPath}`);
console.error(JSON.stringify(out.stats, null, 2));
