---
description: "Review and explain the migration wave plan — wave grouping logic, risk levels, dependencies, and scheduling"
agent: "agent"
---
Using the currently imported AVS migration data, provide a detailed review of the migration wave plan:

1. **Wave Summary** — Total waves, total VMs, estimated total migration days
2. **Per-Wave Breakdown** — For each wave:
   - VM count, vCPU/Memory/Storage totals
   - Risk level (Low/Medium/High) and why
   - Estimated duration and day offset
   - Network extensions required
   - Dependencies on previous waves
3. **Grouping Logic** — Explain how VMs were grouped:
   - Explicit dependency groups
   - Network affinity (same VLAN)
   - Tier ordering (Infrastructure → Database → App → Web)
4. **Risk Assessment** — Highlight the highest-risk waves and suggest mitigations
5. **Optimization Suggestions** — Any waves that could be reordered or split

If no inventory is imported yet, instruct the user to run `AVS: Import VM Inventory`.
