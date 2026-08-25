# codegraph

Architecture-aware call-graph explorer. Builds a **type-resolved** graph across
TypeScript, Svelte, and Rust (through the WASM boundary) for any project, enforces
that project's **layer model and ADRs as graph checks**, and exposes the whole
thing to a browser viewer and an agent-facing query API.

Unlike file/dependency visualizers, the differentiator is the **architecture
contract**: each onboarded project declares its layers and ADR rules, and the
checker fails when the code violates them.

## Onboard a project

A project is any directory with a `codegraph.config.json` at its root:

```jsonc
{
  "name": "Fantasia4x",
  "tsconfig": "tsconfig.json",
  "srcDir": "src/lib",          // only .ts under here are graph sources
  "svelteRoot": "src",          // scanned for .svelte
  "rustCrates": ["spatial-core"],
  "adrsDoc": ".docs/game/DECISIONS.md",
  "descriptions": "codegraph.descriptions.json",
  "group": { "namespacePrefix": "game" },  // game/services/Foo -> group "services"
  "layers": { "core": 0, "services": 2, "systems": 3, "stores": 4, "components": 5 },
  "adrRules": [ /* declarative architecture rules, see src/lib/core/analysis.mjs */ ]
}
```

Configs are **pure JSON** — analysing a project never executes that project's code.

```bash
node bin/codegraph.mjs onboard ../Fantasia4x   # register it (reads name from config)
node bin/codegraph.mjs list                     # show registered projects
node bin/codegraph.mjs extract Fantasia4x       # build data/Fantasia4x.json
node bin/codegraph.mjs extract                  # rebuild all registered projects
```

## View

```bash
pnpm dev        # SvelteKit viewer on http://localhost:5185
```

The viewer reads `data/<project>.json`. It is force-directed (graphology + sigma);
toggle between the **module view** and the **function view**.

## Run it as a service

To keep the viewer up without a terminal, install the systemd `--user` unit. The
template in `deploy/` carries placeholders; `install.sh` fills in this checkout's
path, the `node` on your `PATH`, the port, and the project to build on first
start — so a clone in any directory works.

```bash
./install.sh --with-units                  # write the unit, start nothing
./install.sh --enable-units                # …and enable --now it
./install.sh --port 6000 --project laptop  # non-default port / first graph
./install.sh --uninstall                   # remove it again
```

Nothing is enabled or started unless you ask, and a machine without systemd is a
no-op rather than an error. The unit runs in `background.slice` at `Nice=10`, so
an on-demand rebuild yields to whatever you are profiling. Add
`loginctl enable-linger $USER` if it should survive logout.

## Layout

| Path | Role |
| --- | --- |
| `src/lib/core/` | extractor backend (Node): `extract.mjs` (TS+Svelte via the TS compiler API), `rust.mjs`, `analysis.mjs` (checks), `config.mjs` (project-config loader), `api.mjs`, `diff.mjs`, `check.mjs` |
| `src/lib/graph/` | client-side graph building (graphology) + colours/types |
| `src/routes/` | SvelteKit viewer + (soon) `/api` endpoints |
| `bin/codegraph.mjs` | CLI: onboard / list / extract / check / diff |
| `data/` | generated `<project>.json` graphs (gitignored) |
| `projects.json` | registered project name → path |

## Status

Migrated from a self-contained vanilla-HTML tool. Done: standalone repo,
config-driven extractor (byte-parity with the original), SvelteKit + sigma force
graph. In progress: graphology-based checks, detail/insights
panels, `/api` endpoints, static-HTML export.
