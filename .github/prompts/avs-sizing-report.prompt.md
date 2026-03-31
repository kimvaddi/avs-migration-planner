---
description: "Generate a complete AVS sizing report from the imported VM inventory — node recommendations, driving dimensions, and cluster layout"
agent: "agent"
---
Using the currently imported AVS VM inventory, generate a comprehensive sizing report that includes:

1. **Workload Summary** — Total VMs, vCPUs, memory (GB), storage (GB), powered-on count
2. **Node Recommendations** — For each of the 5 AVS node types (AV36, AV36P, AV52, AV48, AV64):
   - Number of nodes required and cluster layout
   - CPU, Memory, Storage utilization percentages
   - Fit score (0-100) and driving dimension (CPU/Memory/Storage)
3. **Best Fit Recommendation** — Which node type is recommended and why
4. **Sizing Parameters** — Current SizingConfig (overcommit ratios, FTT policy, dedup, vSAN slack, N+1 HA)

Format the output as a well-structured markdown table. Highlight the best-fit node with a ★ marker.

If no inventory is imported yet, explain how to import one: `Ctrl+Shift+P` → `AVS: Import VM Inventory`.
