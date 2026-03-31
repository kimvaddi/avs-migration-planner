# AVS Migration Planner — Copilot Instructions

VS Code extension that converts VMware VM inventories (RVTools/Standard CSV) into Azure VMware Solution migration plans with cluster sizing, cost estimation, wave planning, Bicep IaC, and HCX configuration.

## Build & Test

```shell
npm run compile        # Dev build (webpack → dist/extension.js)
npm run watch          # Continuous dev compilation
npm run package        # Production build (minified, hidden source maps)
npm test               # 178 Mocha unit tests (ts-node, no pre-compile needed)
npm run compile-tests  # Compile tests to /out/ for debugger
npm run lint           # ESLint
```

**Publisher:** `KimVaddi` — must match exactly in package.json.

## Architecture

Data flows through a linear pipeline:

```
CSV → parsers/ → models/ → analyzers/ → pricing/ → calculators/ → generators/ → views/chat/
```

| Layer | Path | Responsibility |
|-------|------|----------------|
| Models | `src/models/` | Data types (`VMInventoryItem`, `AVSNodeType`, `SizingConfig`, `TCOEstimate`, `AVSRegionInfo`) |
| Parsers | `src/parsers/` | CSV → `VMInventoryItem[]` with auto-detected format & delimiter |
| Analyzers | `src/analyzers/` | Inventory aggregation, cluster sizing (configurable overcommit, vSAN formula, N+1 HA) |
| Pricing | `src/pricing/` | Azure Retail Prices API with hardcoded fallback |
| Calculators | `src/calculators/` | PAYG / 1Y RI / 3Y RI cost estimation + multi-year TCO + Defender costs |
| Generators | `src/generators/` | Bicep templates, HCX mobility groups, wave plans, Excel report (.xlsx) |
| Views | `src/views/` | HTML-only dashboard webview, sidebar tree providers |
| Chat | `src/chat/` | `@avs` Copilot Chat participant (5 slash commands) |

Entry point: `src/extension.ts` — handles activation, state restoration, command/view registration.

## Key Conventions

- **No default exports.** All functions and interfaces use named exports.
- **Structured error returns.** Parsers return `{ success, data, errors[], warnings[] }` — don't throw for expected failures.
- **State provider pattern.** Extension passes closures (getters) to chat participant, not singletons or DI.
- **`DEFAULT_CONFIG` + Partial\<T\>.** Modules define defaults as `const`, callers override with partial objects. See `DEFAULT_SIZING_CONFIG`, `DEFAULT_TCO_CONFIG`.
- **Floating-point guards.** Use `.toFixed(2)` before `Math.ceil()` in resource calculations to avoid IEEE 754 artifacts.
- **Zero runtime dependencies.** Everything is self-contained except `exceljs` for Excel export; keep new dependencies minimal.
- **vSAN sizing formula.** Storage usable = `raw / FTT_overhead × (1 - slack) × dedup`. Never use a flat multiplier. See `calculateUsableStorage()` in `avsNode.ts`.
- **CPU overcommit.** Always use `physicalCores × overcommitRatio`, not hyperthreaded cores. See `calculateUsableVCPUs()` in `avsNode.ts`.
- **N+1 HA.** Cluster sizing adds +1 node by default. Controlled by `SizingConfig.enableHANode`.

## TypeScript Style

- Strict mode (`strict: true`, `noImplicitReturns: true`, `noFallthroughCasesInSwitch: true`)
- **Types/Interfaces:** PascalCase with domain suffix — `SizingResult`, `ParseResult`, `CostEstimate`
- **Functions:** camelCase with domain verb — `parseVMInventory`, `calculateCost`, `generateWavePlan`
- **Constants:** UPPER_SNAKE_CASE — `AVS_CLUSTER_MIN_NODES`, `DEFAULT_CONFIG`
- Target: ES2021, module: Node16

## Testing

- **Framework:** Mocha + Node.js `assert` (no Chai, no Sinon)
- **Location:** `src/test/unit/<module>.test.ts` — one test file per source module
- **Pattern:** AAA (Arrange-Act-Assert), one behavior per `it()`, clear names like `should count powered-on VMs`
- **Helpers:** `makeVM()` factory creates test VMs with defaults + overrides
- **Test data:** `test-data/sample-rvtools.csv`, `test-data/sample-standard.csv`
- **Timeout:** 10 seconds (for file I/O tests)

When adding a new module, add a corresponding `src/test/unit/<module>.test.ts`.

## Dashboard / Webview Security

The dashboard in `src/views/dashboardProvider.ts` uses a strict CSP with **no JavaScript** — HTML + CSS only, themed via VS Code CSS variables. Never add inline scripts or external resource loads.

## Azure Pricing API

- Endpoint: `prices.azure.com/api/retail/prices` (public, no auth)
- Filter: `contains(productName, 'VMware')` scoped by region
- Fallback: hardcoded US East pricing if the API is unreachable
- No retry logic — if the call fails, fallback activates silently

## Known Pitfalls

- **CSV encoding:** Parser assumes UTF-8; no BOM handling.
- **Header language:** Only English column headers are detected (RVTools/Standard).
- **Large inventories:** Wave planner bin-packing is O(n²); may be slow above ~10K VMs.
- **Tier inference:** App tiers (DNS/DB/Web) are guessed from VM name patterns — heuristic, not tagged.
- **CIDR validation:** Bicep generator accepts user-provided CIDR blocks without validation.
- **Gen 2 regional limits:** AV48/AV64 only available in select regions. Use `getAvailableNodeTypes()` to check.
- **Overcommit assumptions:** Default 4:1 CPU overcommit is for production. Dev/test workloads can use 8:1.

## Docs Reference

- [README.md](../README.md) — Features, quick start, node specs, pricing disclaimers
- [RUNBOOK.md](../RUNBOOK.md) — Build log, test results, resolved issues with root cause analysis
- [CHANGELOG.md](../CHANGELOG.md) — Release history
