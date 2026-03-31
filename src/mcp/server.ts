#!/usr/bin/env node
/**
 * AVS Migration Planner — MCP Server (stdio transport)
 *
 * Exposes AVS sizing, pricing, cost, wave planning, and node advisory
 * as Model Context Protocol tools that any MCP client can invoke.
 *
 * Usage:
 *   npx tsx src/mcp/server.ts
 *
 * Or configure in VS Code settings.json / mcp.json:
 *   {
 *     "mcpServers": {
 *       "avs-migration-planner": {
 *         "command": "npx",
 *         "args": ["tsx", "src/mcp/server.ts"],
 *         "cwd": "<path-to-extension>"
 *       }
 *     }
 *   }
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// Import core modules (relative to src/)
import { parseVMInventory } from '../parsers/csvParser';
import { analyzeInventory, calculateRequirements } from '../analyzers/vmAnalyzer';
import { generateSizingRecommendations } from '../analyzers/clusterSizer';
import { calculateAllCosts, calculateTCO, detectSqlVMs } from '../calculators/costCalculator';
import { generateWavePlan, exportWavePlanText } from '../generators/wavePlanner';
import { generateNodeAdvisory, formatAdvisoryText } from '../analyzers/nodeAdvisor';
import { getAvailableNodeTypes, getRegionInfo } from '../models/regionAvailability';
import { AVS_NODE_SPECS, DEFAULT_SIZING_CONFIG, SizingConfig } from '../models/avsNode';
import { DEFAULT_TCO_CONFIG } from '../models/migrationPlan';
import { fetchAVSPricing } from '../pricing/azurePricingClient';
import { updateNodePricing } from '../models/avsNode';

const server = new McpServer({
    name: 'avs-migration-planner',
    version: '1.1.0'
});

// ============================================================
// Tool: avs_parse_inventory
// ============================================================
server.tool(
    'avs_parse_inventory',
    'Parse a VM inventory from CSV text (RVTools or Standard format). Returns VM count and workload summary.',
    {
        csvContent: z.string().describe('CSV file content (RVTools vInfo export or standard CSV)')
    },
    async ({ csvContent }) => {
        const result = parseVMInventory(csvContent);

        if (!result.success) {
            return {
                content: [{ type: 'text' as const, text: `Parsing failed:\n${result.errors.join('\n')}` }]
            };
        }

        const summary = analyzeInventory(result.vms);

        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({
                    success: true,
                    format: result.format,
                    totalVMs: summary.totalVMs,
                    poweredOn: summary.poweredOnVMs,
                    totalvCPUs: summary.totalvCPUs,
                    totalMemoryGB: Math.round(summary.totalMemoryGB),
                    totalStorageGB: Math.round(summary.totalStorageGB),
                    uniqueNetworks: summary.uniqueNetworks.length,
                    uniqueDatacenters: summary.uniqueDatacenters.length,
                    warnings: result.warnings
                }, null, 2)
            }]
        };
    }
);

// ============================================================
// Tool: avs_size_workload
// ============================================================
server.tool(
    'avs_size_workload',
    'Calculate AVS node sizing for a given workload. Returns recommendations for all 5 node types with utilization and fit scores.',
    {
        totalVCPUs: z.number().describe('Total vCPUs required'),
        totalMemoryGB: z.number().describe('Total memory in GB'),
        totalStorageGB: z.number().describe('Total storage in GB'),
        cpuOvercommit: z.number().optional().describe('CPU overcommit ratio (default: 4)'),
        enableHA: z.boolean().optional().describe('Enable N+1 HA node (default: true)'),
        dedupRatio: z.number().optional().describe('Dedup/compression ratio (default: 1.8)')
    },
    async ({ totalVCPUs, totalMemoryGB, totalStorageGB, cpuOvercommit, enableHA, dedupRatio }) => {
        const config: SizingConfig = {
            ...DEFAULT_SIZING_CONFIG,
            ...(cpuOvercommit !== undefined && { cpuOvercommit }),
            ...(enableHA !== undefined && { enableHANode: enableHA }),
            ...(dedupRatio !== undefined && { dedupCompressionRatio: dedupRatio })
        };

        const sizing = generateSizingRecommendations(totalVCPUs, totalMemoryGB, totalStorageGB, config);
        const costs = calculateAllCosts(sizing.recommendations);

        const results = sizing.recommendations.map((rec, i) => ({
            nodeType: rec.nodeType.type,
            displayName: rec.nodeType.displayName,
            nodesRequired: rec.nodesRequired,
            clusters: rec.clustersRequired,
            clusterLayout: rec.nodesPerCluster,
            utilization: {
                cpu: rec.utilizationCpu,
                memory: rec.utilizationMemory,
                storage: rec.utilizationStorage
            },
            fitScore: rec.fitScore,
            drivingDimension: rec.drivingDimension,
            includesHA: rec.includesHANode,
            isBestFit: rec === sizing.bestFit,
            monthlyCost3yrRI: costs[i]?.monthlyRI3Year
        }));

        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({
                    required: { vCPUs: totalVCPUs, memoryGB: totalMemoryGB, storageGB: totalStorageGB },
                    config: { cpuOvercommit: config.cpuOvercommit, dedupRatio: config.dedupCompressionRatio, haEnabled: config.enableHANode },
                    recommendations: results
                }, null, 2)
            }]
        };
    }
);

// ============================================================
// Tool: avs_node_advice
// ============================================================
server.tool(
    'avs_node_advice',
    'Get architect-level node selection advice with cost efficiency, waste analysis, workload archetypes, and regional warnings.',
    {
        totalVCPUs: z.number().describe('Total vCPUs required'),
        totalMemoryGB: z.number().describe('Total memory in GB'),
        totalStorageGB: z.number().describe('Total storage in GB'),
        region: z.string().optional().describe('Azure region (e.g., eastus, uksouth)')
    },
    async ({ totalVCPUs, totalMemoryGB, totalStorageGB, region }) => {
        const sizing = generateSizingRecommendations(totalVCPUs, totalMemoryGB, totalStorageGB);
        const advisory = generateNodeAdvisory(sizing.recommendations, region || 'eastus');
        const text = formatAdvisoryText(advisory);

        return {
            content: [{ type: 'text' as const, text }]
        };
    }
);

// ============================================================
// Tool: avs_check_region
// ============================================================
server.tool(
    'avs_check_region',
    'Check which AVS node types are available in a given Azure region, including stretched cluster and Gen 2 support.',
    {
        region: z.string().describe('Azure region (ARM name like eastus or display name like US East)')
    },
    async ({ region }) => {
        const info = getRegionInfo(region);
        const available = getAvailableNodeTypes(region);

        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({
                    region: info?.region || region,
                    found: !!info,
                    supportsStretchedCluster: info?.supportsStretchedCluster || false,
                    supportsGen2: info?.supportsGen2 || false,
                    availableNodeTypes: available
                }, null, 2)
            }]
        };
    }
);

// ============================================================
// Tool: avs_calculate_tco
// ============================================================
server.tool(
    'avs_calculate_tco',
    'Calculate multi-year TCO for an AVS deployment including node costs, Defender for Servers/SQL, and custom discounts.',
    {
        totalVCPUs: z.number().describe('Total vCPUs'),
        totalMemoryGB: z.number().describe('Total memory in GB'),
        totalStorageGB: z.number().describe('Total storage in GB'),
        years: z.number().min(1).max(5).optional().describe('TCO period in years (default: 3)'),
        totalVMCount: z.number().optional().describe('Total VM count for Defender costing'),
        sqlVMCount: z.number().optional().describe('Number of SQL/DB VMs'),
        riDiscount: z.number().min(0).max(1).optional().describe('Custom RI discount (0-1, e.g., 0.30 = 30%)')
    },
    async ({ totalVCPUs, totalMemoryGB, totalStorageGB, years, totalVMCount, sqlVMCount, riDiscount }) => {
        const sizing = generateSizingRecommendations(totalVCPUs, totalMemoryGB, totalStorageGB);
        const bestFit = sizing.bestFit;

        const tcoConfig = {
            ...DEFAULT_TCO_CONFIG,
            years: years || 3,
            totalVMCount: totalVMCount || 0,
            sqlVMCount: sqlVMCount || 0,
            includeDefender: (totalVMCount || 0) > 0,
            riDiscount: riDiscount || 0
        };

        const tco = calculateTCO(bestFit, tcoConfig);

        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({
                    nodeType: tco.nodeType,
                    nodeCount: tco.nodeCount,
                    monthlyTotal: tco.monthlyTotal,
                    monthlyBreakdown: {
                        avs: tco.monthlyAVSCost,
                        defenderServers: tco.monthlyDefenderServers,
                        defenderSql: tco.monthlyDefenderSql
                    },
                    yearlyBreakdown: tco.yearlyBreakdown,
                    totalCost: tco.totalCost,
                    discounts: tco.discountApplied
                }, null, 2)
            }]
        };
    }
);

// ============================================================
// Tool: avs_list_node_specs
// ============================================================
server.tool(
    'avs_list_node_specs',
    'List all AVS node type specifications — cores, RAM, storage, disks, pricing.',
    {},
    async () => {
        const specs = AVS_NODE_SPECS.map(s => ({
            type: s.type,
            displayName: s.displayName,
            cpuCores: s.cpuCores,
            usableVCPUs: s.usableVCPUs,
            ramGB: s.ramGB,
            usableRamGB: s.usableRamGB,
            rawStorageTB: s.rawStorageTB,
            usableStorageTB: s.usableStorageTB,
            disks: `${s.diskCount}×${s.diskSizeGB} GB`,
            pricing: {
                payg: s.payAsYouGoMonthly,
                ri1Year: s.ri1YearMonthly,
                ri3Year: s.ri3YearMonthly
            }
        }));

        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify(specs, null, 2)
            }]
        };
    }
);

// ============================================================
// Start server
// ============================================================
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('AVS Migration Planner MCP server running on stdio');
}

main().catch((err) => {
    console.error('MCP server error:', err);
    process.exit(1);
});
