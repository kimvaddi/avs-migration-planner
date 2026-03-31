import { ClusterRecommendation } from '../models/avsNode';
import { CostEstimate, TCOConfig, DEFAULT_TCO_CONFIG, TCOEstimate, YearlyCostBreakdown } from '../models/migrationPlan';

/**
 * Calculate cost estimates for a cluster recommendation.
 */
export function calculateCost(recommendation: ClusterRecommendation): CostEstimate {
    const nodeSpec = recommendation.nodeType;
    const nodeCount = recommendation.nodesRequired;

    const monthlyPayAsYouGo = nodeCount * nodeSpec.payAsYouGoMonthly;
    const monthlyRI1Year = nodeCount * nodeSpec.ri1YearMonthly;
    const monthlyRI3Year = nodeCount * nodeSpec.ri3YearMonthly;

    const yearlyPayAsYouGo = monthlyPayAsYouGo * 12;
    const yearlyRI1Year = monthlyRI1Year * 12;
    const yearlyRI3Year = monthlyRI3Year * 12;

    const savingsRI1Year = yearlyPayAsYouGo - yearlyRI1Year;
    const savingsRI3Year = yearlyPayAsYouGo - yearlyRI3Year;

    const savingsPercentRI1Year = yearlyPayAsYouGo > 0
        ? Math.round((savingsRI1Year / yearlyPayAsYouGo) * 100)
        : 0;
    const savingsPercentRI3Year = yearlyPayAsYouGo > 0
        ? Math.round((savingsRI3Year / yearlyPayAsYouGo) * 100)
        : 0;

    return {
        nodeType: nodeSpec.type,
        nodeCount,
        clusterCount: recommendation.clustersRequired,
        monthlyPayAsYouGo,
        yearlyPayAsYouGo,
        monthlyRI1Year,
        yearlyRI1Year,
        monthlyRI3Year,
        yearlyRI3Year,
        savingsRI1Year,
        savingsRI3Year,
        savingsPercentRI1Year,
        savingsPercentRI3Year
    };
}

/**
 * Calculate costs for all recommendations and return sorted by lowest cost.
 */
export function calculateAllCosts(recommendations: ClusterRecommendation[]): CostEstimate[] {
    return recommendations
        .map(rec => calculateCost(rec))
        .sort((a, b) => a.monthlyRI3Year - b.monthlyRI3Year);
}

/**
 * Format a number as USD currency string.
 */
export function formatCurrency(amount: number): string {
    return '$' + amount.toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    });
}

/**
 * Generate a cost comparison summary text.
 */
export function generateCostSummary(costs: CostEstimate[]): string {
    const lines: string[] = [];
    lines.push('=== AVS Cost Comparison ===\n');

    for (const cost of costs) {
        lines.push(`Node Type: ${cost.nodeType}`);
        lines.push(`  Nodes: ${cost.nodeCount} (${cost.clusterCount} cluster${cost.clusterCount > 1 ? 's' : ''})`);
        lines.push(`  Pay-As-You-Go:   ${formatCurrency(cost.monthlyPayAsYouGo)}/month  |  ${formatCurrency(cost.yearlyPayAsYouGo)}/year`);
        lines.push(`  1-Year RI:       ${formatCurrency(cost.monthlyRI1Year)}/month  |  ${formatCurrency(cost.yearlyRI1Year)}/year  (Save ${cost.savingsPercentRI1Year}%)`);
        lines.push(`  3-Year RI:       ${formatCurrency(cost.monthlyRI3Year)}/month  |  ${formatCurrency(cost.yearlyRI3Year)}/year  (Save ${cost.savingsPercentRI3Year}%)`);
        lines.push('');
    }

    lines.push('Note: Pricing is approximate (US East reference). Verify with Azure Pricing Calculator.');
    return lines.join('\n');
}

/**
 * Calculate multi-year TCO estimate for a cluster recommendation.
 * Includes AVS node costs (3yr RI as baseline) and optional Defender costs.
 */
export function calculateTCO(
    recommendation: ClusterRecommendation,
    config: TCOConfig = DEFAULT_TCO_CONFIG
): TCOEstimate {
    const nodeSpec = recommendation.nodeType;
    const nodeCount = recommendation.nodesRequired;

    // Apply custom RI discount if provided, otherwise use standard 3yr RI
    let monthlyPerNode: number;
    if (config.riDiscount > 0) {
        monthlyPerNode = nodeSpec.payAsYouGoMonthly * (1 - config.riDiscount);
    } else {
        monthlyPerNode = nodeSpec.ri3YearMonthly;
    }
    const monthlyAVSCost = parseFloat((nodeCount * monthlyPerNode).toFixed(2));

    // Defender costs
    const monthlyDefenderServers = config.includeDefender
        ? parseFloat((config.totalVMCount * config.defenderServerP2Monthly).toFixed(2))
        : 0;
    const monthlyDefenderSql = config.includeDefender
        ? parseFloat((config.sqlVMCount * config.defenderSqlMonthly).toFixed(2))
        : 0;

    const monthlyTotal = parseFloat((monthlyAVSCost + monthlyDefenderServers + monthlyDefenderSql).toFixed(2));

    // Build yearly breakdown
    const yearlyBreakdown: YearlyCostBreakdown[] = [];
    for (let yr = 1; yr <= config.years; yr++) {
        const avsCost = parseFloat((monthlyAVSCost * 12).toFixed(2));
        const defSrv = parseFloat((monthlyDefenderServers * 12).toFixed(2));
        const defSql = parseFloat((monthlyDefenderSql * 12).toFixed(2));
        yearlyBreakdown.push({
            year: yr,
            nodeCount,
            avsCost,
            defenderServersCost: defSrv,
            defenderSqlCost: defSql,
            totalCost: parseFloat((avsCost + defSrv + defSql).toFixed(2))
        });
    }

    const totalCost = parseFloat(yearlyBreakdown.reduce((sum, y) => sum + y.totalCost, 0).toFixed(2));

    return {
        nodeType: nodeSpec.type,
        nodeCount,
        clusterCount: recommendation.clustersRequired,
        monthlyAVSCost,
        monthlyDefenderServers,
        monthlyDefenderSql,
        monthlyTotal,
        yearlyBreakdown,
        totalCost,
        discountApplied: { payg: config.paygDiscount, ri: config.riDiscount }
    };
}

/**
 * Detect SQL/DB VMs by name pattern (case-insensitive).
 * Returns count of VMs whose name contains 'SQL' or 'DB'.
 */
export function detectSqlVMs(vmNames: string[]): number {
    return vmNames.filter(name => {
        const upper = name.toUpperCase();
        return upper.includes('SQL') || upper.includes('DB');
    }).length;
}
