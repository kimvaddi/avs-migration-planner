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
import { VMInventoryItem } from './models/vm';
import { InventorySummary } from './models/vm';
import { SizingResult } from './models/avsNode';
import { CostEstimate, MigrationWavePlan, HCXConfiguration } from './models/migrationPlan';
import { DashboardProvider } from './views/dashboardProvider';
import { VMInventoryTreeProvider, RecommendationsTreeProvider } from './views/treeProviders';

// Extension state
let currentVMs: VMInventoryItem[] = [];
let currentSummary: InventorySummary | undefined;
let currentSizing: SizingResult | undefined;
let currentCosts: CostEstimate[] = [];
let currentWavePlan: MigrationWavePlan | undefined;
let currentHCXConfig: HCXConfiguration | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('AVS Migration Planner is now active');

    // Tree providers
    const vmTreeProvider = new VMInventoryTreeProvider();
    const recTreeProvider = new RecommendationsTreeProvider();
    const dashboardProvider = new DashboardProvider(context.extensionUri);

    vscode.window.registerTreeDataProvider('avsMigrationPlanner.vmInventory', vmTreeProvider);
    vscode.window.registerTreeDataProvider('avsMigrationPlanner.recommendations', recTreeProvider);

    // --- Import VM Inventory command ---
    const importCmd = vscode.commands.registerCommand('avsMigrationPlanner.importInventory', async () => {
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
        currentSizing = generateSizingRecommendations(
            requirements.requiredVCPUs,
            requirements.requiredMemoryGB,
            requirements.requiredStorageGB
        );
        currentCosts = calculateAllCosts(currentSizing.recommendations);
        currentWavePlan = generateWavePlan(currentVMs);
        currentHCXConfig = generateHCXConfiguration(currentWavePlan.waves);

        // Update tree views
        vmTreeProvider.setVMs(currentVMs);
        updateRecommendationsTree(recTreeProvider);

        vscode.window.showInformationMessage(
            `Imported ${parseResult.vms.length} VMs (${parseResult.format} format). ` +
            `Best fit: ${currentSizing.bestFit.nodeType.displayName} × ${currentSizing.bestFit.nodesRequired} nodes.`
        );
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

        const params: BicepTemplateParams = {
            location,
            privateCloudName: cloudName,
            resourceGroupName: 'rg-avs-migration',
            managementCIDR: cidr,
            recommendation: currentSizing.bestFit,
            networkExtensions: currentWavePlan.networkExtensions,
            onPremExpressRouteId: onPremErId
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

    context.subscriptions.push(importCmd, dashboardCmd, bicepCmd, hcxCmd, waveCmd, exportCmd);
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

export function deactivate() {}
