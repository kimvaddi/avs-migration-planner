# AVS Migration Planner

<p align="center">
  <img src="media/icon.png" alt="AVS Migration Planner" width="128" />
</p>

**Azure VMware Solution Migration Planner with AI-Assisted Analysis** for Visual Studio Code.

> Turn weeks of Azure VMware Solution migration planning into minutes.

Planning an AVS migration today means weeks of spreadsheets — analyzing VM inventories, mapping to node types, estimating costs, planning network extensions, and writing Bicep templates from scratch. This extension does all of that inside VS Code.

## Why This Exists

| Without this extension | With this extension |
|----------------------|-------------------|
| Weeks of manual spreadsheet analysis | **Minutes** — import CSV, get instant results |
| Guessing at node types and cluster sizes | **Data-driven** — fit-score algorithm across 5 node types |
| Outdated pricing from old proposals | **Live pricing** from Azure Retail Prices API |
| Hand-writing Bicep templates | **Auto-generated** Bicep with ExpressRoute + NSX-T segments |
| Migration waves planned on whiteboards | **Smart wave planner** with dependency grouping and risk scoring |
| No way to ask "what if" questions | **AI-assisted** — `@avs` in Copilot Chat for instant expert analysis |

## Quick Start

1. **Install** the extension from the VS Code Marketplace
2. **Import** your VM inventory: `Ctrl+Shift+P` → `AVS: Import VM Inventory`
3. **View** the dashboard: `Ctrl+Shift+P` → `AVS: Open Migration Dashboard`
4. **Ask AI**: Open Copilot Chat → type `@avs /analyze`

That's it. You'll see node recommendations, cost comparisons, migration waves, and network extension plans — all in seconds.

<!-- Screenshot: Full dashboard after importing a VM inventory -->
<!-- Replace with your own screenshot: save to docs/images/dashboard.png -->
![Dashboard](docs/images/dashboard.png)

## What You Get

### 1. Import Any VM Inventory
Drop in your RVTools export or any CSV with VM data. The parser auto-detects the format.

- **RVTools** — Direct import from vInfo tab CSV exports (Network #1 through #4 supported)
- **Standard CSV** — Works with any CSV that has name, vCPUs, memory, storage columns
- **EU locales** — Semicolon-delimited CSVs detected automatically
- **Validation** — Warnings for missing data, unit conversion (MB→GB), power state normalization

<!-- Screenshot: Import notification showing VM count and best-fit recommendation -->
<!-- Replace with your own screenshot: save to docs/images/import.png -->
![Import](docs/images/import.png)

### 2. AVS Node Sizing (Gen 1 + Gen 2)
Analyzes your total CPU, memory, and storage needs (with configurable overhead buffers) and recommends the best-fit node type across all available SKUs:

**Gen 1 (OSA Architecture)**
| Node | Usable vCPUs | Usable RAM | Usable Storage |
|------|-------------|-----------|----------------|
| AV36 | 54 | 490 GB | 5.3 TB |
| AV36P | 54 | 653 GB | 6.7 TB |
| AV52 | 78 | 1,306 GB | 13.4 TB |

**Gen 2 (ESA Architecture)**
| Node | Usable vCPUs | Usable RAM | Usable Storage |
|------|-------------|-----------|----------------|
| AV48 | 72 | 870 GB | 9.0 TB |
| AV64* | 96 | 870 GB | 5.4 TB |

*\*AV64 requires an existing AV36/AV36P/AV52 private cloud — cannot be the initial deployment.*

All specs validated against [official Microsoft documentation](https://learn.microsoft.com/azure/azure-vmware/introduction).

### 3. Live Cost Estimates
Pricing fetched in real-time from the [Azure Retail Prices API](https://prices.azure.com) (no authentication needed). Falls back to reference estimates when offline.

- **Pay-As-You-Go** vs **1-Year RI** vs **3-Year RI** — side by side
- Savings percentages calculated for each commitment tier
- All 5 node types compared in one view
- Region-configurable via VS Code settings

> **Important:** Pricing is approximate. Always verify with the [Azure Pricing Calculator](https://azure.microsoft.com/pricing/calculator/) and your Microsoft account team for Reserved Instance quotes.

### 4. Migration Wave Planner
Groups your VMs into migration waves using a smart 3-tier strategy:

1. **Explicit dependencies** — VMs tagged with the same dependency group stay together
2. **Network affinity** — VMs sharing the same VLAN are grouped automatically (no tagging needed)
3. **Tier ordering** — Infrastructure migrates first, then databases, then apps, then web frontends

Each wave includes:
- Risk level (Low / Medium / High)
- Estimated duration based on [HCX 4.10 documented throughput](https://configmax.broadcom.com/) (100 GB/hr default for 1 Gbps ExpressRoute, with 2-hour switchover buffer)
- Required network extensions
- Sequential scheduling with configurable gaps between waves

Export as **CSV** (for Excel/project management) or **text report**.

### 5. HCX Configuration Generator
Auto-generates VMware HCX mobility groups and network extensions from your wave plan:

- One mobility group per wave per network
- Migration type auto-selected: Bulk (parallel) for large groups, vMotion (zero-downtime) for small groups
- Network extension tracking with per-wave dependencies
- Export as **JSON** (for automation) or **text report**

### 6. Bicep Template Generator
Produces deployment-ready Bicep templates for your AVS private cloud:

- **Private Cloud** resource with correct SKU and cluster size
- **ExpressRoute Global Reach** peering (optional)
- **NSX-T workload segments** with configurable base CIDR (warns about IP conflicts)
- **Multi-cluster** support for large deployments
- **Internet access** toggle (Enabled/Disabled)
- Parameters file included — ready for `az deployment group create`

### 7. AI-Assisted Mode (`@avs` in Copilot Chat)
Ask questions about your migration using natural language. The AI sees your actual imported data — not generic advice.

<!-- Screenshot: @avs /analyze in Copilot Chat -->
<!-- Replace with your own screenshot: save to docs/images/ai-chat.png -->
![AI Chat](docs/images/ai-chat.png)

| Command | What you get |
|---------|-------------|
| `@avs /analyze` | Executive summary, workload characterization, complexity rating, top risks |
| `@avs /recommend` | Architecture advice — SKU rationale, storage strategy, ExpressRoute sizing |
| `@avs /risk` | Per-wave risk register with likelihood, impact, and mitigation |
| `@avs /optimize` | Cost optimization — RI break-even, right-sizing, decommission candidates |
| `@avs /explain` | Plain-language summary for project managers and stakeholders |
| `@avs Why AV36P over AV52?` | Freeform questions answered with your specific data |

Requires **GitHub Copilot subscription** and **VS Code 1.93+**.

### 8. Interactive Dashboard
A full-page HTML dashboard with:

<!-- Screenshot: Dashboard with metrics, cost table, wave plan -->
<!-- Replace with your own screenshot: save to docs/images/dashboard-detail.png -->
![Dashboard Detail](docs/images/dashboard-detail.png)
- Visual metric cards (VMs, vCPUs, memory, storage, networks)
- OS distribution breakdown
- Node recommendation comparison table with fit scores
- Cost comparison with savings highlights
- Migration wave timeline with per-wave VM lists and risk badges
- Network extension summary

## All Commands

| Command | Description |
|---------|-------------|
| `AVS: Import VM Inventory (CSV/RVTools)` | Import and analyze a VM inventory |
| `AVS: Open Migration Dashboard` | Full visual dashboard in a new tab |
| `AVS: Generate Bicep Templates` | Interactive Bicep generator with prompts |
| `AVS: Generate HCX Configuration` | Export HCX config as JSON or text |
| `AVS: Generate Migration Wave Plan` | Export waves as CSV (Excel) or text |
| `AVS: Export Full Migration Report` | Everything in one Markdown/text file |

## Settings

Configure in VS Code Settings (`Ctrl+,`) under **AVS Migration Planner**:

| Setting | Default | Description |
|---------|---------|-------------|
| `wave.maxVMsPerWave` | 25 | Max VMs per migration wave |
| `wave.maxVCPUsPerWave` | 200 | Max vCPUs per wave |
| `wave.maxStoragePerWaveGB` | 5000 | Max storage (GB) per wave |
| `wave.daysBetweenWaves` | 3 | Days between wave start dates |
| `wave.throughputGBPerHour` | 100 | HCX throughput (100 for 1Gbps ER, 500+ for 10Gbps) |
| `pricing.region` | eastus | Azure region for pricing lookup |

## Supported CSV Formats

### RVTools Export
Export the **vInfo** tab from RVTools as CSV. The extension reads these columns:
- `VM`, `Powerstate`, `CPUs`, `Memory MB`, `Provisioned MB`, `Datacenter`, `Cluster`, `Host`
- `Network #1`, `Network #2`, `Network #3`, `Network #4` (all NICs parsed)
- `Annotation` (used as dependency group if present)

### Standard CSV
Any CSV with these column headers (flexible naming):
- `name`, `vcpus`, `memory_gb`, `storage_gb`, `os`, `power_state`
- `datacenter`, `cluster`, `host`, `network`, `dependency_group`

### Semicolon-Delimited
EU-locale CSVs using `;` as delimiter are auto-detected. No configuration needed.

## Who Is This For?

- **Cloud architects** planning AVS migrations from on-premises VMware
- **Pre-sales engineers** building AVS proposals and cost estimates
- **Migration project managers** creating wave plans and schedules
- **Infrastructure teams** generating Bicep templates for AVS deployment
- **Anyone** with an RVTools export who needs to answer "how much will AVS cost?"

## Requirements

- **VS Code** 1.93.0 or later
- **VM inventory** in CSV format (RVTools export recommended)
- **GitHub Copilot** subscription (for `@avs` AI-assisted commands — optional)
- **Internet access** (for live pricing from prices.azure.com — works offline with fallback estimates)

## Data & Privacy

- **No data leaves your machine** except one HTTPS call to `prices.azure.com` for pricing (a public API, no auth)
- Your VM inventory is never uploaded anywhere
- AI-assisted mode sends migration summary data to GitHub Copilot (same as any Copilot Chat interaction)
- No telemetry, no tracking, no analytics

## Release Notes

### 1.0.0
- RVTools and standard CSV import with auto-detection and EU semicolon support
- AVS node sizing across 5 types: AV36, AV36P, AV52 (Gen 1), AV48, AV64 (Gen 2)
- Live pricing from Azure Retail Prices API with offline fallback
- Cost comparison: Pay-As-You-Go, 1-Year RI, 3-Year RI
- Smart wave planner: dependency grouping → network affinity → tier ordering
- HCX mobility group and network extension generator
- Bicep templates: Private Cloud, ExpressRoute Global Reach, NSX-T segments
- Interactive HTML dashboard
- AI-assisted mode via `@avs` Copilot Chat participant
- Configurable wave limits and throughput via VS Code settings
- Session state persistence across VS Code restarts
- Save As dialogs for all exports (CSV, JSON, Markdown)

## License

[MIT](LICENSE)

## Contributing

Issues and pull requests welcome at [github.com/kimvaddi/avs-migration-planner](https://github.com/kimvaddi/avs-migration-planner).
