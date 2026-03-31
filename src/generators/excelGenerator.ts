import ExcelJS from 'exceljs';
import { VMInventoryItem, InventorySummary } from '../models/vm';
import { SizingResult, AVS_NODE_SPECS, SizingConfig } from '../models/avsNode';
import { CostEstimate, MigrationWavePlan } from '../models/migrationPlan';

/**
 * Parameters for generating the AVS Excel report.
 */
export interface ExcelReportParams {
    vms: VMInventoryItem[];
    summary: InventorySummary;
    sizing: SizingResult;
    costs: CostEstimate[];
    wavePlan: MigrationWavePlan;
    region?: string;
    generatedDate?: string;
}

// Color constants
const BLUE_HEADER = 'FF4472C4';
const BLUE_SECTION = 'FFD6E4F0';
const GREEN_TOTAL = 'FFC6EFCE';
const GREEN_FONT = 'FF006100';
const YELLOW_INPUT = 'FFFFF2CC';
const LIGHT_BLUE_FORMULA = 'FFDDEBF7';
const RED_FONT = 'FFC00000';

/**
 * Generate a multi-sheet Excel workbook with AVS migration plan data.
 * Returns the workbook buffer ready for writing to disk.
 */
export async function generateExcelReport(params: ExcelReportParams): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'AVS Migration Planner';
    wb.created = new Date();

    buildInputFieldsSheet(wb, params);
    buildSizingSheet(wb, params);
    buildCostSheet(wb, params);
    buildVMInventorySheet(wb, params);
    buildWavePlanSheet(wb, params);
    buildSKUReferenceSheet(wb);

    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
}

// ============================================================
// Sheet 1: Input Fields
// ============================================================
function buildInputFieldsSheet(wb: ExcelJS.Workbook, params: ExcelReportParams): void {
    const ws = wb.addWorksheet('Input Fields');
    ws.columns = [
        { width: 5 }, { width: 40 }, { width: 25 }, { width: 15 }
    ];

    const config = params.sizing.sizingConfig;
    const date = params.generatedDate || new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    // Title
    let r = 1;
    const titleRow = ws.getRow(r);
    ws.mergeCells(r, 2, r, 3);
    titleRow.getCell(2).value = 'Azure VMware Solution — License Calculator';
    titleRow.getCell(2).font = { bold: true, size: 16, color: { argb: 'FF1F4E79' } };
    r++;

    ws.getRow(r).getCell(2).value = `AVS Estimate — ${params.region || 'US East'}`;
    ws.getRow(r).getCell(2).font = { italic: true, size: 10, color: { argb: 'FF808080' } };
    ws.getRow(r).getCell(3).value = `Date: ${date}`;
    r += 2;

    // Section: Sizing Parameters
    addSectionHeader(ws, r, 'Sizing Parameters');
    r++;
    r = addInputRow(ws, r, 'CPU Overcommit Ratio', `${config.cpuOvercommit}:1`);
    r = addInputRow(ws, r, 'Memory Overcommit Ratio', `${config.memoryOvercommit}:1`);
    r = addInputRow(ws, r, 'vSphere Memory Overhead', `${(config.vSphereMemoryOverhead * 100).toFixed(0)}%`);
    r = addInputRow(ws, r, 'Storage Policy', config.storagePolicyLabel);
    r = addInputRow(ws, r, 'Storage Policy Overhead', `${config.storagePolicyOverhead}×`);
    r = addInputRow(ws, r, 'Dedup/Compression Ratio', `${config.dedupCompressionRatio}×`);
    r = addInputRow(ws, r, 'vSAN Slack Space', `${(config.vsanSlackSpace * 100).toFixed(0)}%`);
    r = addInputRow(ws, r, 'N+1 HA Node', config.enableHANode ? 'Enabled' : 'Disabled');
    r++;

    // Section: Workload Summary
    addSectionHeader(ws, r, 'Workload Summary');
    r++;
    r = addInputRow(ws, r, 'Total VMs', params.summary.totalVMs);
    r = addInputRow(ws, r, 'Powered On VMs', params.summary.poweredOnVMs);
    r = addInputRow(ws, r, 'Total vCPUs', params.summary.totalvCPUs);
    r = addInputRow(ws, r, 'Total Memory (GB)', Math.round(params.summary.totalMemoryGB));
    r = addInputRow(ws, r, 'Total Storage (GB)', Math.round(params.summary.totalStorageGB));
    r = addInputRow(ws, r, 'Unique Networks', params.summary.uniqueNetworks.length);
    r = addInputRow(ws, r, 'Unique Datacenters', params.summary.uniqueDatacenters.length);
    r++;

    // Section: Required Resources (with buffer)
    addSectionHeader(ws, r, 'Required Resources (with buffer)');
    r++;
    r = addInputRow(ws, r, 'Required vCPUs', params.sizing.requiredVCPUs);
    r = addInputRow(ws, r, 'Required Memory (GB)', params.sizing.requiredMemoryGB);
    r = addInputRow(ws, r, 'Required Storage (GB)', params.sizing.requiredStorageGB);
}

// ============================================================
// Sheet 2: Node Sizing
// ============================================================
function buildSizingSheet(wb: ExcelJS.Workbook, params: ExcelReportParams): void {
    const ws = wb.addWorksheet('Node Sizing');
    ws.columns = [
        { width: 5 }, { width: 22 }, { width: 12 }, { width: 12 },
        { width: 14 }, { width: 14 }, { width: 14 }, { width: 12 },
        { width: 12 }, { width: 12 }, { width: 14 }, { width: 12 }
    ];

    let r = 1;
    const titleRow = ws.getRow(r);
    ws.mergeCells(r, 2, r, 8);
    titleRow.getCell(2).value = 'AVS Node Sizing Recommendations';
    titleRow.getCell(2).font = { bold: true, size: 14, color: { argb: 'FF1F4E79' } };
    r += 2;

    // Header row
    const headers = ['Node Type', 'Nodes', 'Clusters', 'CPU Util %', 'RAM Util %', 'Storage Util %', 'Fit Score', 'Driving Dim.', 'N+1 HA', 'Cluster Layout'];
    const headerRow = ws.getRow(r);
    headers.forEach((h, i) => {
        const cell = headerRow.getCell(i + 2);
        cell.value = h;
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE_HEADER } };
        cell.border = thinBorder();
        cell.alignment = { horizontal: 'center', wrapText: true };
    });
    r++;

    for (const rec of params.sizing.recommendations) {
        const isBestFit = rec === params.sizing.bestFit;
        const row = ws.getRow(r);

        const values = [
            rec.nodeType.displayName + (isBestFit ? ' ★' : ''),
            rec.nodesRequired,
            rec.clustersRequired,
            rec.utilizationCpu,
            rec.utilizationMemory,
            rec.utilizationStorage,
            rec.fitScore,
            rec.drivingDimension,
            rec.includesHANode ? 'Yes' : 'No',
            rec.nodesPerCluster.join(', ')
        ];

        values.forEach((v, i) => {
            const cell = row.getCell(i + 2);
            cell.value = v;
            cell.border = thinBorder();
            cell.alignment = { horizontal: 'center' };
            if (isBestFit) {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN_TOTAL } };
                cell.font = { bold: true, color: { argb: GREEN_FONT } };
            }
        });

        // Color-code utilization cells
        for (let col = 4; col <= 6; col++) {
            const cell = row.getCell(col + 1);
            const val = values[col - 1] as number;
            if (val > 90) {
                cell.font = { ...cell.font, color: { argb: RED_FONT } };
            }
        }
        r++;
    }

    // Summary below table
    r += 2;
    const bestFit = params.sizing.bestFit;
    ws.getRow(r).getCell(2).value = 'Best Fit Summary';
    ws.getRow(r).getCell(2).font = { bold: true, size: 12, color: { argb: 'FF2E75B6' } };
    r++;
    addValueRow(ws, r++, 'Node Type', bestFit.nodeType.displayName);
    addValueRow(ws, r++, 'Total Nodes', bestFit.nodesRequired);
    addValueRow(ws, r++, 'Total Clusters', bestFit.clustersRequired);
    addValueRow(ws, r++, 'Driving Dimension', bestFit.drivingDimension);
    addValueRow(ws, r++, 'Total Usable vCPUs', bestFit.totalUsableVCPUs);
    addValueRow(ws, r++, 'Total Usable RAM (GB)', bestFit.totalUsableRamGB);
    addValueRow(ws, r++, 'Total Usable Storage (TB)', bestFit.totalUsableStorageTB);
}

// ============================================================
// Sheet 3: Pricing & Cost
// ============================================================
function buildCostSheet(wb: ExcelJS.Workbook, params: ExcelReportParams): void {
    const ws = wb.addWorksheet('Pricing & Cost');
    ws.columns = [
        { width: 5 }, { width: 22 }, { width: 12 }, { width: 18 },
        { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 },
        { width: 18 }, { width: 16 }, { width: 16 }
    ];

    let r = 1;
    const titleRow = ws.getRow(r);
    ws.mergeCells(r, 2, r, 8);
    titleRow.getCell(2).value = 'AVS Pricing Comparison';
    titleRow.getCell(2).font = { bold: true, size: 14, color: { argb: 'FF1F4E79' } };
    r += 2;

    // Headers
    const headers = ['Node Type', 'Nodes', 'Monthly PAYG', 'Yearly PAYG', 'Monthly 1yr RI', 'Monthly 3yr RI', 'Yearly 3yr RI', 'Savings (3yr RI)', 'Savings %'];
    const headerRow = ws.getRow(r);
    headers.forEach((h, i) => {
        const cell = headerRow.getCell(i + 2);
        cell.value = h;
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE_HEADER } };
        cell.border = thinBorder();
        cell.alignment = { horizontal: 'center', wrapText: true };
    });
    r++;

    for (const cost of params.costs) {
        const isBestFit = cost.nodeType === params.sizing.bestFit.nodeType.type;
        const row = ws.getRow(r);

        const values: (string | number)[] = [
            cost.nodeType,
            cost.nodeCount,
            cost.monthlyPayAsYouGo,
            cost.yearlyPayAsYouGo,
            cost.monthlyRI1Year,
            cost.monthlyRI3Year,
            cost.yearlyRI3Year,
            cost.savingsRI3Year,
            `${cost.savingsPercentRI3Year}%`
        ];

        values.forEach((v, i) => {
            const cell = row.getCell(i + 2);
            cell.value = v;
            cell.border = thinBorder();
            cell.alignment = { horizontal: 'center' };
            // Format money columns
            if (i >= 2 && i <= 7 && typeof v === 'number') {
                cell.numFmt = '$#,##0';
            }
            if (isBestFit) {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN_TOTAL } };
                cell.font = { bold: true, color: { argb: GREEN_FONT } };
            }
        });
        r++;
    }

    // Disclaimer
    r += 2;
    ws.mergeCells(r, 2, r, 8);
    const disclaimer = ws.getRow(r).getCell(2);
    disclaimer.value = '⚠ Pricing is approximate. Verify with Azure Pricing Calculator and your Microsoft account team.';
    disclaimer.font = { italic: true, size: 10, color: { argb: RED_FONT } };
}

// ============================================================
// Sheet 4: VM Inventory
// ============================================================
function buildVMInventorySheet(wb: ExcelJS.Workbook, params: ExcelReportParams): void {
    const ws = wb.addWorksheet('VM Inventory');

    const headers = ['VM Name', 'vCPUs', 'Memory (GB)', 'Storage (GB)', 'OS', 'Power State', 'Datacenter', 'Cluster', 'Network', 'Category'];
    ws.columns = headers.map(h => ({
        header: h,
        width: h === 'VM Name' ? 30 : h === 'OS' ? 35 : h === 'Network' ? 30 : 15
    }));

    // Style header row
    const headerRow = ws.getRow(1);
    headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE_HEADER } };
        cell.border = thinBorder();
        cell.alignment = { horizontal: 'center', wrapText: true };
    });

    // Data rows
    for (const vm of params.vms) {
        const category = detectVMCategory(vm.name);
        const row = ws.addRow([
            vm.name,
            vm.vCPUs,
            Math.round(vm.memoryGB),
            Math.round(vm.storageGB),
            vm.os,
            vm.powerState,
            vm.datacenter,
            vm.cluster,
            vm.networks.join(', '),
            category
        ]);

        row.eachCell((cell) => {
            cell.border = thinBorder();
        });

        // Color-code power state
        const powerCell = row.getCell(6);
        if (vm.powerState === 'off') {
            powerCell.font = { color: { argb: RED_FONT } };
        } else if (vm.powerState === 'on') {
            powerCell.font = { color: { argb: GREEN_FONT } };
        }

        // Color-code SQL/DB category
        if (category === 'Database') {
            row.getCell(10).font = { bold: true, color: { argb: 'FF7030A0' } };
        }
    }

    // Auto-filter
    ws.autoFilter = { from: 'A1', to: `J${params.vms.length + 1}` };
}

// ============================================================
// Sheet 5: Wave Plan
// ============================================================
function buildWavePlanSheet(wb: ExcelJS.Workbook, params: ExcelReportParams): void {
    const ws = wb.addWorksheet('Wave Plan');
    ws.columns = [
        { width: 10 }, { width: 28 }, { width: 10 }, { width: 14 },
        { width: 14 }, { width: 14 }, { width: 30 }, { width: 14 },
        { width: 12 }, { width: 12 }
    ];

    const headers = ['Wave #', 'VM Name', 'vCPUs', 'Memory (GB)', 'Storage (GB)', 'OS', 'Network', 'Risk', 'Day Start', 'Duration (hrs)'];
    const headerRow = ws.getRow(1);
    headers.forEach((h, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = h;
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE_HEADER } };
        cell.border = thinBorder();
        cell.alignment = { horizontal: 'center', wrapText: true };
    });

    let r = 2;
    for (const wave of params.wavePlan.waves) {
        const riskColor = wave.riskLevel === 'high' ? RED_FONT : wave.riskLevel === 'medium' ? 'FFFF8C00' : GREEN_FONT;

        for (const vm of wave.vms) {
            const row = ws.getRow(r);
            const values: (string | number)[] = [
                wave.waveNumber,
                vm.name,
                vm.vCPUs,
                Math.round(vm.memoryGB),
                Math.round(vm.storageGB),
                vm.os,
                vm.networks.join(', '),
                wave.riskLevel.toUpperCase(),
                wave.startDayOffset,
                wave.estimatedDurationHours
            ];

            values.forEach((v, i) => {
                const cell = row.getCell(i + 1);
                cell.value = v;
                cell.border = thinBorder();
            });

            // Color risk
            row.getCell(8).font = { bold: true, color: { argb: riskColor } };
            r++;
        }
    }

    ws.autoFilter = { from: 'A1', to: `J${r - 1}` };

    // Summary at top-right
    const summaryCol = 12;
    ws.getColumn(summaryCol).width = 18;
    ws.getColumn(summaryCol + 1).width = 12;
    ws.getCell(1, summaryCol).value = 'Wave Summary';
    ws.getCell(1, summaryCol).font = { bold: true, size: 12, color: { argb: 'FF2E75B6' } };

    ws.getCell(2, summaryCol).value = 'Total Waves';
    ws.getCell(2, summaryCol + 1).value = params.wavePlan.totalWaves;
    ws.getCell(3, summaryCol).value = 'Total VMs';
    ws.getCell(3, summaryCol + 1).value = params.wavePlan.totalVMs;
    ws.getCell(4, summaryCol).value = 'Est. Total Days';
    ws.getCell(4, summaryCol + 1).value = params.wavePlan.estimatedTotalDays;
    ws.getCell(5, summaryCol).value = 'Network Extensions';
    ws.getCell(5, summaryCol + 1).value = params.wavePlan.networkExtensions.length;
}

// ============================================================
// Sheet 6: SKU Reference
// ============================================================
function buildSKUReferenceSheet(wb: ExcelJS.Workbook): void {
    const ws = wb.addWorksheet('SKU Reference');

    const headers = ['Node Type', 'CPU Cores', 'Usable vCPUs (4:1)', 'RAM (GB)', 'Usable RAM (GB)', 'Raw Storage (TB)', 'Usable Storage (TB)', 'Disks', 'Disk Size (GB)', 'Cache (TB)', 'PAYG $/mo', '1yr RI $/mo', '3yr RI $/mo'];
    ws.columns = headers.map(h => ({
        header: h,
        width: h === 'Node Type' ? 25 : 16
    }));

    const headerRow = ws.getRow(1);
    headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE_HEADER } };
        cell.border = thinBorder();
        cell.alignment = { horizontal: 'center', wrapText: true };
    });

    for (const spec of AVS_NODE_SPECS) {
        const row = ws.addRow([
            spec.displayName,
            spec.cpuCores,
            spec.usableVCPUs,
            spec.ramGB,
            spec.usableRamGB,
            spec.rawStorageTB,
            spec.usableStorageTB,
            spec.diskCount,
            spec.diskSizeGB,
            spec.cacheTB,
            spec.payAsYouGoMonthly,
            spec.ri1YearMonthly,
            spec.ri3YearMonthly
        ]);

        row.eachCell((cell, colNumber) => {
            cell.border = thinBorder();
            cell.alignment = { horizontal: 'center' };
            // Money format for pricing columns
            if (colNumber >= 11) {
                cell.numFmt = '$#,##0';
            }
        });
    }

    // Note
    const noteRow = ws.addRow([]);
    const note2 = ws.addRow(['', '⚠ Usable storage assumes FTT=1 Erasure Coding, 25% vSAN slack, 1.8× dedup/compression. Pricing is US East reference.']);
    ws.mergeCells(note2.number, 2, note2.number, 10);
    note2.getCell(2).font = { italic: true, size: 10, color: { argb: 'FF808080' } };
}

// ============================================================
// Helpers
// ============================================================

function addSectionHeader(ws: ExcelJS.Worksheet, row: number, text: string): void {
    ws.mergeCells(row, 2, row, 3);
    const cell = ws.getRow(row).getCell(2);
    cell.value = text;
    cell.font = { bold: true, size: 13, color: { argb: 'FF2E75B6' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE_SECTION } };
    cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' } };
}

function addInputRow(ws: ExcelJS.Worksheet, row: number, label: string, value: string | number): number {
    const r = ws.getRow(row);
    r.getCell(2).value = label;
    r.getCell(2).font = { bold: true, size: 11 };
    r.getCell(3).value = value;
    r.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: YELLOW_INPUT } };
    r.getCell(3).border = thinBorder();
    return row + 1;
}

function addValueRow(ws: ExcelJS.Worksheet, row: number, label: string, value: string | number): void {
    ws.getRow(row).getCell(2).value = label;
    ws.getRow(row).getCell(2).font = { bold: true, size: 11 };
    ws.getRow(row).getCell(3).value = value;
    ws.getRow(row).getCell(3).border = thinBorder();
    ws.getRow(row).getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_BLUE_FORMULA } };
}

function thinBorder(): Partial<ExcelJS.Borders> {
    return {
        top: { style: 'thin' },
        bottom: { style: 'thin' },
        left: { style: 'thin' },
        right: { style: 'thin' }
    };
}

/**
 * Detect VM category from name pattern (same pattern as detectSqlVMs).
 */
function detectVMCategory(name: string): string {
    const upper = name.toUpperCase();
    if (upper.includes('SQL') || upper.includes('DB')) { return 'Database'; }
    if (upper.includes('WEB') || upper.includes('IIS') || upper.includes('NGINX') || upper.includes('APACHE')) { return 'Web'; }
    if (upper.includes('APP') || upper.includes('API') || upper.includes('SVC')) { return 'Application'; }
    if (upper.includes('DC') || upper.includes('DNS') || upper.includes('AD') || upper.includes('DHCP')) { return 'Infrastructure'; }
    return 'General';
}
