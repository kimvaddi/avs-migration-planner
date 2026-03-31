import { ClusterRecommendation, AVSNodeSpec, SizingConfig } from '../models/avsNode';
import { getRegionInfo, getAvailableNodeTypes } from '../models/regionAvailability';

/**
 * Node recommendation advice with architect-level rationale.
 * Based on Microsoft Learn AVS documentation and Well-Architected Framework guidance.
 */
export interface NodeAdvice {
    /** Node type */
    nodeType: string;
    /** Overall recommendation: 'recommended' | 'suitable' | 'not-recommended' */
    verdict: 'recommended' | 'suitable' | 'not-recommended';
    /** One-line summary */
    summary: string;
    /** Detailed rationale bullets */
    rationale: string[];
    /** Cost efficiency metrics */
    costEfficiency: {
        costPerVCPU: number;
        costPerGBRam: number;
        costPerTBStorage: number;
    };
    /** Resource waste analysis */
    wasteAnalysis: {
        cpuWastePercent: number;
        memoryWastePercent: number;
        storageWastePercent: number;
        mostWastedResource: string;
    };
    /** Workload fit tags */
    bestFor: string[];
    /** Warnings (e.g., regional availability, EVC compatibility) */
    warnings: string[];
}

/**
 * Full advisory report for all node types.
 */
export interface NodeAdvisoryReport {
    recommendations: NodeAdvice[];
    bestChoice: NodeAdvice;
    region?: string;
    generatedAt: string;
}

/**
 * Workload archetype definitions based on MS Learn sizing guidance.
 * Source: https://learn.microsoft.com/azure/migrate/concepts-azure-vmware-solution-assessment-calculation
 */
const WORKLOAD_ARCHETYPES: Record<string, { tags: string[]; description: string }> = {
    'AV36': {
        tags: ['General purpose', 'Cost-sensitive', 'Balanced workloads', 'Legacy apps'],
        description: 'Budget-friendly for balanced workloads. Lowest cost per node but lower per-node capacity. Best when neither CPU, memory, nor storage demands are extreme.'
    },
    'AV36P': {
        tags: ['Memory-intensive', 'VDI', 'In-memory databases', 'Caching layers'],
        description: 'Performance variant with 33% more RAM (768 GB) and faster NVMe storage. Ideal for memory-intensive workloads like VDI, in-memory databases, and caching tiers.'
    },
    'AV52': {
        tags: ['High-performance computing', 'Large databases', 'Storage-heavy', 'SQL Server', 'SAP HANA'],
        description: 'Maximum RAM (1.5 TB) and storage (38.4 TB raw) per node. Best for large SQL Server, SAP HANA, and storage-heavy workloads that need the most capacity per host.'
    },
    'AV48': {
        tags: ['Gen 2 ESA', 'Modern vSAN', 'Balanced Gen 2', 'New deployments'],
        description: 'Gen 2 ESA architecture with vSAN Express Storage Architecture. 1 TB RAM and 25.6 TB storage. Good balance for new deployments in Gen 2 regions.'
    },
    'AV64': {
        tags: ['CPU-intensive', 'Gen 2 VCF', 'High-density compute', 'Extension clusters', 'VCF BYOL'],
        description: 'Highest core count (64 cores). Gen 2 with VNET-native connectivity and 100 Gbps throughput. Designed for CPU-dense workloads. Requires AV36/AV36P/AV48/AV52 seed cluster in Gen 1 mode, or standalone in Gen 2.'
    }
};

/**
 * Generate architect-level node selection advice for all recommendations.
 * Incorporates MS Learn guidance, cost analysis, waste identification, and regional checks.
 */
export function generateNodeAdvisory(
    recommendations: ClusterRecommendation[],
    region?: string
): NodeAdvisoryReport {
    const availableTypes = region ? getAvailableNodeTypes(region) : undefined;
    const regionInfo = region ? getRegionInfo(region) : undefined;

    const adviceList: NodeAdvice[] = recommendations.map(rec => {
        const spec = rec.nodeType;
        const archetype = WORKLOAD_ARCHETYPES[spec.type] || { tags: [], description: '' };

        // Cost efficiency (using 3yr RI as baseline — most common for production)
        const totalMonthly3yr = rec.nodesRequired * spec.ri3YearMonthly;
        const costPerVCPU = parseFloat((totalMonthly3yr / rec.totalUsableVCPUs).toFixed(2));
        const costPerGBRam = parseFloat((totalMonthly3yr / rec.totalUsableRamGB).toFixed(2));
        const costPerTBStorage = rec.totalUsableStorageTB > 0
            ? parseFloat((totalMonthly3yr / rec.totalUsableStorageTB).toFixed(2))
            : 0;

        // Waste analysis
        const cpuWaste = 100 - rec.utilizationCpu;
        const memWaste = 100 - rec.utilizationMemory;
        const storWaste = 100 - rec.utilizationStorage;
        const maxWaste = Math.max(cpuWaste, memWaste, storWaste);
        const mostWastedResource = maxWaste === cpuWaste ? 'CPU'
            : maxWaste === memWaste ? 'Memory' : 'Storage';

        // Build rationale
        const rationale: string[] = [];
        const warnings: string[] = [];

        // Driving dimension insight
        rationale.push(`Driving dimension: ${rec.drivingDimension} — this resource requires the most nodes.`);

        // Utilization assessment
        if (rec.utilizationCpu >= 50 && rec.utilizationCpu <= 80) {
            rationale.push(`CPU utilization ${rec.utilizationCpu}% is in the optimal 50–80% band.`);
        } else if (rec.utilizationCpu < 30) {
            rationale.push(`CPU utilization is only ${rec.utilizationCpu}% — significant CPU waste. Consider nodes with fewer cores.`);
        } else if (rec.utilizationCpu > 90) {
            rationale.push(`CPU utilization is ${rec.utilizationCpu}% — very high. Risk of contention under peak load.`);
        }

        if (rec.utilizationMemory >= 50 && rec.utilizationMemory <= 80) {
            rationale.push(`Memory utilization ${rec.utilizationMemory}% is in the optimal band.`);
        } else if (rec.utilizationMemory < 30) {
            rationale.push(`Memory utilization is only ${rec.utilizationMemory}% — consider nodes with less RAM (e.g., AV36 at 576 GB).`);
        } else if (rec.utilizationMemory > 90) {
            rationale.push(`Memory utilization is ${rec.utilizationMemory}% — risk of memory pressure. Consider nodes with more RAM.`);
        }

        if (rec.utilizationStorage > 0) {
            if (rec.utilizationStorage >= 50 && rec.utilizationStorage <= 80) {
                rationale.push(`Storage utilization ${rec.utilizationStorage}% is optimal.`);
            } else if (rec.utilizationStorage < 30) {
                rationale.push(`Storage utilization is only ${rec.utilizationStorage}% — consider external storage (Azure NetApp Files, Elastic SAN) to reduce node count.`);
            }
        }

        // Multi-cluster warning
        if (rec.clustersRequired > 1) {
            rationale.push(`Requires ${rec.clustersRequired} clusters (${rec.nodesPerCluster.join(', ')} nodes each). Multi-cluster adds management overhead.`);
        }

        // Node-specific guidance from MS Learn
        if (spec.type === 'AV64') {
            rationale.push('Gen 2 with Azure Boost — VNET-native connectivity, 100 Gbps throughput, lower latency to Azure services.');
            if (!regionInfo || !regionInfo.supportsGen2) {
                warnings.push(`AV64 (Gen 2) may not be available in ${region || 'your target region'}. Check regional availability.`);
            }
            rationale.push('Gen 1 mode: Requires seed cluster of AV36/AV36P/AV48/AV52 (minimum 3 nodes). EVC compatibility required for live vMotion between AV64 and base SKU clusters.');
        }

        if (spec.type === 'AV48') {
            rationale.push('ESA (Express Storage Architecture) — single storage tier, no separate cache. Simpler storage management.');
            if (!regionInfo || !regionInfo.supportsGen2) {
                warnings.push(`AV48 (Gen 2 ESA) may not be available in ${region || 'your target region'}.`);
            }
        }

        if (spec.type === 'AV52') {
            rationale.push('Highest per-node capacity (1.5 TB RAM, 38.4 TB raw). Fewest nodes for large workloads — reduces licensing and management overhead.');
        }

        if (spec.type === 'AV36P') {
            rationale.push('NVMe-based capacity tier provides higher IOPS than AV36 SSD. 33% more RAM than AV36 at moderate cost premium.');
        }

        if (spec.type === 'AV36') {
            rationale.push('Lowest cost per node. Best when workload is balanced and doesn\'t require high per-node RAM or storage.');
            if (rec.nodesRequired > 16) {
                rationale.push('Large node count — consider AV36P or AV52 to reduce host count and management overhead.');
            }
        }

        // Regional check
        if (availableTypes && !availableTypes.includes(spec.type)) {
            warnings.push(`${spec.type} is NOT available in ${region}. This recommendation cannot be deployed there.`);
        }

        // Stretched cluster check
        if (regionInfo && regionInfo.supportsStretchedCluster) {
            rationale.push(`${region} supports stretched clusters for 99.99% SLA (AV64 not supported for stretched).`);
        }

        // External storage recommendation for storage-bound scenarios
        if (rec.drivingDimension === 'Storage' && rec.utilizationCpu < 40 && rec.utilizationMemory < 40) {
            rationale.push('Storage-bound with low CPU/Memory utilization — strong candidate for Azure NetApp Files or Elastic SAN to offload storage and reduce node count.');
            warnings.push('Consider external storage (ANF, Elastic SAN) to optimize cost. See: https://learn.microsoft.com/azure/azure-vmware/ecosystem-external-storage-solutions');
        }

        // Determine verdict
        // Only disqualify if the *driving dimension* has extreme waste (>80%),
        // or if the node is unavailable in the target region.
        // Low utilization in non-driving dimensions is expected and not a disqualifier.
        let verdict: 'recommended' | 'suitable' | 'not-recommended' = 'suitable';
        if (availableTypes && !availableTypes.includes(spec.type)) {
            verdict = 'not-recommended';
        } else {
            const drivingWaste = rec.drivingDimension === 'CPU' ? cpuWaste
                : rec.drivingDimension === 'Memory' ? memWaste : storWaste;
            if (drivingWaste > 80) {
                verdict = 'not-recommended';
            }
        }

        // Summary — 'recommended' verdict is assigned post-loop
        const summary = verdict === 'not-recommended'
            ? `${spec.displayName} — Not recommended. ${maxWaste > 70 ? `${mostWastedResource} waste at ${maxWaste}%.` : ''} ${availableTypes && !availableTypes.includes(spec.type) ? 'Not available in region.' : ''}`
            : `${spec.displayName} — Suitable alternative. ${rec.nodesRequired} nodes, ${rec.fitScore}/100 fit score.`;

        return {
            nodeType: spec.type,
            verdict,
            summary,
            rationale,
            costEfficiency: { costPerVCPU, costPerGBRam, costPerTBStorage },
            wasteAnalysis: {
                cpuWastePercent: cpuWaste,
                memoryWastePercent: memWaste,
                storageWastePercent: storWaste,
                mostWastedResource
            },
            bestFor: archetype.tags,
            warnings
        };
    });

    // Mark the highest-fit-score node that isn't disqualified as recommended
    const bestCandidate = adviceList.find(a => a.verdict !== 'not-recommended');
    if (bestCandidate) {
        bestCandidate.verdict = 'recommended';
        const spec = recommendations.find(r => r.nodeType.type === bestCandidate.nodeType);
        if (spec) {
            bestCandidate.summary = `${spec.nodeType.displayName} — Best fit for your workload. ${spec.drivingDimension}-driven, ${spec.nodesRequired} nodes, ${spec.fitScore}/100 fit score.`;
        }
    }

    const bestChoice = adviceList.find(a => a.verdict === 'recommended') || adviceList[0];

    return {
        recommendations: adviceList,
        bestChoice,
        region,
        generatedAt: new Date().toISOString()
    };
}

/**
 * Format advisory report as human-readable text.
 */
export function formatAdvisoryText(report: NodeAdvisoryReport): string {
    const lines: string[] = [];
    lines.push('═══════════════════════════════════════════════════════════════');
    lines.push('  AVS NODE SELECTION GUIDE — ARCHITECT RECOMMENDATION');
    lines.push('═══════════════════════════════════════════════════════════════');
    if (report.region) {
        lines.push(`  Target Region: ${report.region}`);
    }
    lines.push('');

    for (const advice of report.recommendations) {
        const icon = advice.verdict === 'recommended' ? '★ RECOMMENDED'
            : advice.verdict === 'not-recommended' ? '✗ NOT RECOMMENDED' : '○ SUITABLE';
        lines.push(`─── ${advice.nodeType} [${icon}] ───`);
        lines.push(`  ${advice.summary}`);
        lines.push('');

        lines.push('  Rationale:');
        for (const r of advice.rationale) {
            lines.push(`    • ${r}`);
        }
        lines.push('');

        lines.push('  Cost Efficiency (3yr RI monthly):');
        lines.push(`    • $/vCPU:       $${advice.costEfficiency.costPerVCPU}`);
        lines.push(`    • $/GB RAM:     $${advice.costEfficiency.costPerGBRam}`);
        if (advice.costEfficiency.costPerTBStorage > 0) {
            lines.push(`    • $/TB Storage: $${advice.costEfficiency.costPerTBStorage}`);
        }
        lines.push('');

        lines.push('  Resource Waste:');
        lines.push(`    • CPU: ${advice.wasteAnalysis.cpuWastePercent}% unused | Memory: ${advice.wasteAnalysis.memoryWastePercent}% unused | Storage: ${advice.wasteAnalysis.storageWastePercent}% unused`);
        lines.push(`    • Most wasted: ${advice.wasteAnalysis.mostWastedResource}`);
        lines.push('');

        lines.push(`  Best for: ${advice.bestFor.join(', ')}`);

        if (advice.warnings.length > 0) {
            lines.push('');
            lines.push('  ⚠ Warnings:');
            for (const w of advice.warnings) {
                lines.push(`    ‣ ${w}`);
            }
        }
        lines.push('');
    }

    lines.push('───────────────────────────────────────────────────────────────');
    lines.push('Sources: Microsoft Learn — Azure VMware Solution documentation');
    lines.push('  • Node specs: https://learn.microsoft.com/azure/azure-vmware/introduction');
    lines.push('  • Sizing methodology: https://learn.microsoft.com/azure/migrate/concepts-azure-vmware-solution-assessment-calculation');
    lines.push('  • Storage policies: https://learn.microsoft.com/azure/azure-vmware/architecture-storage');
    lines.push('  • External storage: https://learn.microsoft.com/azure/azure-vmware/ecosystem-external-storage-solutions');
    lines.push('  • Well-Architected: https://learn.microsoft.com/azure/well-architected/azure-vmware/infrastructure');
    lines.push('───────────────────────────────────────────────────────────────');

    return lines.join('\n');
}
