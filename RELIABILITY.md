# What this tool can and cannot be trusted about

Assessed 2026-08-25, against Fantasia4x (2756 nodes, 4450 edges, 352 files) at `c796227b`.

A graph explorer is only worth what its worst silent failure costs, because nothing
downstream can tell a wrong answer from a right one. This is the honest state of that:
what is verified, what is known-weak, and what is simply unknown. Numbers here are
measured, not estimated — rerun them before trusting this page, since it goes stale the
same way a graph does.

## Verified

| Claim | How it was checked |
| --- | --- |
| There is a test suite | `pnpm test` — 46 tests over a fixture project, ~13 s |
| Rust/WASM coverage is complete for the configured crates | 43 fns across `spatial-core` and `sim-core`, 39 nodes (4 `#[cfg(test)]` fns excluded) |
| An unconfigured crate is named, not dropped | `sim-core` had 37 fns and no `rustCrates` entry; the extract now warns |
| Path aliases resolve | `$lib/...` imports land; the fixture proves the config fallback works with no generated tsconfig |
| Staleness is detected exactly | commit compare, plus mtimes of uncommitted source files against the build time |
| Staleness can be made fatal | `audit index --require-fresh` exited 2 on a stale graph |
| The viewer self-freshens | page load rebuilt a graph 1 commit behind, twice, through the proxy |
| Concurrent rebuilds are per project | two loads of one project share a run; two projects get their own |
| `pnpm check` is green | 0 errors on a clone bootstrapped from nothing by `install.sh` |
| The graph reaches its consumer whole | 2717/2756 nodes map onto the Fantasia4x audit ledger; the other 39 are Rust, which that ledger does not walk |

## Known weak

### The test suite covers the extractor, not the viewer

`test/` runs the real extractor over `test/fixtures/tsproj` and asserts every node, edge,
span, parent and test depth it produces, plus the query API, the architecture checks, and
staleness. Nothing covers the Svelte components, the sigma rendering, or the `/api` route
handlers — those are still verified by having been looked at.

The fixture is 5 source files. It exercises each supported construct once; it does not
exercise the scale or the type-inference corners a real project has. Byte-parity against
a real extract is not part of it, so a change that alters Fantasia4x's graph without
altering the fixture's passes.

### `tested` means "called directly from a test file"

Not "covered". `markTested` walks each `*.test.ts` and marks what the call resolves to, so
anything reached one hop deeper — through a fixture, a helper, or a harness — is invisible
to that flag.

```
2599 functions/methods/accessors
 471 called directly from a test (18%)
1475 reached by one within 5 hops (57%)
     by hop: 1:566  2:259  3:121  4:50  5:8
```

This is why every node also carries `testDepth`: hops to the nearest directly-tested node,
`null` when no test reaches it at all. A consumer asking "is this untested?" should read
that, not `tested` — in services and systems, `tested` says 817 of 1082 are untested and
`testDepth` says 272 are. The API exposes both (`?tested=`, `?testReachable=`,
`?maxTestDepth=`).

What `testDepth` does not say is whether the test asserts anything about what it reaches.
Five hops from a test is not coverage; it is a call path that happens to start in one.

### The Rust extractor is syntactic

`rust.mjs` matches `fn` declarations and call sites with regular expressions. It has no
type information, so a call through a trait object or a generic resolves by name or not at
all, and two same-named fns in one crate are indistinguishable. It is sized for the small
WASM crates it is pointed at; the TS↔Rust edge across the wasm-bindgen boundary is matched
by export name, not resolved.

## Unverified

- **The `paths` fallback in a real project.** The fixture covers it, and it is dead in
  Fantasia4x whenever `.svelte-kit/tsconfig.json` exists, which is the normal case.
- **Every project except Fantasia4x.** The extractor is config-driven and meant to be
  generic; one real project and one fixture are what it has been measured against.
- **The filesystem plane.** `fsindex.mjs` indexes files on a machine rather than symbols in
  a codebase. No test touches it, and none of the checks above apply to it.

## Cost, not correctness

A page load that finds the graph behind the checkout rebuilds before rendering, which takes
about **13 s** (the extract itself); every later load is ~0.4 s. Rendering first and
correcting afterwards would be faster and would show a graph that is wrong for a moment,
which is the failure this whole page is about. The trade is deliberate.

Staleness now also covers uncommitted edits: a `git status` plus a stat of the changed
files the graph covers, on each page load. A touched source file costs a rebuild even when
the edit changed nothing the graph records.

## If you fix one thing

Pin a real project's graph, not just the fixture's. A byte-parity snapshot of the
Fantasia4x extract, diffed in CI, would catch the class of change the fixture is too small
to see — and it is the only claim on this page that nothing currently re-checks.
