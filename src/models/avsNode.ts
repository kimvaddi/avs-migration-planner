/**
 * AVS node type specifications.
 * Based on publicly available Azure VMware Solution documentation.
 * Pricing is approximate and region-dependent; users should verify with Azure Pricing Calculator.
 */

export interface AVSNodeSpec {
    /** Node type identifier */
    type: 'AV36' | 'AV36P' | 'AV52' | 'AV48' | 'AV64';
    /** Display name */
    displayName: string;
    /** Physical CPU cores per node */
    cpuCores: number;
    /** Usable vCPUs per node (with hyperthreading, minus overhead) */
    usableVCPUs: number;
    /** Physical RAM in GB per node */
    ramGB: number;
    /** Usable RAM in GB (after vSAN/ESXi overhead ~15%) */
    usableRamGB: number;
    /** Raw vSAN storage capacity in TB per node */
    rawStorageTB: number;
    /** Usable vSAN storage in TB per node (after FTT=1 RAID-1, ~35% usable of raw for FTT=1 with RAID-1) */
    usableStorageTB: number;
    /** NVMe cache tier in TB */
    cacheTB: number;
    /** Pricing: pay-as-you-go per node per month (USD, approximate) */
    payAsYouGoMonthly: number;
    /** Pricing: 1-year Reserved Instance per node per month (USD, approximate) */
    ri1YearMonthly: number;
    /** Pricing: 3-year Reserved Instance per node per month (USD, approximate) */
    ri3YearMonthly: number;
}

/**
 * AVS cluster constraints.
 */
export const AVS_CLUSTER_MIN_NODES = 3;
export const AVS_CLUSTER_MAX_NODES = 16;
export const AVS_MAX_CLUSTERS_PER_CLOUD = 12;

/**
 * AVS node specifications database.
 * Pricing approximate for US East region as reference. Users should validate.
 * 
 * Storage calculation notes:
 * - Raw = total NVMe capacity per node
 * - Usable = Raw / 2 (FTT=1 RAID-1 mirroring) * 0.70 (vSAN overhead, slack space)
 *   For simplicity: usable ≈ raw * 0.35
 */
export const AVS_NODE_SPECS: AVSNodeSpec[] = [
    {
        type: 'AV36',
        displayName: 'AV36 (Standard)',
        cpuCores: 36,
        usableVCPUs: 54,   // 36 cores * 2 HT - ~25% overhead
        ramGB: 576,
        usableRamGB: 490,  // ~85% usable
        rawStorageTB: 15.36,
        usableStorageTB: 5.4, // 15.36 * 0.35
        cacheTB: 3.2,
        payAsYouGoMonthly: 10720,
        ri1YearMonthly: 7504,
        ri3YearMonthly: 5360
    },
    {
        type: 'AV36P',
        displayName: 'AV36P (Performance)',
        cpuCores: 36,
        usableVCPUs: 54,
        ramGB: 768,
        usableRamGB: 653,
        rawStorageTB: 19.2,
        usableStorageTB: 6.7, // 19.2 * 0.35
        cacheTB: 3.2,
        payAsYouGoMonthly: 12864,
        ri1YearMonthly: 9005,
        ri3YearMonthly: 6432
    },
    {
        type: 'AV52',
        displayName: 'AV52 (High Performance)',
        cpuCores: 52,
        usableVCPUs: 78,   // 52 cores * 2 HT - ~25% overhead
        ramGB: 1536,
        usableRamGB: 1306,
        rawStorageTB: 38.4,
        usableStorageTB: 13.4, // 38.4 * 0.35
        cacheTB: 6.4,
        payAsYouGoMonthly: 18816,
        ri1YearMonthly: 13171,
        ri3YearMonthly: 9408
    },
    {
        type: 'AV48',
        displayName: 'AV48 (Gen 2 - ESA)',
        cpuCores: 48,
        usableVCPUs: 72,    // 48 cores * 2 HT - ~25% overhead
        ramGB: 1024,
        usableRamGB: 870,   // ~85% usable
        rawStorageTB: 25.6,
        usableStorageTB: 9.0, // 25.6 * 0.35
        cacheTB: 0,         // ESA - no separate cache tier
        payAsYouGoMonthly: 15979,
        ri1YearMonthly: 11185,
        ri3YearMonthly: 7990
    },
    {
        type: 'AV64',
        displayName: 'AV64 (Gen 2)',
        cpuCores: 64,
        usableVCPUs: 96,    // 64 cores * 2 HT - ~25% overhead
        ramGB: 1024,
        usableRamGB: 870,   // ~85% usable
        rawStorageTB: 15.36,  // OSA variant; ESA = 19.25 TB
        usableStorageTB: 5.4, // 15.36 * 0.35 (OSA)
        cacheTB: 3.84,
        payAsYouGoMonthly: 16714,
        ri1YearMonthly: 11700,
        ri3YearMonthly: 8357
    }
];

/**
 * Update AVS_NODE_SPECS pricing from live API data.
 * Only updates pricing fields; hardware specs remain unchanged.
 */
export function updateNodePricing(liveNodes: { skuName: string; monthlyRate: number; ri1YearMonthly?: number; ri3YearMonthly?: number }[]): void {
    for (const liveNode of liveNodes) {
        const spec = AVS_NODE_SPECS.find(s => s.type === liveNode.skuName);
        if (spec && liveNode.monthlyRate > 0) {
            spec.payAsYouGoMonthly = liveNode.monthlyRate;
            if (liveNode.ri1YearMonthly) {
                spec.ri1YearMonthly = liveNode.ri1YearMonthly;
            }
            if (liveNode.ri3YearMonthly) {
                spec.ri3YearMonthly = liveNode.ri3YearMonthly;
            }
        }
    }
}

/**
 * Cluster sizing recommendation.
 */
export interface ClusterRecommendation {
    nodeType: AVSNodeSpec;
    nodesRequired: number;
    clustersRequired: number;
    nodesPerCluster: number[];
    totalUsableVCPUs: number;
    totalUsableRamGB: number;
    totalUsableStorageTB: number;
    utilizationCpu: number;
    utilizationMemory: number;
    utilizationStorage: number;
    fitScore: number; // 0-100, higher is better fit
}

/**
 * Full sizing result comparing all node types.
 */
export interface SizingResult {
    requiredVCPUs: number;
    requiredMemoryGB: number;
    requiredStorageGB: number;
    recommendations: ClusterRecommendation[];
    bestFit: ClusterRecommendation;
}
