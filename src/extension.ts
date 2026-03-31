import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { parseVMInventory } from './parsers/csvParser';
import { analyzeInventory, calculateRequirements } from './analyzers/vmAnalyzer';
import { generateSizingRecommendations } from './analyzers/clusterSizer';
import { calculateAllCosts, generateCostSummary } from './calculators/costCalculator';
import { generateHCXConfiguration, exportHCXConfigJSON, exportHCXConfigText } from './generators/hcxGenerator';
import { generateBicepTemplate, generateBicepParameters, BicepTemplateParams } from './generators/bicepGenerator';
import { generateWavePlan, exportWavePlanText, exportWavePlanCSV } from './generators/wavePlanner';
import { generateExcelReport, ExcelReportParams } from './generators/excelGenerator';
import { VMInventoryItem } from './models/vm';
import { InventorySummary } from './models/vm';
import { SizingResult } from './models/avsNode';
import { CostEstimate, MigrationWavePlan, HCXConfiguration } from './models/migrationPlan';
import { DashboardProvider } from './views/dashboardProvider';
import { VMInventoryTreeProvider, RecommendationsTreeProvider } from './views/treeProviders';
import { fetchAVSPricing, AVSLivePricing } from './pricing/azurePricingClient';
import { updateNodePricing } from './models/avsNode';
import { registerChatParticipant } from './chat/chatParticipant';

// Extension state
let currentPricing: AVSLivePricing | undefined;
let currentVMs: VMInventoryItem[] = [];
let currentSummary: InventorySummary | undefined;
let currentSizing: SizingResult | undefined;
let currentCosts: CostEstimate[] = [];
let currentWavePlan: MigrationWavePlan | undefined;
let currentHCXConfig: HCXConfiguration | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('AVS Migration Planner is now active');

    // Restore state from previous session
    restoreState(context);

    // Tree providers
    const vmTreeProvider = new VMInventoryTreeProvider();
    const recTreeProvider = new RecommendationsTreeProvider();
    const dashboardProvider = new DashboardProvider(context.extensionUri);

    // Populate tree views if state was restored
    if (currentVMs.length > 0) {
        vmTreeProvider.setVMs(currentVMs);
        if (currentSizing && currentCosts && currentWavePlan) {
            updateRecommendationsTree(recTreeProvider);
        }
    }

    // Register @avs chat participant for AI-assisted mode
    registerChatParticipant(context, {
        getVMs: () => currentVMs,
        getSummary: () => currentSummary,
        getSizing: () => currentSizing,
        getCosts: () => currentCosts,
        getWavePlan: () => currentWavePlan,
        getHCXConfig: () => currentHCXConfig
    });

    vscode.window.registerTreeDataProvider('avsMigrationPlanner.vmInventory', vmTreeProvider);
    vscode.window.registerTreeDataProvider('avsMigrationPlanner.recommendations', recTreeProvider);

    // --- Import VM Inventory command ---
    const importCmd = vscode.commands.registerCommand('avsMigrationPlanner.importInventory', async () => {
        try {
            const fileUris = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectMany: false,
                filters: { 'CSV Files': ['csv'], 'All Files': ['*'] },
                title: 'Select VM Inventory CSV (RVTools or Standard format)'
            });

            if (!fileUris || fileUris.length === 0) {return;}

            const filePath = fileUris[0].fsPath;
            let csvContent: string;
            try {
                csvContent = fs.readFileSync(filePath, 'utf-8');
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to read file: ${(err as Error).message}`);
                return;
            }

            const parseResult = parseVMInventory(csvContent);

            if (!parseResult.success) {
                vscode.window.showErrorMessage(`CSV parsing failed:\n${parseResult.errors.join('\n')}`);
                return;
            }

            if (parseResult.warnings.length > 0) {
                const warnCount = parseResult.warnings.length;
                vscode.window.showWarningMessage(
                    `Imported with ${warnCount} warning(s). Check Output for details.`
                );
                const outputChannel = vscode.window.createOutputChannel('AVS Migration Planner');
                outputChannel.appendLine('=== Import Warnings ===');
                parseResult.warnings.forEach(w => outputChannel.appendLine(w));
                outputChannel.show(true);
            }

            currentVMs = parseResult.vms;
            currentSummary = analyzeInventory(currentVMs);
            const requirements = calculateRequirements(currentSummary);

            // Fetch live pricing from Azure Retail Prices API
            const config = vscode.workspace.getConfiguration('avsMigrationPlanner');
            const pricingRegion = config.get<string>('pricing.region', 'eastus');
            let pricingSource = 'fallback estimates';
            try {
                await vscode.window.withProgress(
                    { location: vscode.ProgressLocation.Notification, title: 'Fetching live AVS pricing...' },
                    async () => {
                        currentPricing = await fetchAVSPricing(pricingRegion);
                        if (currentPricing.source === 'live-api') {
                            updateNodePricing(currentPricing.nodes);
                            pricingSource = `live API (${currentPricing.region})`;
                        }
                    }
                );
            } catch {
                pricingSource = 'fallback estimates (API unavailable)';
            }

            currentSizing = generateSizingRecommendations(
                requirements.requiredVCPUs,
                requirements.requiredMemoryGB,
                requirements.requiredStorageGB
            );
            currentCosts = calculateAllCosts(currentSizing.recommendations);

            // Read wave planner settings from VS Code configuration
            currentWavePlan = generateWavePlan(currentVMs, {
                maxVMsPerWave: config.get<number>('wave.maxVMsPerWave', 25),
                maxVCPUsPerWave: config.get<number>('wave.maxVCPUsPerWave', 200),
                maxStoragePerWaveGB: config.get<number>('wave.maxStoragePerWaveGB', 5000),
                daysBetweenWaves: config.get<number>('wave.daysBetweenWaves', 3),
                waveThroughputGBPerHour: config.get<number>('wave.throughputGBPerHour', 100)
            });
            currentHCXConfig = generateHCXConfiguration(currentWavePlan.waves);

            // Update tree views
            vmTreeProvider.setVMs(currentVMs);
            updateRecommendationsTree(recTreeProvider);

            vscode.window.showInformationMessage(
                `Imported ${parseResult.vms.length} VMs (${parseResult.format} format). ` +
                `Best fit: ${currentSizing.bestFit.nodeType.displayName} × ${currentSizing.bestFit.nodesRequired} nodes. ` +
                `Pricing: ${pricingSource}.`
            );

            // Persist state for session restoration
            saveState(context);
        } catch (err) {
            vscode.window.showErrorMessage(`AVS Migration Planner error: ${(err as Error).message}`);
            console.error('AVS Migration Planner import error:', err);
        }
    });

    // --- Show Dashboard command ---
    const dashboardCmd = vscode.commands.registerCommand('avsMigrationPlanner.showDashboard', () => {
        if (!currentSummary || !currentSizing || !currentWavePlan) {
            vscode.window.showWarningMessage('Import a VM inventory first (AVS: Import VM Inventory).');
            return;
        }
        dashboardProvider.openDashboardPanel(currentVMs, currentSummary, currentSizing, currentCosts, currentWavePlan);
    });

    // --- Generate Bicep command ---
    const bicepCmd = vscode.commands.registerCommand('avsMigrationPlanner.generateBicep', async () => {
        if (!currentSizing || !currentWavePlan) {
            vscode.window.showWarningMessage('Import a VM inventory first.');
            return;
        }

        const location = await vscode.window.showInputBox({
            prompt: 'Azure region for the AVS Private Cloud',
            value: 'eastus',
            placeHolder: 'e.g., eastus, westus2, westeurope'
        });
        if (!location) {return;}

        const cloudName = await vscode.window.showInputBox({
            prompt: 'Name for the AVS Private Cloud',
            value: 'avs-private-cloud',
            placeHolder: 'e.g., avs-private-cloud'
        });
        if (!cloudName) {return;}

        const cidr = await vscode.window.showInputBox({
            prompt: 'Management network CIDR block (/22 required)',
            value: '10.0.0.0/22',
            placeHolder: 'e.g., 10.0.0.0/22'
        });
        if (!cidr) {return;}

        const addGlobalReach = await vscode.window.showQuickPick(['No', 'Yes'], {
            placeHolder: 'Add ExpressRoute Global Reach peering?'
        });

        let onPremErId: string | undefined;
        if (addGlobalReach === 'Yes') {
            onPremErId = await vscode.window.showInputBox({
                prompt: 'On-premises ExpressRoute circuit resource ID',
                placeHolder: '/subscriptions/{sub-id}/resourceGroups/{rg}/providers/Microsoft.Network/expressRouteCircuits/{name}'
            });
        }

        const enableInternet = await vscode.window.showQuickPick(['Disabled', 'Enabled'], {
            placeHolder: 'Enable internet access on AVS private cloud?'
        });

        const nsxtCidr = await vscode.window.showInputBox({
            prompt: 'Base CIDR for NSX-T workload segments (/24 subnets auto-generated)',
            value: '10.100.0.0/16',
            placeHolder: 'e.g., 10.100.0.0/16 or 172.16.0.0/16'
        });

        const params: BicepTemplateParams = {
            location,
            privateCloudName: cloudName,
            resourceGroupName: 'rg-avs-migration',
            managementCIDR: cidr,
            recommendation: currentSizing.bestFit,
            networkExtensions: currentWavePlan.networkExtensions,
            onPremExpressRouteId: onPremErId,
            nsxtBaseCIDR: nsxtCidr || '10.100.0.0/16',
            internetEnabled: enableInternet === 'Enabled'
        };

        const bicepContent = generateBicepTemplate(params);
        const paramsContent = generateBicepParameters(params);

        // Create files
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
            const outputDir = path.join(workspaceFolders[0].uri.fsPath, 'avs-bicep');
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }
            const mainPath = path.join(outputDir, 'main.bicep');
            const paramsPath = path.join(outputDir, 'main.parameters.json');
            fs.writeFileSync(mainPath, bicepContent, 'utf-8');
            fs.writeFileSync(paramsPath, paramsContent, 'utf-8');

            const doc = await vscode.workspace.openTextDocument(mainPath);
            await vscode.window.showTextDocument(doc);
            vscode.window.showInformationMessage(`Bicep templates generated in avs-bicep/ folder.`);
        } else {
            // No workspace - open as untitled
            const doc = await vscode.workspace.openTextDocument({ content: bicepContent, language: 'bicep' });
            await vscode.window.showTextDocument(doc);
        }
    });

    // --- Generate HCX Config command ---
    const hcxCmd = vscode.commands.registerCommand('avsMigrationPlanner.generateHcxConfig', async () => {
        if (!currentHCXConfig) {
            vscode.window.showWarningMessage('Import a VM inventory first.');
            return;
        }

        const format = await vscode.window.showQuickPick(['JSON (.json)', 'Text Report (.txt)'], {
            placeHolder: 'Output format for HCX configuration'
        });
        if (!format) {return;}

        const isJson = format.startsWith('JSON');
        const content = isJson
            ? exportHCXConfigJSON(currentHCXConfig)
            : exportHCXConfigText(currentHCXConfig);

        const defaultName = isJson ? 'hcx-configuration.json' : 'hcx-configuration.txt';
        const filterLabel = isJson ? 'JSON' : 'Text';
        const filterExt = isJson ? ['json'] : ['txt'];

        const saveUri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(path.join(getOutputFolder(), defaultName)),
            filters: { [filterLabel]: filterExt, 'All Files': ['*'] },
            title: 'Save HCX Configuration'
        });

        if (saveUri) {
            fs.writeFileSync(saveUri.fsPath, content, 'utf-8');
            const doc = await vscode.workspace.openTextDocument(saveUri);
            await vscode.window.showTextDocument(doc);
            vscode.window.showInformationMessage(`HCX configuration saved to ${path.basename(saveUri.fsPath)}`);
        }
    });

    // --- Generate Wave Plan command ---
    const waveCmd = vscode.commands.registerCommand('avsMigrationPlanner.generateWavePlan', async () => {
        if (!currentWavePlan) {
            vscode.window.showWarningMessage('Import a VM inventory first.');
            return;
        }

        const format = await vscode.window.showQuickPick(
            ['CSV for Excel/Sheets (.csv)', 'Text Report (.txt)'],
            { placeHolder: 'Output format for migration wave plan' }
        );
        if (!format) {return;}

        const isCsv = format.startsWith('CSV');
        const content = isCsv
            ? exportWavePlanCSV(currentWavePlan)
            : exportWavePlanText(currentWavePlan);

        const defaultName = isCsv ? 'migration-wave-plan.csv' : 'migration-wave-plan.txt';
        const filterLabel = isCsv ? 'CSV' : 'Text';
        const filterExt = isCsv ? ['csv'] : ['txt'];

        const saveUri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(path.join(getOutputFolder(), defaultName)),
            filters: { [filterLabel]: filterExt, 'All Files': ['*'] },
            title: 'Save Migration Wave Plan'
        });

        if (saveUri) {
            fs.writeFileSync(saveUri.fsPath, content, 'utf-8');
            const doc = await vscode.workspace.openTextDocument(saveUri);
            await vscode.window.showTextDocument(doc);
            vscode.window.showInformationMessage(`Wave plan saved to ${path.basename(saveUri.fsPath)}`);
        }
    });

    // --- Export Full Report command ---
    const exportCmd = vscode.commands.registerCommand('avsMigrationPlanner.exportReport', async () => {
        if (!currentSummary || !currentSizing || !currentWavePlan || !currentHCXConfig) {
            vscode.window.showWarningMessage('Import a VM inventory first.');
            return;
        }

        const lines: string[] = [];
        lines.push('='.repeat(60));
        lines.push('AVS MIGRATION PLANNER - FULL REPORT');
        lines.push('Generated: ' + new Date().toLocaleString());
        lines.push('='.repeat(60));
        lines.push('');

        // Inventory summary
        lines.push('');
        lines.push('--- INVENTORY SUMMARY ---');
        lines.push(`Total VMs: ${currentSummary.totalVMs}`);
        lines.push(`Powered On: ${currentSummary.poweredOnVMs}`);
        lines.push(`Powered Off: ${currentSummary.poweredOffVMs}`);
        lines.push(`Total vCPUs: ${currentSummary.totalvCPUs}`);
        lines.push(`Total Memory: ${Math.round(currentSummary.totalMemoryGB)} GB`);
        lines.push(`Total Storage: ${Math.round(currentSummary.totalStorageGB)} GB`);
        lines.push(`Networks: ${currentSummary.uniqueNetworks.join(', ')}`);
        lines.push(`Datacenters: ${currentSummary.uniqueDatacenters.join(', ')}`);
        lines.push('');

        // Sizing
        lines.push('');
        lines.push('--- NODE RECOMMENDATIONS ---');
        for (const rec of currentSizing.recommendations) {
            const marker = rec === currentSizing.bestFit ? ' ★ BEST FIT' : '';
            lines.push(`${rec.nodeType.displayName}${marker}`);
            lines.push(`  Nodes: ${rec.nodesRequired} (${rec.clustersRequired} cluster(s))`);
            lines.push(`  CPU: ${rec.utilizationCpu}% | RAM: ${rec.utilizationMemory}% | Storage: ${rec.utilizationStorage}%`);
            lines.push(`  Fit Score: ${rec.fitScore}/100`);
        }
        lines.push('');

        // Costs
        lines.push('');
        lines.push(generateCostSummary(currentCosts));

        // Wave plan
        lines.push('');
        lines.push(exportWavePlanText(currentWavePlan));

        // HCX config
        lines.push('');
        lines.push(exportHCXConfigText(currentHCXConfig));

        const content = lines.join('\n');

        const saveUri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(path.join(getOutputFolder(), 'avs-migration-report.md')),
            filters: {
                'Markdown': ['md'],
                'Text': ['txt'],
                'All Files': ['*']
            },
            title: 'Save Full Migration Report'
        });

        if (saveUri) {
            fs.writeFileSync(saveUri.fsPath, content, 'utf-8');
            const doc = await vscode.workspace.openTextDocument(saveUri);
            await vscode.window.showTextDocument(doc);
            vscode.window.showInformationMessage(`Migration report saved to ${path.basename(saveUri.fsPath)}`);
        }
    });

    // --- Export Excel Report command ---
    const excelCmd = vscode.commands.registerCommand('avsMigrationPlanner.exportExcel', async () => {
        if (!currentSummary || !currentSizing || !currentWavePlan || !currentHCXConfig) {
            vscode.window.showWarningMessage('Import a VM inventory first.');
            return;
        }

        const config = vscode.workspace.getConfiguration('avsMigrationPlanner');
        const region = config.get<string>('pricing.region', 'eastus');

        const saveUri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(path.join(getOutputFolder(), 'AVS_Migration_Report.xlsx')),
            filters: { 'Excel Workbook': ['xlsx'], 'All Files': ['*'] },
            title: 'Save AVS Migration Report (Excel)'
        });

        if (!saveUri) { return; }

        try {
            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'Generating Excel report...' },
                async () => {
                    const excelParams: ExcelReportParams = {
                        vms: currentVMs,
                        summary: currentSummary!,
                        sizing: currentSizing!,
                        costs: currentCosts,
                        wavePlan: currentWavePlan!,
                        region
                    };
                    const buffer = await generateExcelReport(excelParams);
                    fs.writeFileSync(saveUri.fsPath, buffer);
                }
            );
            vscode.window.showInformationMessage(
                `Excel report saved to ${path.basename(saveUri.fsPath)} (6 sheets).`,
                'Open File'
            ).then(choice => {
                if (choice === 'Open File') {
                    vscode.env.openExternal(vscode.Uri.file(saveUri.fsPath));
                }
            });
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to generate Excel report: ${(err as Error).message}`);
        }
    });

    context.subscriptions.push(importCmd, dashboardCmd, bicepCmd, hcxCmd, waveCmd, exportCmd, excelCmd);
}

function updateRecommendationsTree(provider: RecommendationsTreeProvider): void {
    if (!currentSizing || !currentCosts || !currentWavePlan) {return;}

    const items: vscode.TreeItem[] = [];

    const bestFit = currentSizing.bestFit;
    const header = new vscode.TreeItem(`Best Fit: ${bestFit.nodeType.displayName}`);
    header.iconPath = new vscode.ThemeIcon('star-full');
    header.description = `${bestFit.nodesRequired} nodes, ${bestFit.clustersRequired} cluster(s)`;
    items.push(header);

    const cpu = new vscode.TreeItem(`CPU: ${currentSizing.requiredVCPUs} vCPUs needed`);
    cpu.iconPath = new vscode.ThemeIcon('pulse');
    cpu.description = `${bestFit.utilizationCpu}% utilized`;
    items.push(cpu);

    const mem = new vscode.TreeItem(`Memory: ${Math.round(currentSizing.requiredMemoryGB)} GB needed`);
    mem.iconPath = new vscode.ThemeIcon('database');
    mem.description = `${bestFit.utilizationMemory}% utilized`;
    items.push(mem);

    const bestCost = currentCosts.find(c => c.nodeType === bestFit.nodeType.type);
    if (bestCost) {
        const cost = new vscode.TreeItem(`Cost: $${bestCost.monthlyRI3Year.toLocaleString()}/mo (3yr RI)`);
        cost.iconPath = new vscode.ThemeIcon('credit-card');
        cost.description = `Save ${bestCost.savingsPercentRI3Year}% vs PAYG`;
        items.push(cost);
    }

    if (currentWavePlan) {
        const waves = new vscode.TreeItem(`Waves: ${currentWavePlan.totalWaves}`);
        waves.iconPath = new vscode.ThemeIcon('list-ordered');
        waves.description = `~${currentWavePlan.estimatedTotalDays} days`;
        items.push(waves);
    }

    provider.setItems(items);
}

/**
 * Get a sensible default output folder for Save As dialogs.
 */
function getOutputFolder(): string {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
        return workspaceFolders[0].uri.fsPath;
    }
    return process.env.USERPROFILE || process.env.HOME || '';
}

/**
 * Save current state to workspace storage for session restoration.
 */
function saveState(context: vscode.ExtensionContext): void {
    try {
        if (currentVMs.length > 0) {
            context.workspaceState.update('avs.vms', currentVMs);
            context.workspaceState.update('avs.summary', currentSummary);
            context.workspaceState.update('avs.sizing', currentSizing);
            context.workspaceState.update('avs.costs', currentCosts);
            context.workspaceState.update('avs.wavePlan', currentWavePlan);
            context.workspaceState.update('avs.hcxConfig', currentHCXConfig);
        }
    } catch {
        // Silently fail — state persistence is best-effort
    }
}

/**
 * Restore state from workspace storage.
 */
function restoreState(context: vscode.ExtensionContext): void {
    try {
        const vms = context.workspaceState.get<VMInventoryItem[]>('avs.vms');
        if (vms && vms.length > 0) {
            currentVMs = vms;
            currentSummary = context.workspaceState.get('avs.summary');
            currentSizing = context.workspaceState.get('avs.sizing');
            currentCosts = context.workspaceState.get('avs.costs') || [];
            currentWavePlan = context.workspaceState.get('avs.wavePlan');
            currentHCXConfig = context.workspaceState.get('avs.hcxConfig');
            console.log(`AVS Migration Planner: Restored ${currentVMs.length} VMs from previous session`);
        }
    } catch {
        // Silently fail — start fresh
    }
}

export function deactivate() {}
