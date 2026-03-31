import * as vscode from 'vscode';
import { VMInventoryItem, InventorySummary } from '../models/vm';
import { SizingResult, ClusterRecommendation, DEFAULT_SIZING_CONFIG } from '../models/avsNode';
import { CostEstimate, MigrationWavePlan } from '../models/migrationPlan';
import { calculateTCO, detectSqlVMs } from '../calculators/costCalculator';
import { generateNodeAdvisory, formatAdvisoryText } from '../analyzers/nodeAdvisor';
import { getAvailableNodeTypes, getRegionInfo } from '../models/regionAvailability';

/**
 * State provider for data access from the extension.
 */
export interface StateProvider {
    getVMs: () => VMInventoryItem[];
    getSummary: () => InventorySummary | undefined;
    getSizing: () => SizingResult | undefined;
    getCosts: () => CostEstimate[];
    getWavePlan: () => MigrationWavePlan | undefined;
}

/**
 * Register language model tools that other extensions and chat participants can invoke.
 * These tools expose AVS Migration Planner's core capabilities via the VS Code LM Tool API.
 */
export function registerLanguageModelTools(
    context: vscode.ExtensionContext,
    state: StateProvider
): void {
    // Tool 1: Get AVS sizing summary
    context.subscriptions.push(
        vscode.lm.registerTool('avsMigrationPlanner_getSizing', {
            async invoke(_options: vscode.LanguageModelToolInvocationOptions<unknown>, _token: vscode.CancellationToken) {
                const sizing = state.getSizing();
                if (!sizing) {
                    return new vscode.LanguageModelToolResult([
                        new vscode.LanguageModelTextPart('No VM inventory imported. Run "AVS: Import VM Inventory" first.')
                    ]);
                }

                const summary = state.getSummary()!;
                const lines: string[] = [];
                lines.push(`**Workload:** ${summary.totalVMs} VMs, ${summary.totalvCPUs} vCPUs, ${Math.round(summary.totalMemoryGB)} GB RAM, ${Math.round(summary.totalStorageGB)} GB storage`);
                lines.push(`**Required (with buffer):** ${sizing.requiredVCPUs} vCPUs, ${sizing.requiredMemoryGB} GB RAM, ${sizing.requiredStorageGB} GB storage`);
                lines.push('');
                lines.push('| Node Type | Nodes | Clusters | CPU% | RAM% | Stor% | Fit | Driving |');
                lines.push('|-----------|-------|----------|------|------|-------|-----|---------|');
                for (const rec of sizing.recommendations) {
                    const star = rec === sizing.bestFit ? ' ★' : '';
                    lines.push(`| ${rec.nodeType.type}${star} | ${rec.nodesRequired} | ${rec.clustersRequired} | ${rec.utilizationCpu}% | ${rec.utilizationMemory}% | ${rec.utilizationStorage}% | ${rec.fitScore} | ${rec.drivingDimension} |`);
                }

                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(lines.join('\n'))
                ]);
            }
        })
    );

    // Tool 2: Get cost comparison
    context.subscriptions.push(
        vscode.lm.registerTool('avsMigrationPlanner_getCosts', {
            async invoke(_options: vscode.LanguageModelToolInvocationOptions<unknown>, _token: vscode.CancellationToken) {
                const costs = state.getCosts();
                if (costs.length === 0) {
                    return new vscode.LanguageModelToolResult([
                        new vscode.LanguageModelTextPart('No cost data available. Import a VM inventory first.')
                    ]);
                }

                const lines: string[] = [];
                lines.push('| Node | Nodes | Monthly PAYG | Monthly 1yr RI | Monthly 3yr RI | 3yr Savings |');
                lines.push('|------|-------|-------------|---------------|---------------|-------------|');
                for (const cost of costs) {
                    lines.push(`| ${cost.nodeType} | ${cost.nodeCount} | $${cost.monthlyPayAsYouGo.toLocaleString()} | $${cost.monthlyRI1Year.toLocaleString()} | $${cost.monthlyRI3Year.toLocaleString()} | ${cost.savingsPercentRI3Year}% |`);
                }

                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(lines.join('\n'))
                ]);
            }
        })
    );

    // Tool 3: Get node selection advisory
    context.subscriptions.push(
        vscode.lm.registerTool('avsMigrationPlanner_getNodeAdvice', {
            async invoke(options: vscode.LanguageModelToolInvocationOptions<unknown>, _token: vscode.CancellationToken) {
                const sizing = state.getSizing();
                if (!sizing) {
                    return new vscode.LanguageModelToolResult([
                        new vscode.LanguageModelTextPart('No sizing data. Import a VM inventory first.')
                    ]);
                }

                const input = options.input as { region?: string } | undefined;
                const region = input?.region || vscode.workspace.getConfiguration('avsMigrationPlanner').get<string>('pricing.region', 'eastus');

                const advisory = generateNodeAdvisory(sizing.recommendations, region);
                const text = formatAdvisoryText(advisory);

                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(text)
                ]);
            }
        })
    );

    // Tool 4: Get wave plan summary
    context.subscriptions.push(
        vscode.lm.registerTool('avsMigrationPlanner_getWavePlan', {
            async invoke(_options: vscode.LanguageModelToolInvocationOptions<unknown>, _token: vscode.CancellationToken) {
                const wavePlan = state.getWavePlan();
                if (!wavePlan) {
                    return new vscode.LanguageModelToolResult([
                        new vscode.LanguageModelTextPart('No wave plan available. Import a VM inventory first.')
                    ]);
                }

                const lines: string[] = [];
                lines.push(`**Migration Plan:** ${wavePlan.totalWaves} waves, ${wavePlan.totalVMs} VMs, ~${wavePlan.estimatedTotalDays} days`);
                lines.push(`**Network Extensions:** ${wavePlan.networkExtensions.length}`);
                lines.push('');
                for (const wave of wavePlan.waves) {
                    lines.push(`**Wave ${wave.waveNumber}** [${wave.riskLevel.toUpperCase()}] — Day ${wave.startDayOffset}, ~${wave.estimatedDurationHours}h, ${wave.vms.length} VMs, ${wave.totalVCPUs} vCPUs, ${Math.round(wave.totalStorageGB)} GB`);
                }

                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(lines.join('\n'))
                ]);
            }
        })
    );

    // Tool 5: Check regional node availability
    context.subscriptions.push(
        vscode.lm.registerTool('avsMigrationPlanner_checkRegion', {
            async invoke(options: vscode.LanguageModelToolInvocationOptions<unknown>, _token: vscode.CancellationToken) {
                const input = options.input as { region?: string } | undefined;
                const region = input?.region || 'eastus';

                const info = getRegionInfo(region);
                const available = getAvailableNodeTypes(region);

                const lines: string[] = [];
                if (info) {
                    lines.push(`**Region:** ${info.region}`);
                    lines.push(`**Stretched Clusters:** ${info.supportsStretchedCluster ? 'Yes (99.99% SLA)' : 'No'}`);
                    lines.push(`**Gen 2 Support:** ${info.supportsGen2 ? 'Yes (AV48, AV64)' : 'No'}`);
                    lines.push(`**Available Node Types:** ${available.join(', ')}`);
                } else {
                    lines.push(`Region "${region}" not found in AVS availability matrix.`);
                    lines.push(`Available Gen 1 nodes (default): ${available.join(', ')}`);
                }

                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(lines.join('\n'))
                ]);
            }
        })
    );
}
