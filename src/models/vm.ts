/**
 * Represents a virtual machine from the imported inventory.
 */
export interface VMInventoryItem {
    /** VM name */
    name: string;
    /** Number of virtual CPUs */
    vCPUs: number;
    /** Memory in GB */
    memoryGB: number;
    /** Provisioned storage in GB */
    storageGB: number;
    /** Guest operating system */
    os: string;
    /** Power state (on/off/suspended) */
    powerState: 'on' | 'off' | 'suspended' | 'unknown';
    /** Source datacenter or cluster name */
    datacenter: string;
    /** Source cluster name */
    cluster: string;
    /** Source host */
    host: string;
    /** Network(s) the VM is attached to */
    networks: string[];
    /** Dependency group tag (optional) */
    dependencyGroup: string;
    /** Notes or tags */
    notes: string;
}

/**
 * Summary of all VMs in the inventory.
 */
export interface InventorySummary {
    totalVMs: number;
    poweredOnVMs: number;
    poweredOffVMs: number;
    totalvCPUs: number;
    totalMemoryGB: number;
    totalStorageGB: number;
    uniqueNetworks: string[];
    uniqueDatacenters: string[];
    uniqueClusters: string[];
    osSummary: Record<string, number>;
}

/**
 * Result of parsing a CSV file.
 */
export interface ParseResult {
    success: boolean;
    vms: VMInventoryItem[];
    errors: string[];
    warnings: string[];
    format: 'rvtools' | 'standard' | 'unknown';
}
