---
description: "Generate a multi-year TCO estimate with Defender costs and discount modeling for the imported AVS workload"
agent: "agent"
---
Using the currently imported AVS VM inventory, generate a Total Cost of Ownership (TCO) estimate:

1. **AVS Node Costs** — Monthly and yearly breakdown using:
   - Pay-As-You-Go rate
   - 1-Year Reserved Instance
   - 3-Year Reserved Instance
2. **Defender Costs** — Identify SQL/DB VMs by name pattern and calculate:
   - Microsoft Defender for Servers Plan 2 ($14.60/VM/month)
   - Microsoft Defender for SQL ($15.00/DB server/month)
3. **3-Year and 5-Year TCO** — Full yearly breakdown showing AVS + Defender line items
4. **Discount Scenarios** — Show what happens with:
   - 15% PAYG discount (typical EA/CSP)
   - 30% RI discount (negotiated rate)

Present as a formatted table with yearly totals and a grand total row.

If no inventory is imported yet, explain how: `Ctrl+Shift+P` → `AVS: Import VM Inventory`.
