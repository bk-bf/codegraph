# What this tool can and cannot be trusted about

Assessed 2026-08-25, against Fantasia4x (2724 nodes, 4438 edges, 351 files).

A graph explorer is only worth what its worst silent failure costs, because nothing
downstream can tell a wrong answer from a right one. This is the honest state of that:
what is verified, what is known-weak, and what is simply unknown. Numbers here are
measured, not estimated — rerun them before trusting this page, since it goes stale the
same way a graph does.

## Verified

| Claim | How it was checked |
| --- | --- |
| Rust/WASM coverage is complete | 6 functions in `spatial-core/src/lib.rs`, 6 nodes in the graph |
| Path aliases resolve | `$lib/...` imports land; edges 3857 → 4438 after the fix |
| Staleness is detected exactly | moved HEAD past the graph's stamp; `index` named both revisions |
| Staleness can be made fatal | `audit index --require-fresh` exited 2 on a stale graph |
| The viewer self-freshens | page load rebuilt a graph 1 commit behind, twice, through the proxy |
| `pnpm check` is green | 0 errors on a clone bootstrapped from nothing by `install.sh` |
| Typing `analysis.mjs` changed no behaviour | re-extract produced byte-identical `nodes` and `edges` |

## Known weak

### There is no test suite

Zero tests. Every fix in this repo is verified by having been run once, by hand, by
whoever made it. Nothing guards against a regression, and no claim on this page is
re-checked automatically. This is the single largest reason not to describe the tool as
reliable, and it undercuts every row in the table above.

### 18% of the graph does not reach a consumer

Mapping codegraph's nodes onto the Fantasia4x audit ledger's symbols:

```
graph: 2243/2724 nodes mapped (82%), 3468 edges, 970 unmapped
```

970 nodes carry no reachability and no caller triggers for the consumer, and **the
consumer's own alarm threshold is `<80%`** — so this passes two points above the line
that would have said something. Whether the loss is legitimate (nodes with no ledger
counterpart) or a mapping defect has not been investigated. Until it is, "the hot path is
clean" from any consumer means "the 82% we could match looked clean".

### `tested` means "called directly from a test file"

Not "covered". `markTested` walks each `*.test.ts` and marks what the call resolves to, so
anything reached one hop deeper — through a fixture, a helper, or a harness — is invisible.

```
465 of 2559 functions/methods marked tested (18%)
817 functions in services/systems marked untested
```

Fantasia4x drives most of its suite through `buildScenario` / `HeadlessSession`, so a
consumer asking "is this untested?" will get false positives on code that has tests.
Following calls through helper declarations was tried and measured at **+2 nodes**, so the
figure is probably honest for direct calls — the gap is in what the flag *means*, not in
its arithmetic.

## Unverified

- **Concurrent rebuilds.** `freshness.ts` shares one in-flight promise so simultaneous page
  loads await a single extraction. The logic is simple; it has never been run under actual
  concurrent load.
- **The `paths` fallback.** `codegraph.config.json` may declare path aliases for a checkout
  whose generated tsconfig is missing. It is dead whenever `.svelte-kit/tsconfig.json`
  exists, which is the normal case — so the fallback path is rarely exercised.
- **Every project except Fantasia4x.** The extractor is config-driven and meant to be
  generic, but one project is the only one it has been measured against.

## Cost, not correctness

A page load that finds the graph behind the checkout rebuilds before rendering, which takes
about **13 s** (the extract itself); every later load is ~0.4 s. Rendering first and
correcting afterwards would be faster and would show a graph that is wrong for a moment,
which is the failure this whole page is about. The trade is deliberate.

## If you fix one thing

The 970 unmapped nodes. It is a concrete number, it is checkable, and it currently sits
just above the threshold that would have warned somebody.
