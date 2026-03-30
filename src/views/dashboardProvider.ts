import * as vscode from 'vscode';
import { VMInventoryItem, InventorySummary } from '../models/vm';
import { SizingResult } from '../models/avsNode';
import { CostEstimate } from '../models/migrationPlan';
import { MigrationWavePlan } from '../models/migrationPlan';

export class DashboardProvider implements vscode.WebviewViewProvider {

    public static readonly viewType = 'avsMigrationPlanner.dashboard';

    private _view?: vscode.WebviewView;
    private _panel?: vscode.WebviewPanel;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };
        webviewView.webview.html = this._getEmptyHtml();
    }

    /**
     * Open a full-size dashboard panel.
     */
    public openDashboardPanel(
        vms: VMInventoryItem[],
        summary: InventorySummary,
        sizing: SizingResult,
        costs: CostEstimate[],
        wavePlan: MigrationWavePlan
    ): vscode.WebviewPanel {
        if (this._panel) {
            this._panel.reveal(vscode.ViewColumn.One);
        } else {
            this._panel = vscode.window.createWebviewPanel(
                'avsMigrationDashboard',
                'AVS Migration Dashboard',
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [this._extensionUri]
                }
            );
            this._panel.onDidDispose(() => {
                this._panel = undefined;
            });
        }

        this._panel.webview.html = this._getDashboardHtml(vms, summary, sizing, costs, wavePlan);
        return this._panel;
    }

    private _getEmptyHtml(): string {
        return `<!DOCTYPE html>
<html><body style="padding: 16px; font-family: var(--vscode-font-family); color: var(--vscode-foreground);">
<h3>AVS Migration Planner</h3>
<p>Import a VM inventory CSV to get started.</p>
<p>Use <strong>AVS: Import VM Inventory</strong> from the Command Palette.</p>
</body></html>`;
    }

    private _getDashboardHtml(
        vms: VMInventoryItem[],
        summary: InventorySummary,
        sizing: SizingResult,
        costs: CostEstimate[],
        wavePlan: MigrationWavePlan
    ): string {
        const bestFit = sizing.bestFit;
        const bestCost = costs.find(c => c.nodeType === bestFit.nodeType.type);

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none';">
<title>AVS Migration Dashboard</title>
<style>
    body {
        font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
        color: var(--vscode-foreground, #cccccc);
        background-color: var(--vscode-editor-background, #1e1e1e);
        padding: 20px;
        line-height: 1.6;
    }
    h1 { color: var(--vscode-textLink-foreground, #3794ff); margin-bottom: 4px; }
    h2 { color: var(--vscode-textLink-foreground, #3794ff); border-bottom: 1px solid var(--vscode-widget-border, #454545); padding-bottom: 6px; margin-top: 28px; }
    h3 { margin-top: 16px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin: 16px 0; }
    .card {
        background: var(--vscode-editor-inactiveSelectionBackground, #264f78);
        border: 1px solid var(--vscode-widget-border, #454545);
        border-radius: 6px;
        padding: 16px;
        text-align: center;
    }
    .card .number { font-size: 2em; font-weight: bold; color: var(--vscode-textLink-foreground, #3794ff); }
    .card .label { font-size: 0.9em; opacity: 0.8; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    th, td { border: 1px solid var(--vscode-widget-border, #454545); padding: 8px 12px; text-align: left; }
    th { background: var(--vscode-editor-inactiveSelectionBackground, #264f78); }
    tr:nth-child(even) { background: rgba(255,255,255,0.03); }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.85em; font-weight: bold; }
    .badge-low { background: #1b5e20; color: #a5d6a7; }
    .badge-medium { background: #e65100; color: #ffcc80; }
    .badge-high { background: #b71c1c; color: #ef9a9a; }
    .best-fit { background: rgba(55, 148, 255, 0.15); border: 2px solid var(--vscode-textLink-foreground, #3794ff); }
    .section { margin-bottom: 24px; }
    .note { font-style: italic; opacity: 0.7; font-size: 0.9em; margin-top: 8px; }
    .os-bar { display: flex; gap: 8px; flex-wrap: wrap; margin: 8px 0; }
    .os-item { background: var(--vscode-badge-background, #4d4d4d); color: var(--vscode-badge-foreground, #fff); padding: 4px 10px; border-radius: 4px; font-size: 0.85em; }
</style>
</head>
<body>
<h1>&#9729; AVS Migration Dashboard</h1>
<p>Generated: ${new Date().toLocaleString()}</p>

<h2>&#128202; Inventory Summary</h2>
<div class="grid">
    <div class="card"><div class="number">${summary.totalVMs}</div><div class="label">Total VMs</div></div>
    <div class="card"><div class="number">${summary.poweredOnVMs}</div><div class="label">Powered On</div></div>
    <div class="card"><div class="number">${summary.totalvCPUs}</div><div class="label">Total vCPUs</div></div>
    <div class="card"><div class="number">${formatGB(summary.totalMemoryGB)}</div><div class="label">Total Memory (GB)</div></div>
    <div class="card"><div class="number">${formatTB(summary.totalStorageGB)}</div><div class="label">Total Storage (TB)</div></div>
    <div class="card"><div class="number">${summary.uniqueNetworks.length}</div><div class="label">Networks</div></div>
</div>

<h3>Operating Systems</h3>
<div class="os-bar">
${Object.entries(summary.osSummary).map(([os, count]) => `<span class="os-item">${escapeHtml(os)}: ${count}</span>`).join('\n')}
</div>

<h3>Datacenters &amp; Clusters</h3>
<p>Datacenters: ${summary.uniqueDatacenters.map(d => escapeHtml(d)).join(', ') || 'N/A'}<br>
Clusters: ${summary.uniqueClusters.map(c => escapeHtml(c)).join(', ') || 'N/A'}</p>

<h2>&#128187; AVS Node Recommendations</h2>
<p>Required resources (with buffer): <strong>${sizing.requiredVCPUs} vCPUs</strong>, <strong>${formatGB(sizing.requiredMemoryGB)} GB RAM</strong>, <strong>${formatTB(sizing.requiredStorageGB)} TB Storage</strong></p>

<table>
<tr><th>Node Type</th><th>Nodes</th><th>Clusters</th><th>CPU Util %</th><th>RAM Util %</th><th>Storage Util %</th><th>Fit Score</th></tr>
${sizing.recommendations.map(rec => `<tr class="${rec === bestFit ? 'best-fit' : ''}">
    <td><strong>${rec.nodeType.displayName}</strong>${rec === bestFit ? ' &#11088;' : ''}</td>
    <td>${rec.nodesRequired}</td>
    <td>${rec.clustersRequired} (${rec.nodesPerCluster.join(', ')})</td>
    <td>${rec.utilizationCpu}%</td>
    <td>${rec.utilizationMemory}%</td>
    <td>${rec.utilizationStorage}%</td>
    <td>${rec.fitScore}</td>
</tr>`).join('\n')}
</table>

<h2>&#128176; Cost Comparison</h2>
<table>
<tr><th>Node Type</th><th>Nodes</th><th>Monthly PAYG</th><th>Monthly 1yr RI</th><th>Monthly 3yr RI</th><th>Annual Savings (3yr RI)</th></tr>
${costs.map(c => `<tr${c.nodeType === bestFit.nodeType.type ? ' class="best-fit"' : ''}>
    <td><strong>${c.nodeType}</strong></td>
    <td>${c.nodeCount}</td>
    <td>$${c.monthlyPayAsYouGo.toLocaleString()}</td>
    <td>$${c.monthlyRI1Year.toLocaleString()} (${c.savingsPercentRI1Year}% off)</td>
    <td>$${c.monthlyRI3Year.toLocaleString()} (${c.savingsPercentRI3Year}% off)</td>
    <td>$${c.savingsRI3Year.toLocaleString()}/yr</td>
</tr>`).join('\n')}
</table>
<p class="note">&#9888; Pricing sourced from the <a href="https://prices.azure.com">Azure Retail Prices API</a> where available, with fallback estimates for unavailable SKUs. Always verify final pricing with the <a href="https://azure.microsoft.com/pricing/calculator/">Azure Pricing Calculator</a> before making purchasing decisions. Reserved Instance pricing may not be available from the public API — contact your Microsoft account team for RI quotes.</p>

${bestCost ? `
<h3>Best Fit Cost Summary (${bestFit.nodeType.type})</h3>
<div class="grid">
    <div class="card"><div class="number">$${bestCost.monthlyPayAsYouGo.toLocaleString()}</div><div class="label">Monthly (PAYG)</div></div>
    <div class="card"><div class="number">$${bestCost.monthlyRI3Year.toLocaleString()}</div><div class="label">Monthly (3yr RI)</div></div>
    <div class="card"><div class="number">$${bestCost.savingsRI3Year.toLocaleString()}</div><div class="label">Annual Savings (3yr RI)</div></div>
</div>
` : ''}

<h2>&#128666; Migration Wave Plan</h2>
<div class="grid">
    <div class="card"><div class="number">${wavePlan.totalWaves}</div><div class="label">Migration Waves</div></div>
    <div class="card"><div class="number">${wavePlan.totalVMs}</div><div class="label">VMs to Migrate</div></div>
    <div class="card"><div class="number">${wavePlan.estimatedTotalDays}</div><div class="label">Est. Total Days</div></div>
    <div class="card"><div class="number">${wavePlan.networkExtensions.length}</div><div class="label">Network Extensions</div></div>
</div>

${wavePlan.waves.map(wave => `
<h3>${escapeHtml(wave.name)} <span class="badge badge-${wave.riskLevel}">${wave.riskLevel.toUpperCase()}</span></h3>
<p>Day ${wave.startDayOffset} | ~${wave.estimatedDurationHours}h | ${wave.vms.length} VMs | ${wave.totalVCPUs} vCPUs | ${formatGB(wave.totalMemoryGB)} GB RAM | ${formatGB(wave.totalStorageGB)} GB Storage</p>
${wave.dependsOn.length > 0 ? `<p>Depends on: Wave ${wave.dependsOn.join(', ')}</p>` : ''}
<table>
<tr><th>VM Name</th><th>vCPUs</th><th>Memory (GB)</th><th>Storage (GB)</th><th>OS</th><th>Network</th></tr>
${wave.vms.map(vm => `<tr>
    <td>${escapeHtml(vm.name)}</td>
    <td>${vm.vCPUs}</td>
    <td>${vm.memoryGB}</td>
    <td>${vm.storageGB}</td>
    <td>${escapeHtml(vm.os)}</td>
    <td>${vm.networks.map(n => escapeHtml(n)).join(', ')}</td>
</tr>`).join('\n')}
</table>
`).join('\n')}

<h2>&#128274; Network Extensions Required</h2>
<table>
<tr><th>Source Network</th><th>VM Count</th><th>Required by Waves</th></tr>
${wavePlan.networkExtensions.map(ne => `<tr>
    <td>${escapeHtml(ne.sourceNetwork)}</td>
    <td>${ne.vmCount}</td>
    <td>${ne.requiredByWaves.join(', ')}</td>
</tr>`).join('\n')}
</table>

<h2>&#128203; VM Inventory Detail</h2>
<table>
<tr><th>Name</th><th>vCPUs</th><th>Memory</th><th>Storage</th><th>OS</th><th>Power</th><th>Datacenter</th><th>Network</th></tr>
${vms.map(vm => `<tr>
    <td>${escapeHtml(vm.name)}</td>
    <td>${vm.vCPUs}</td>
    <td>${vm.memoryGB} GB</td>
    <td>${vm.storageGB} GB</td>
    <td>${escapeHtml(vm.os)}</td>
    <td>${vm.powerState}</td>
    <td>${escapeHtml(vm.datacenter)}</td>
    <td>${vm.networks.map(n => escapeHtml(n)).join(', ')}</td>
</tr>`).join('\n')}
</table>

</body>
</html>`;
    }
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatGB(gb: number): string {
    return Math.round(gb).toLocaleString();
}

function formatTB(gb: number): string {
    return (gb / 1024).toFixed(1);
}
