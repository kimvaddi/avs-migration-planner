import { VMInventoryItem } from './vm';

/**
 * A migration wave containing a group of VMs to migrate together.
 */
export interface MigrationWave {
    /** Wave number (1-based) */
    waveNumber: number;
    /** Wave name/label */
    name: string;
    /** VMs in this wave */
    vms: VMInventoryItem[];
    /** Total vCPUs in this wave */
    totalVCPUs: number;
    /** Total memory in this wave (GB) */
    totalMemoryGB: number;
    /** Total storage in this wave (GB) */
    totalStorageGB: number;
    /** Networks that need HCX extension for this wave */
    requiredNetworks: string[];
    /** Estimated migration duration in hours */
    estimatedDurationHours: number;
    /** Suggested start date offset from migration start (days) */
    startDayOffset: number;
    /** Dependencies: wave numbers that must complete before this one */
    dependsOn: number[];
    /** Risk level */
    riskLevel: 'low' | 'medium' | 'high';
}

/**
 * Full migration wave plan.
 */
export interface MigrationWavePlan {
    waves: MigrationWave[];
    totalVMs: number;
    totalWaves: number;
    estimatedTotalDays: number;
    networkExtensions: NetworkExtension[];
}

/**
 * HCX network extension configuration.
 */
export interface NetworkExtension {
    /** Source network name */
    sourceNetwork: string;
    /** Number of VMs on this network */
    vmCount: number;
    /** Required for wave numbers */
    requiredByWaves: number[];
}

/**
 * HCX mobility group.
 */
export interface HCXMobilityGroup {
    /** Group name */
    name: string;
    /** VMs in the group */
    vmNames: string[];
    /** Migration type */
    migrationType: 'bulk' | 'vMotion' | 'cold';
    /** Source network */
    sourceNetwork: string;
    /** Target network (NSX-T segment) */
    targetSegment: string;
    /** Switchover schedule */
    switchoverWindow: string;
}

/**
 * HCX configuration output.
 */
export interface HCXConfiguration {
    mobilityGroups: HCXMobilityGroup[];
    networkExtensions: NetworkExtension[];
    totalMigrations: number;
}

/**
 * Cost comparison result.
 */
export interface CostEstimate {
    nodeType: string;
    nodeCount: number;
    clusterCount: number;
    monthlyPayAsYouGo: number;
    yearlyPayAsYouGo: number;
    monthlyRI1Year: number;
    yearlyRI1Year: number;
    monthlyRI3Year: number;
    yearlyRI3Year: number;
    savingsRI1Year: number;
    savingsRI3Year: number;
    savingsPercentRI1Year: number;
    savingsPercentRI3Year: number;
}

/**
 * Configuration for TCO cost modeling.
 */
export interface TCOConfig {
    /** Number of years for the consumption plan (1–5). Default: 3. */
    years: number;
    /** Custom discount percentage on PAYG rates (0–1). E.g., 0.15 = 15%. Default: 0. */
    paygDiscount: number;
    /** Custom RI discount percentage (0–1). E.g., 0.30 = 30%. Default: 0. */
    riDiscount: number;
    /** Microsoft Defender for Servers Plan 2 cost per VM per month. Default: 14.60. */
    defenderServerP2Monthly: number;
    /** Microsoft Defender for SQL cost per DB server per month. Default: 15.00. */
    defenderSqlMonthly: number;
    /** Number of SQL/DB VMs (for Defender for SQL cost). Default: 0. */
    sqlVMCount: number;
    /** Total VM count (for Defender for Servers cost). Default: 0. */
    totalVMCount: number;
    /** Whether to include Defender costs. Default: false. */
    includeDefender: boolean;
}

/** Default TCO configuration. */
export const DEFAULT_TCO_CONFIG: TCOConfig = {
    years: 3,
    paygDiscount: 0,
    riDiscount: 0,
    defenderServerP2Monthly: 14.60,
    defenderSqlMonthly: 15.00,
    sqlVMCount: 0,
    totalVMCount: 0,
    includeDefender: false
};

/**
 * Yearly cost breakdown for TCO.
 */
export interface YearlyCostBreakdown {
    year: number;
    nodeCount: number;
    avsCost: number;
    defenderServersCost: number;
    defenderSqlCost: number;
    totalCost: number;
}

/**
 * Multi-year TCO estimate for a node type.
 */
export interface TCOEstimate {
    nodeType: string;
    nodeCount: number;
    clusterCount: number;
    /** Monthly AVS node cost (3yr RI baseline) */
    monthlyAVSCost: number;
    /** Monthly Defender for Servers cost */
    monthlyDefenderServers: number;
    /** Monthly Defender for SQL cost */
    monthlyDefenderSql: number;
    /** Monthly total */
    monthlyTotal: number;
    /** Yearly breakdown */
    yearlyBreakdown: YearlyCostBreakdown[];
    /** Total cost over the configured period */
    totalCost: number;
    /** Discount information */
    discountApplied: { payg: number; ri: number };
}
