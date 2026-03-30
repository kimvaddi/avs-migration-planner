import { VMInventoryItem, InventorySummary } from '../models/vm';

/**
 * Analyze VM inventory and produce a summary.
 * Only considers powered-on VMs for resource requirements by default.
 */
export function analyzeInventory(vms: VMInventoryItem[], includePoweredOff: boolean = false): InventorySummary {
    const relevantVMs = includePoweredOff ? vms : vms.filter(vm => vm.powerState === 'on' || vm.powerState === 'unknown');

    const allNetworks = new Set<string>();
    const allDatacenters = new Set<string>();
    const allClusters = new Set<string>();
    const osSummary: Record<string, number> = {};

    let totalvCPUs = 0;
    let totalMemoryGB = 0;
    let totalStorageGB = 0;

    for (const vm of relevantVMs) {
        totalvCPUs += vm.vCPUs;
        totalMemoryGB += vm.memoryGB;
        totalStorageGB += vm.storageGB;

        for (const net of vm.networks) {
            if (net) {allNetworks.add(net);}
        }
        if (vm.datacenter) {allDatacenters.add(vm.datacenter);}
        if (vm.cluster) {allClusters.add(vm.cluster);}

        const osKey = normalizeOSName(vm.os);
        osSummary[osKey] = (osSummary[osKey] || 0) + 1;
    }

    return {
        totalVMs: vms.length,
        poweredOnVMs: vms.filter(vm => vm.powerState === 'on').length,
        poweredOffVMs: vms.filter(vm => vm.powerState === 'off').length,
        totalvCPUs,
        totalMemoryGB: Math.round(totalMemoryGB * 100) / 100,
        totalStorageGB: Math.round(totalStorageGB * 100) / 100,
        uniqueNetworks: Array.from(allNetworks).sort(),
        uniqueDatacenters: Array.from(allDatacenters).sort(),
        uniqueClusters: Array.from(allClusters).sort(),
        osSummary
    };
}

/**
 * Normalize OS names into categories for summary.
 */
function normalizeOSName(os: string): string {
    const lower = (os || '').toLowerCase();
    if (lower.includes('windows server 2022')) {return 'Windows Server 2022';}
    if (lower.includes('windows server 2019')) {return 'Windows Server 2019';}
    if (lower.includes('windows server 2016')) {return 'Windows Server 2016';}
    if (lower.includes('windows server 2012')) {return 'Windows Server 2012';}
    if (lower.includes('windows server')) {return 'Windows Server (Other)';}
    if (lower.includes('windows 1') || lower.includes('windows 11')) {return 'Windows Desktop';}
    if (lower.includes('ubuntu')) {return 'Ubuntu Linux';}
    if (lower.includes('centos')) {return 'CentOS Linux';}
    if (lower.includes('red hat') || lower.includes('rhel')) {return 'RHEL';}
    if (lower.includes('suse') || lower.includes('sles')) {return 'SUSE Linux';}
    if (lower.includes('debian')) {return 'Debian Linux';}
    if (lower.includes('oracle linux')) {return 'Oracle Linux';}
    if (lower.includes('linux')) {return 'Linux (Other)';}
    if (!os || os.trim() === '' || lower === 'unknown') {return 'Unknown';}
    return os;
}

/**
 * Calculate required resources with a configurable overhead buffer.
 * Default 20% buffer for CPU/memory headroom, 25% for storage.
 */
export function calculateRequirements(
    summary: InventorySummary,
    cpuBuffer: number = 0.20,
    memoryBuffer: number = 0.20,
    storageBuffer: number = 0.25
): { requiredVCPUs: number; requiredMemoryGB: number; requiredStorageGB: number } {
    // Use toFixed(2) before ceiling to avoid floating-point precision errors
    // e.g., 100 * 1.1 = 110.00000000000001 in JS, causing ceil to return 111
    return {
        requiredVCPUs: Math.ceil(parseFloat((summary.totalvCPUs * (1 + cpuBuffer)).toFixed(2))),
        requiredMemoryGB: Math.ceil(parseFloat((summary.totalMemoryGB * (1 + memoryBuffer)).toFixed(2))),
        requiredStorageGB: Math.ceil(parseFloat((summary.totalStorageGB * (1 + storageBuffer)).toFixed(2)))
    };
}
