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
    /** Usable vSAN storage in TB per node — computed via calculateUsableStorage() */
    usableStorageTB: number;
    /** Number of capacity disks per node */
    diskCount: number;
    /** Individual disk size in GB */
    diskSizeGB: number;
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
 * Configurable sizing parameters for AVS capacity planning.
 * Modeled after the AVS License Calculator v4.04.
 */
export interface SizingConfig {
    /** CPU overcommit ratio (e.g., 4 = 4:1). Default: 4 for production, up to 8 for dev/test. */
    cpuOvercommit: number;
    /** Memory overcommit ratio (e.g., 1 = no overcommit). Default: 1. */
    memoryOvercommit: number;
    /** vSphere memory overhead fraction (0.10 = 10%). Default: 0.10. */
    vSphereMemoryOverhead: number;
    /** vSAN storage policy overhead multiplier. FTT=1 RAID-1 = 2.0, FTT=1 Erasure Coding = 1.33. */
    storagePolicyOverhead: number;
    /** vSAN deduplication and compression ratio (e.g. 1.8). Set to 1.0 to disable. */
    dedupCompressionRatio: number;
    /** vSAN slack space fraction (0.25 = 25%). Required for rebalancing/repairs. */
    vsanSlackSpace: number;
    /** Whether to add an N+1 spare node for HA. Default: true. */
    enableHANode: boolean;
    /** Storage policy label for display purposes. */
    storagePolicyLabel: string;
}

/** Default sizing config matching AVS Gen2 production best practices. */
export const DEFAULT_SIZING_CONFIG: SizingConfig = {
    cpuOvercommit: 4,
    memoryOvercommit: 1,
    vSphereMemoryOverhead: 0.10,
    storagePolicyOverhead: 1.33,  // FTT=1 Erasure Coding
    dedupCompressionRatio: 1.8,
    vsanSlackSpace: 0.25,
    enableHANode: true,
    storagePolicyLabel: 'FTT=1, Erasure Coding'
};

/**
 * AVS cluster constraints.
 */
export const AVS_CLUSTER_MIN_NODES = 3;
export const AVS_CLUSTER_MAX_NODES = 16;
export const AVS_MAX_CLUSTERS_PER_CLOUD = 12;

/**
 * Calculate usable vSAN storage per node given a sizing config.
 * Formula: raw / policyOverhead * (1 - slackSpace) * dedupRatio
 */
export function calculateUsableStorage(rawStorageTB: number, config: SizingConfig): number {
    return parseFloat(
        (rawStorageTB / config.storagePolicyOverhead * (1 - config.vsanSlackSpace) * config.dedupCompressionRatio).toFixed(2)
    );
}

/**
 * Calculate usable RAM per node given a sizing config.
 * Formula: physicalRAM * memOvercommit * (1 - vSphereOverhead)
 */
export function calculateUsableMemory(ramGB: number, config: SizingConfig): number {
    return parseFloat(
        (ramGB * config.memoryOvercommit * (1 - config.vSphereMemoryOverhead)).toFixed(2)
    );
}

/**
 * Calculate usable vCPUs per node given a sizing config.
 * Formula: physicalCores * cpuOvercommit
 */
export function calculateUsableVCPUs(cpuCores: number, config: SizingConfig): number {
    return cpuCores * config.cpuOvercommit;
}

/**
 * AVS node specifications database.
 * Pricing approximate for US East region as reference. Users should validate.
 *
 * Storage: usableStorageTB is pre-computed with DEFAULT_SIZING_CONFIG.
 * Call calculateUsableStorage() to recompute with custom config.
 *
 * Disk specs from AVS Calculator v4.04 SkuList.
 */
export const AVS_NODE_SPECS: AVSNodeSpec[] = [
    {
        type: 'AV36',
        displayName: 'AV36 (Standard)',
        cpuCores: 36,
        usableVCPUs: 144,     // 36 cores × 4:1 overcommit (DEFAULT_SIZING_CONFIG)
        ramGB: 576,
        usableRamGB: 518.4,   // 576 × 1.0 × 0.90
        rawStorageTB: 15.36,  // 8 × 1920 GB
        usableStorageTB: 15.59, // via calculateUsableStorage(15.36, DEFAULT)
        diskCount: 8,
        diskSizeGB: 1920,
        cacheTB: 3.2,
        payAsYouGoMonthly: 10720,
        ri1YearMonthly: 7504,
        ri3YearMonthly: 5360
    },
    {
        type: 'AV36P',
        displayName: 'AV36P (Performance)',
        cpuCores: 36,
        usableVCPUs: 144,     // 36 × 4:1
        ramGB: 768,
        usableRamGB: 691.2,   // 768 × 1.0 × 0.90
        rawStorageTB: 19.20,  // 6 × 3200 GB
        usableStorageTB: 19.49, // via calculateUsableStorage(19.20, DEFAULT)
        diskCount: 6,
        diskSizeGB: 3200,
        cacheTB: 1.5,
        payAsYouGoMonthly: 12864,
        ri1YearMonthly: 9005,
        ri3YearMonthly: 6432
    },
    {
        type: 'AV52',
        displayName: 'AV52 (High Performance)',
        cpuCores: 52,
        usableVCPUs: 208,     // 52 × 4:1
        ramGB: 1536,
        usableRamGB: 1382.4,  // 1536 × 1.0 × 0.90
        rawStorageTB: 38.40,  // 6 × 6400 GB
        usableStorageTB: 38.98, // via calculateUsableStorage(38.40, DEFAULT)
        diskCount: 6,
        diskSizeGB: 6400,
        cacheTB: 1.5,
        payAsYouGoMonthly: 18816,
        ri1YearMonthly: 13171,
        ri3YearMonthly: 9408
    },
    {
        type: 'AV48',
        displayName: 'AV48 (Gen 2 - ESA)',
        cpuCores: 48,
        usableVCPUs: 192,     // 48 × 4:1
        ramGB: 1024,
        usableRamGB: 921.6,   // 1024 × 1.0 × 0.90
        rawStorageTB: 25.60,  // 8 × 3200 GB
        usableStorageTB: 25.98, // via calculateUsableStorage(25.60, DEFAULT)
        diskCount: 8,
        diskSizeGB: 3200,
        cacheTB: 0,
        payAsYouGoMonthly: 15979,
        ri1YearMonthly: 11185,
        ri3YearMonthly: 7990
    },
    {
        type: 'AV64',
        displayName: 'AV64 (Gen 2 - VCF)',
        cpuCores: 64,
        usableVCPUs: 256,     // 64 × 4:1
        ramGB: 1024,
        usableRamGB: 921.6,   // 1024 × 1.0 × 0.90
        rawStorageTB: 21.12,  // 11 × 1920 GB (corrected from 15.36)
        usableStorageTB: 21.44, // via calculateUsableStorage(21.12, DEFAULT)
        diskCount: 11,
        diskSizeGB: 1920,
        cacheTB: 0,
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
    /** Which resource dimension required the most nodes */
    drivingDimension: 'CPU' | 'Memory' | 'Storage';
    /** Whether the N+1 HA node is included */
    includesHANode: boolean;
}

/**
 * Full sizing result comparing all node types.
 */
export interface SizingResult {
    requiredVCPUs: number;
    requiredMemoryGB: number;
    requiredStorageGB: number;
    sizingConfig: SizingConfig;
    recommendations: ClusterRecommendation[];
    bestFit: ClusterRecommendation;
}
