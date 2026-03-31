---
description: "Compare all 5 AVS node types side-by-side with cost efficiency, waste analysis, and architect-level rationale"
agent: "agent"
---
Compare all 5 Azure VMware Solution node types for the currently imported workload:

For each node type (AV36, AV36P, AV52, AV48, AV64), produce a comparison that includes:

1. **Cost Efficiency** — $/vCPU, $/GB RAM, $/TB storage (using 3yr RI pricing)
2. **Resource Waste** — % of CPU, Memory, Storage that would go unused
3. **Driving Dimension** — Which resource (CPU/Memory/Storage) requires the most nodes
4. **Verdict** — RECOMMENDED, SUITABLE, or NOT RECOMMENDED with reasoning
5. **Best For** — What workload types each node is designed for (e.g., "SQL Server, SAP HANA" for AV52)
6. **Warnings** — Regional availability issues, Gen 2 requirements, external storage suggestions

End with a clear recommendation: "For your workload, choose [node type] because [reason]."

If no inventory is imported, instruct the user to run `AVS: Import VM Inventory` first.
