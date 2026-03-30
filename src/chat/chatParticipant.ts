import * as vscode from 'vscode';
import { VMInventoryItem, InventorySummary } from '../models/vm';
import { SizingResult } from '../models/avsNode';
import { CostEstimate, MigrationWavePlan, HCXConfiguration } from '../models/migrationPlan';
import { generateCostSummary, formatCurrency } from '../calculators/costCalculator';
import { exportWavePlanText } from '../generators/wavePlanner';
import { exportHCXConfigText } from '../generators/hcxGenerator';

/**
 * State provider interface — the extension passes its current state to the chat participant.
 */
export interface MigrationStateProvider {
    getVMs(): VMInventoryItem[];
    getSummary(): InventorySummary | undefined;
    getSizing(): SizingResult | undefined;
    getCosts(): CostEstimate[];
    getWavePlan(): MigrationWavePlan | undefined;
    getHCXConfig(): HCXConfiguration | undefined;
}

const PARTICIPANT_ID = 'avsMigrationPlanner.chat';

/**
 * Register the @avs chat participant with Copilot Chat.
 */
export function registerChatParticipant(
    context: vscode.ExtensionContext,
    stateProvider: MigrationStateProvider
): void {
    const handler: vscode.ChatRequestHandler = async (
        request: vscode.ChatRequest,
        chatContext: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<vscode.ChatResult> => {
        const vms = stateProvider.getVMs();
        const summary = stateProvider.getSummary();
        const sizing = stateProvider.getSizing();
        const costs = stateProvider.getCosts();
        const wavePlan = stateProvider.getWavePlan();

        // Check if data is loaded
        if (vms.length === 0 || !summary) {
            stream.markdown('**No VM inventory loaded.** Please run `AVS: Import VM Inventory` first, then ask me questions about your migration plan.');
            return { metadata: { command: 'no-data' } };
        }

        // Build context string with current migration data
        const migrationContext = buildMigrationContext(vms, summary, sizing, costs, wavePlan);

        // Route to the appropriate command handler
        const command = request.command;

        let systemPrompt: string;

        switch (command) {
            case 'analyze':
                systemPrompt = getAnalyzePrompt(migrationContext);
                break;
            case 'recommend':
                systemPrompt = getRecommendPrompt(migrationContext);
                break;
            case 'risk':
                systemPrompt = getRiskPrompt(migrationContext);
                break;
            case 'optimize':
                systemPrompt = getOptimizePrompt(migrationContext);
                break;
            case 'explain':
                systemPrompt = getExplainPrompt(migrationContext);
                break;
            default:
                // Freeform question
                systemPrompt = getFreeformPrompt(migrationContext);
                break;
        }

        try {
            // Select a language model
            const models = await vscode.lm.selectChatModels({
                vendor: 'copilot',
                family: 'gpt-4o'
            });

            if (models.length === 0) {
                stream.markdown('**GitHub Copilot model not available.** Ensure you have an active GitHub Copilot subscription.');
                return { metadata: { command: command || 'error' } };
            }

            const model = models[0];

            const messages = [
                vscode.LanguageModelChatMessage.User(systemPrompt),
                vscode.LanguageModelChatMessage.User(
                    request.prompt || 'Please provide the analysis based on the migration data above.'
                )
            ];

            const response = await model.sendRequest(messages, {}, token);

            for await (const fragment of response.text) {
                stream.markdown(fragment);
            }
        } catch (err) {
            if (err instanceof vscode.LanguageModelError) {
                stream.markdown(`**AI model error:** ${err.message}`);
            } else {
                throw err;
            }
        }

        return { metadata: { command: command || 'freeform' } };
    };

    const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, handler);
    participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.png');
    context.subscriptions.push(participant);
}

/**
 * Build a concise context string from the current migration state.
 */
function buildMigrationContext(
    vms: VMInventoryItem[],
    summary: InventorySummary,
    sizing: SizingResult | undefined,
    costs: CostEstimate[],
    wavePlan: MigrationWavePlan | undefined
): string {
    const lines: string[] = [];

    lines.push('=== CURRENT AVS MIGRATION DATA ===');
    lines.push('');
    lines.push('INVENTORY SUMMARY:');
    lines.push(`- Total VMs: ${summary.totalVMs} (${summary.poweredOnVMs} powered on, ${summary.poweredOffVMs} powered off)`);
    lines.push(`- Total vCPUs: ${summary.totalvCPUs}`);
    lines.push(`- Total Memory: ${Math.round(summary.totalMemoryGB)} GB`);
    lines.push(`- Total Storage: ${Math.round(summary.totalStorageGB)} GB (${(summary.totalStorageGB / 1024).toFixed(1)} TB)`);
    lines.push(`- Networks: ${summary.uniqueNetworks.join(', ')}`);
    lines.push(`- Datacenters: ${summary.uniqueDatacenters.join(', ')}`);
    lines.push(`- OS Distribution: ${Object.entries(summary.osSummary).map(([os, count]) => `${os}: ${count}`).join(', ')}`);

    if (sizing) {
        lines.push('');
        lines.push('NODE SIZING RECOMMENDATIONS:');
        for (const rec of sizing.recommendations) {
            const marker = rec === sizing.bestFit ? ' [BEST FIT]' : '';
            lines.push(`- ${rec.nodeType.displayName}${marker}: ${rec.nodesRequired} nodes, ${rec.clustersRequired} cluster(s), CPU ${rec.utilizationCpu}%, RAM ${rec.utilizationMemory}%, Storage ${rec.utilizationStorage}%, Fit Score ${rec.fitScore}/100`);
        }
    }

    if (costs.length > 0) {
        lines.push('');
        lines.push('COST ESTIMATES:');
        for (const c of costs) {
            lines.push(`- ${c.nodeType}: ${c.nodeCount} nodes | PAYG ${formatCurrency(c.monthlyPayAsYouGo)}/mo | 1yr RI ${formatCurrency(c.monthlyRI1Year)}/mo (${c.savingsPercentRI1Year}% off) | 3yr RI ${formatCurrency(c.monthlyRI3Year)}/mo (${c.savingsPercentRI3Year}% off)`);
        }
    }

    if (wavePlan) {
        lines.push('');
        lines.push('MIGRATION WAVE PLAN:');
        lines.push(`- Total Waves: ${wavePlan.totalWaves}`);
        lines.push(`- Estimated Duration: ${wavePlan.estimatedTotalDays} days`);
        lines.push(`- Network Extensions: ${wavePlan.networkExtensions.length}`);
        for (const wave of wavePlan.waves) {
            const vmNames = wave.vms.map(v => v.name).slice(0, 10).join(', ');
            const more = wave.vms.length > 10 ? ` +${wave.vms.length - 10} more` : '';
            lines.push(`  Wave ${wave.waveNumber} [${wave.riskLevel.toUpperCase()}]: ${wave.vms.length} VMs, ${wave.totalVCPUs} vCPUs, ${Math.round(wave.totalStorageGB)} GB, Day ${wave.startDayOffset}, ~${wave.estimatedDurationHours}h | ${vmNames}${more}`);
        }
    }

    // Include top 30 VMs for detail (avoid token budget overflow)
    lines.push('');
    lines.push('VM DETAILS (first 30):');
    for (const vm of vms.slice(0, 30)) {
        lines.push(`- ${vm.name}: ${vm.vCPUs} vCPU, ${vm.memoryGB} GB RAM, ${vm.storageGB} GB disk, ${vm.os}, ${vm.powerState}, networks=[${vm.networks.join(',')}], group=${vm.dependencyGroup || 'none'}`);
    }
    if (vms.length > 30) {
        lines.push(`  ... and ${vms.length - 30} more VMs`);
    }

    return lines.join('\n');
}

// --- System prompts for each command ---

function getAnalyzePrompt(context: string): string {
    return `You are an Azure VMware Solution (AVS) migration architect. The user has imported a VM inventory and the extension has generated sizing, cost, and wave plan data.

Analyze the migration data below and provide:
1. **Executive Summary** — Key findings in 3-4 sentences
2. **Workload Characterization** — What types of workloads are these? (DB-heavy, web-heavy, mixed)
3. **Sizing Assessment** — Is the recommended node type appropriate? Any concerns?
4. **Migration Complexity** — Rate Low/Medium/High with justification
5. **Key Risks** — Top 3 risks specific to this inventory
6. **Recommendations** — Actionable next steps

Be specific to the actual data — reference VM names, counts, and numbers. Do not be generic.

${context}`;
}

function getRecommendPrompt(context: string): string {
    return `You are an Azure VMware Solution architect. Based on the migration data below, provide architecture recommendations:

1. **Recommended AVS SKU** — Which node type and why (consider the workload mix, not just fit score)
2. **Cluster Topology** — How many clusters, what separation (management vs workload)?
3. **Storage Strategy** — Is vSAN sufficient or should Azure NetApp Files / Elastic SAN be considered for storage-heavy VMs?
4. **Networking** — ExpressRoute sizing (1 Gbps vs 10 Gbps), Global Reach considerations, NSX-T segment design
5. **HCX Strategy** — Recommended migration types per workload tier (Bulk vs RAV vs vMotion)
6. **AV64 Extension** — Should Gen 2 AV64 nodes be considered for expansion? (Note: AV64 requires existing AV36/AV36P/AV52 private cloud)

Reference the specific VMs and workload patterns from the data.

${context}`;
}

function getRiskPrompt(context: string): string {
    return `You are an AVS migration risk analyst. Assess the risks for the migration plan below:

For each migration wave, evaluate:
1. **Wave Risk Level** — Confirm or adjust the risk rating with justification
2. **High-Risk VMs** — Identify specific VMs that need special attention (large storage, critical databases, complex networking)
3. **Network Risks** — Multi-NIC VMs, L2 extension dependencies, IP conflicts
4. **Dependency Risks** — Are any application tiers split across waves incorrectly?
5. **Capacity Risks** — Could any wave overwhelm HCX or ExpressRoute bandwidth?
6. **Rollback Plan** — For each high-risk wave, what's the rollback strategy?

Present as a risk register table with Likelihood, Impact, and Mitigation for each risk.

${context}`;
}

function getOptimizePrompt(context: string): string {
    return `You are an Azure cost optimization specialist for AVS migrations. Analyze the cost data and suggest optimizations:

1. **RI vs PAYG** — Calculate the break-even point for 1yr and 3yr Reserved Instances
2. **Right-Sizing** — Are there VMs that could be consolidated or downsized before migration?
3. **Powered-Off VMs** — Identify candidates for decommission (don't migrate dead weight)
4. **Node Type Optimization** — Could a different mix of node types reduce cost while maintaining performance?
5. **Storage Optimization** — Any VMs with disproportionate storage that could use external datastores (Azure NetApp Files)?
6. **Phased Approach** — Could starting with fewer nodes and scaling up save money during migration?

Include specific dollar amounts and percentage savings where possible.

${context}`;
}

function getExplainPrompt(context: string): string {
    return `You are a helpful AVS migration advisor. The user will ask you to explain part of their migration plan. Use the data below to give clear, specific answers. If the user's question is vague, explain the overall plan. Use plain language suitable for a project manager or business stakeholder who may not be deeply technical.

${context}`;
}

function getFreeformPrompt(context: string): string {
    return `You are an Azure VMware Solution (AVS) migration expert assistant. You have access to the user's current VM inventory, sizing recommendations, cost estimates, and migration wave plan (shown below). Answer their questions using this specific data.

Key AVS facts:
- AVS clusters: min 3 nodes, max 16 per cluster, max 12 clusters per private cloud
- Node types: AV36 (Gen1), AV36P (Gen1), AV52 (Gen1), AV48 (Gen2 ESA), AV64 (Gen2, extension only)
- AV64 requires existing AV36/AV36P/AV52 private cloud — cannot be initial deployment
- MGMT-ResourcePool reserves 46 GHz CPU + 171.88 GB memory on first cluster
- n+1 HA: one node held in reserve for failure protection
- HCX migration types: Bulk (parallel), vMotion (serial/zero-downtime), RAV (parallel+zero-downtime), Cold
- HCX concurrency: up to 300 bulk/RAV per manager, 1 vMotion per service mesh
- Network extension: 4-6+ Gbps per NE appliance, up to 600 extensions per manager
- All nodes have 100 Gbps network interfaces

If the user asks about something not in the data, say so clearly rather than guessing.

${context}`;
}
