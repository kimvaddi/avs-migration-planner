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
