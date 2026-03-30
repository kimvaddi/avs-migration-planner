# AVS Migration Planner

**Azure VMware Solution Migration Planner** for Visual Studio Code.

Plan, size, and estimate Azure VMware Solution (AVS) migrations directly from VS Code. Import your on-premises VM inventory, get instant recommendations for AVS node types and cluster sizing, compare Reserved Instance pricing, generate HCX migration configurations, produce ready-to-deploy Bicep templates, and create migration wave plans.

## Features

### 1. Import VM Inventory
- **RVTools CSV export** - Direct import from RVTools vInfo tab exports
- **Standard CSV** - Flexible column mapping for custom VM inventory formats
- Automatic format detection with validation and warnings

### 2. AVS Node Recommendations
- Analyzes CPU, memory, and storage requirements
- Recommends best-fit node type: **AV36**, **AV36P**, **AV52** (Gen 1) and **AV48**, **AV64** (Gen 2)
- Calculates cluster count with multi-cluster support
- Utilization scoring (CPU, RAM, Storage) with a fit score algorithm

### 3. Cost Calculator
- **Pay-As-You-Go** monthly/annual pricing
- **1-Year Reserved Instance** with savings percentage
- **3-Year Reserved Instance** with savings percentage
- Side-by-side comparison across all node types

### 4. HCX Configuration Generator
- Automatic **mobility group** creation per wave and network
- **Network extension** planning with wave dependency tracking
- Migration type selection (Bulk, vMotion, Cold)
- JSON and text export formats

### 5. Bicep Template Generator
- **AVS Private Cloud** deployment template
- **ExpressRoute Global Reach** peering configuration
- **NSX-T workload segments** for migrated networks
- Multi-cluster support with parameters file
- Ready for `az deployment group create`

### 6. Migration Wave Planner
- Groups VMs by **dependency** to keep application tiers together
- Bin-packing algorithm respects capacity limits per wave
- Sequential wave scheduling with configurable gaps
- **Risk assessment** per wave (Low / Medium / High)
- Network extension requirements per wave

### 7. Interactive Dashboard
- Full HTML dashboard with inventory summary
- Visual cards for key metrics
- Color-coded recommendations and wave plans
- Exportable full migration report

## Getting Started

1. Install the extension
2. Open the Command Palette (`Ctrl+Shift+P`)
3. Run **AVS: Import VM Inventory (CSV/RVTools)**
4. Select your CSV file
5. Run **AVS: Open Migration Dashboard** to see the full analysis

## Commands

| Command | Description |
|---------|-------------|
| `AVS: Import VM Inventory (CSV/RVTools)` | Import a VM inventory CSV file |
| `AVS: Open Migration Dashboard` | Open the interactive migration dashboard |
| `AVS: Generate Bicep Templates` | Generate AVS Private Cloud Bicep + parameters |
| `AVS: Generate HCX Configuration` | Generate HCX mobility groups and network extensions |
| `AVS: Generate Migration Wave Plan` | Generate the migration wave schedule |
| `AVS: Export Full Migration Report` | Export complete analysis as text |

## Supported CSV Formats

### RVTools Export
Export the **vInfo** tab from RVTools as CSV. Expected columns:
- `VM`, `Powerstate`, `CPUs`, `Memory MB`, `Provisioned MB`, `OS according to the configuration file`, `Datacenter`, `Cluster`, `Host`, `Network #1`

### Standard CSV
Use a simple CSV with these column names:
- `name`, `vcpus`, `memory_gb`, `storage_gb`, `os`, `power_state`, `datacenter`, `cluster`, `host`, `network`, `dependency_group`

## AVS Node Specifications

### Gen 1 (OSA Architecture)

| Node Type | vCPUs (Usable) | RAM (Usable) | Storage (Usable) |
|-----------|---------------|--------------|-------------------|
| AV36 | 54 | 490 GB | 5.4 TB |
| AV36P | 54 | 653 GB | 6.7 TB |
| AV52 | 78 | 1,306 GB | 13.4 TB |

### Gen 2 (ESA Architecture)

| Node Type | vCPUs (Usable) | RAM (Usable) | Storage (Usable) |
|-----------|---------------|--------------|-------------------|
| AV48 | 72 | 870 GB | 9.0 TB |
| AV64 | 96 | 870 GB | 5.4 TB |

*Usable capacity accounts for ESXi/vSAN overhead and FTT=1 RAID-1 mirroring.*

## Pricing Note

Pricing estimates are approximate and based on US East region as a reference. **Always verify current pricing** with the [Azure Pricing Calculator](https://azure.microsoft.com/pricing/calculator/) before making purchasing decisions.

## Requirements

- Visual Studio Code 1.85.0 or later
- A VM inventory in CSV format (RVTools export or standard format)

## Extension Settings

This extension contributes the following:
- Activity bar icon for AVS Migration Planner
- VM Inventory tree view
- Recommendations tree view

## Release Notes

### 1.0.0
- Initial release
- CSV/RVTools import with auto-detection
- AVS node sizing (AV36, AV36P, AV52, AV48, AV64)
- Cost comparison (PAYG, 1yr RI, 3yr RI)
- HCX mobility group and network extension generation
- Bicep template generation (Private Cloud, ExpressRoute, NSX-T)
- Migration wave planner with dependency grouping
- Interactive HTML dashboard

## License

MIT
