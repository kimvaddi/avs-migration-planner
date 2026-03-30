# Changelog

## [1.0.0] - 2026-03-30

### Features
- **VM Inventory Import** — RVTools vInfo CSV, standard CSV, semicolon-delimited (EU) formats with auto-detection
- **Multi-NIC Parsing** — Reads Network #1 through #4 columns from RVTools exports
- **AVS Node Sizing** — Recommendations across 5 node types: AV36, AV36P, AV52 (Gen 1), AV48, AV64 (Gen 2)
- **Live Pricing** — Real-time pricing from Azure Retail Prices API (prices.azure.com), offline fallback included
- **Cost Comparison** — Pay-As-You-Go, 1-Year RI, 3-Year RI side-by-side for all node types
- **Migration Wave Planner** — Smart 3-tier grouping (dependency → network affinity → tier ordering: infra→DB→app→web)
- **HCX Configuration** — Auto-generated mobility groups and network extensions per wave
- **Bicep Templates** — AVS Private Cloud, ExpressRoute Global Reach, NSX-T segments with configurable CIDR
- **Interactive Dashboard** — Full HTML dashboard with metrics, tables, risk badges
- **AI-Assisted Mode** — `@avs` Copilot Chat participant with /analyze, /recommend, /risk, /optimize, /explain commands
- **Save As Exports** — CSV (wave plan), JSON (HCX), Markdown (report), Bicep (templates)
- **Configurable Settings** — Wave limits, throughput, pricing region via VS Code settings
- **Session Persistence** — Imported data survives VS Code restarts

### Technical
- Node specs validated against [official Microsoft Learn documentation](https://learn.microsoft.com/azure/azure-vmware/introduction)
- HCX throughput based on [VMware HCX 4.10 Configuration Maximums](https://configmax.broadcom.com/)
- 130 unit tests across 7 test suites
- Zero runtime dependencies — all logic self-contained
- Strict Content Security Policy on webviews
- No telemetry, no tracking
