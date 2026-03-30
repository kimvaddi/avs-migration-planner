import { VMInventoryItem } from '../models/vm';
import { MigrationWave, MigrationWavePlan, NetworkExtension } from '../models/migrationPlan';

/**
 * Configuration for wave planning.
 * 
 * Throughput research notes (VMware HCX 4.10 Configuration Maximums):
 * 
 * | Type    | Concurrency        | Throughput factor                        |
 * |---------|--------------------|------------------------------------------|
 * | Bulk    | 300/mgr, 200/IX    | Network-bound: 850Mbps-1.65Gbps per flow |
 * | vMotion | 1/service mesh     | Single stream: ~50-100 GB/hr             |
 * | RAV     | 300/mgr, 200/IX    | Parallel replication + zero-downtime     |
 * | Cold    | 1/service mesh     | NFC protocol, queued after vMotion       |
 * 
 * Network Extension: 4-6+ Gbps per NE appliance.
 * 
 * Real-world throughput depends on: ExpressRoute bandwidth (1/10 Gbps),
 * WAN latency, MTU, vSAN I/O, changed block rate, compression.
 * 
 * Conservative planning defaults (assuming 1 Gbps ExpressRoute):
 * - Bulk/RAV (parallel, multiple VMs):    ~100 GB/hr aggregate
 * - vMotion (single VM, serial):          ~50 GB/hr per VM
 * - Cold:                                 ~75 GB/hr per VM
 * 
 * With 10 Gbps ExpressRoute, multiply by ~5-8×.
 */
export interface WavePlannerConfig {
    /** Maximum VMs per wave */
    maxVMsPerWave: number;
    /** Maximum vCPUs per wave (concurrent migration load) */
    maxVCPUsPerWave: number;
    /** Maximum storage per wave in GB */
    maxStoragePerWaveGB: number;
    /** Days between wave starts */
    daysBetweenWaves: number;
    /**
     * Aggregate GB/hour throughput for the entire wave (all VMs in parallel).
     * Default: 100 GB/hr (conservative, assumes 1 Gbps ExpressRoute with overhead).
     * For 10 Gbps ExpressRoute: use 500-800 GB/hr.
     */
    waveThroughputGBPerHour: number;
    /**
     * ExpressRoute bandwidth tier. Affects throughput estimation.
     */
    expressRouteBandwidth: '1gbps' | '10gbps';
}

const DEFAULT_CONFIG: WavePlannerConfig = {
    maxVMsPerWave: 25,
    maxVCPUsPerWave: 200,
    maxStoragePerWaveGB: 5000,
    daysBetweenWaves: 3,
    waveThroughputGBPerHour: 100,
    expressRouteBandwidth: '1gbps'
};

/**
 * Generate a migration wave plan from VM inventory.
 * Groups VMs by dependency, then fills waves up to capacity limits.
 */
export function generateWavePlan(
    vms: VMInventoryItem[],
    config: Partial<WavePlannerConfig> = {}
): MigrationWavePlan {
    const cfg = { ...DEFAULT_CONFIG, ...config };

    // Filter to powered-on VMs only
    const activeVMs = vms.filter(vm => vm.powerState === 'on' || vm.powerState === 'unknown');

    if (activeVMs.length === 0) {
        return { waves: [], totalVMs: 0, totalWaves: 0, estimatedTotalDays: 0, networkExtensions: [] };
    }

    // Step 1: Group VMs by dependency (explicit → network-based → individual)
    const depGroups = groupByDependency(activeVMs);

    // Step 2: Sort groups by infrastructure tier priority, then by size.
    // Infrastructure tiers should migrate before application tiers:
    //   Tier 0: Infrastructure (DNS, AD, DHCP, NTP) — migrate first
    //   Tier 1: Database / data tier — migrate before app servers
    //   Tier 2: Application / middleware tier
    //   Tier 3: Web / frontend tier — migrate last (depends on app + db)
    //   Tier 9: Ungrouped / unknown
    const sortedGroups = Array.from(depGroups.entries())
        .sort((a, b) => {
            const tierA = inferTierPriority(a[0], a[1]);
            const tierB = inferTierPriority(b[0], b[1]);
            if (tierA !== tierB) {return tierA - tierB;} // Lower tier = earlier wave
            return b[1].length - a[1].length; // Then by size (largest first for packing)
        });

    // Step 3: Bin-pack groups into waves respecting capacity limits
    const waves: MigrationWave[] = [];
    let waveNumber = 1;

    // Track which dependency groups are in which waves (for dependency tracking)
    const groupWaveMap = new Map<string, number>();

    for (const [groupName, groupVMs] of sortedGroups) {
        // If the group itself exceeds wave limits, split it into sub-chunks
        const chunks = splitGroupIfNeeded(groupVMs, cfg);

        for (const chunk of chunks) {
            // Try to fit into an existing wave
            let placed = false;

            for (const wave of waves) {
                if (canFitInWave(wave, chunk, cfg)) {
                    addVMsToWave(wave, chunk);
                    groupWaveMap.set(groupName, wave.waveNumber);
                    placed = true;
                    break;
                }
            }

            if (!placed) {
                // Create new wave
                const wave = createWave(waveNumber, chunk, cfg);
                waves.push(wave);
                groupWaveMap.set(groupName, waveNumber);
                waveNumber++;
            }
        }
    }

    // Step 4: Calculate wave dependencies and timing
    finalizePlan(waves, cfg);

    // Step 5: Build network extensions list
    const networkExtensions = buildNetworkExtensions(waves);

    // Step 6: Assign risk levels
    for (const wave of waves) {
        wave.riskLevel = assessWaveRisk(wave);
    }

    return {
        waves,
        totalVMs: activeVMs.length,
        totalWaves: waves.length,
        estimatedTotalDays: waves.length > 0
            ? waves[waves.length - 1].startDayOffset + Math.ceil(waves[waves.length - 1].estimatedDurationHours / 24) + 1
            : 0,
        networkExtensions
    };
}

/**
 * Group VMs by dependency using a 3-tier strategy:
 * 
 * 1. **Explicit dependency group** — If a VM has a `dependencyGroup` value,
 *    all VMs with that same value are grouped together. This is the highest
 *    fidelity signal (from Azure Migrate, ServiceNow, or manual tagging).
 * 
 * 2. **Network-based grouping (fallback)** — VMs without an explicit group
 *    are grouped by their primary network. VMs on the same network are likely
 *    part of the same application tier and should migrate together to minimize
 *    cross-network dependencies during cutover.
 * 
 * 3. **Individual (last resort)** — VMs with no group AND no network each
 *    get their own single-VM bucket.
 */
function groupByDependency(vms: VMInventoryItem[]): Map<string, VMInventoryItem[]> {
    const groups = new Map<string, VMInventoryItem[]>();
    let ungroupedCounter = 0;

    // Separate VMs into explicitly grouped vs ungrouped
    const explicitlyGrouped: VMInventoryItem[] = [];
    const ungrouped: VMInventoryItem[] = [];

    for (const vm of vms) {
        if (vm.dependencyGroup && vm.dependencyGroup.trim().length > 0) {
            explicitlyGrouped.push(vm);
        } else {
            ungrouped.push(vm);
        }
    }

    // Tier 1: Explicit dependency groups
    for (const vm of explicitlyGrouped) {
        const key = `dep:${vm.dependencyGroup.trim()}`;
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key)!.push(vm);
    }

    // Tier 2: Network-based grouping for ungrouped VMs
    // Only apply if there are multiple ungrouped VMs sharing networks
    const networkBuckets = new Map<string, VMInventoryItem[]>();
    const noNetwork: VMInventoryItem[] = [];

    for (const vm of ungrouped) {
        const primaryNetwork = vm.networks.length > 0 ? vm.networks[0] : '';
        if (primaryNetwork) {
            if (!networkBuckets.has(primaryNetwork)) {
                networkBuckets.set(primaryNetwork, []);
            }
            networkBuckets.get(primaryNetwork)!.push(vm);
        } else {
            noNetwork.push(vm);
        }
    }

    // Add network groups — only group if 2+ VMs share a network
    for (const [network, netVMs] of networkBuckets) {
        if (netVMs.length >= 2) {
            const key = `net:${network}`;
            groups.set(key, netVMs);
        } else {
            // Single VM on a network — treat as individual
            noNetwork.push(netVMs[0]);
        }
    }

    // Tier 3: Individual VMs (no dependency, no shared network)
    for (const vm of noNetwork) {
        groups.set(`_individual_${ungroupedCounter++}`, [vm]);
    }

    return groups;
}

/**
 * Split a group of VMs into wave-sized chunks if the group exceeds wave limits.
 * This handles the case where a network group or large dependency group has
 * more VMs than can fit in a single wave.
 */
function splitGroupIfNeeded(vms: VMInventoryItem[], cfg: WavePlannerConfig): VMInventoryItem[][] {
    // Check if the group fits in one wave
    const totalVCPUs = vms.reduce((sum, vm) => sum + vm.vCPUs, 0);
    const totalStorage = vms.reduce((sum, vm) => sum + vm.storageGB, 0);

    if (vms.length <= cfg.maxVMsPerWave &&
        totalVCPUs <= cfg.maxVCPUsPerWave &&
        totalStorage <= cfg.maxStoragePerWaveGB) {
        return [vms]; // Fits in one wave
    }

    // Split into chunks that fit within wave limits
    const chunks: VMInventoryItem[][] = [];
    let currentChunk: VMInventoryItem[] = [];
    let chunkVCPUs = 0;
    let chunkStorage = 0;

    for (const vm of vms) {
        const wouldExceed =
            currentChunk.length + 1 > cfg.maxVMsPerWave ||
            chunkVCPUs + vm.vCPUs > cfg.maxVCPUsPerWave ||
            chunkStorage + vm.storageGB > cfg.maxStoragePerWaveGB;

        if (wouldExceed && currentChunk.length > 0) {
            chunks.push(currentChunk);
            currentChunk = [];
            chunkVCPUs = 0;
            chunkStorage = 0;
        }

        currentChunk.push(vm);
        chunkVCPUs += vm.vCPUs;
        chunkStorage += vm.storageGB;
    }

    if (currentChunk.length > 0) {
        chunks.push(currentChunk);
    }

    return chunks;
}

/**
 * Check if a group of VMs can fit in an existing wave.
 */
function canFitInWave(wave: MigrationWave, newVMs: VMInventoryItem[], cfg: WavePlannerConfig): boolean {
    const newVCPUs = newVMs.reduce((sum, vm) => sum + vm.vCPUs, 0);
    const newStorage = newVMs.reduce((sum, vm) => sum + vm.storageGB, 0);
    const newCount = newVMs.length;

    return (
        wave.vms.length + newCount <= cfg.maxVMsPerWave &&
        wave.totalVCPUs + newVCPUs <= cfg.maxVCPUsPerWave &&
        wave.totalStorageGB + newStorage <= cfg.maxStoragePerWaveGB
    );
}

/**
 * Add VMs to an existing wave.
 */
function addVMsToWave(wave: MigrationWave, newVMs: VMInventoryItem[]): void {
    wave.vms.push(...newVMs);
    wave.totalVCPUs += newVMs.reduce((sum, vm) => sum + vm.vCPUs, 0);
    wave.totalMemoryGB += newVMs.reduce((sum, vm) => sum + vm.memoryGB, 0);
    wave.totalStorageGB += newVMs.reduce((sum, vm) => sum + vm.storageGB, 0);

    // Update required networks
    const netSet = new Set(wave.requiredNetworks);
    for (const vm of newVMs) {
        for (const net of vm.networks) {
            netSet.add(net);
        }
    }
    wave.requiredNetworks = Array.from(netSet);
}

/**
 * Create a new wave with the given VMs.
 */
function createWave(waveNumber: number, vms: VMInventoryItem[], cfg: WavePlannerConfig): MigrationWave {
    const networks = new Set<string>();
    for (const vm of vms) {
        for (const net of vm.networks) {
            networks.add(net);
        }
    }

    const totalStorageGB = vms.reduce((sum, vm) => sum + vm.storageGB, 0);

    // Wave duration = total storage / aggregate wave throughput.
    // Throughput is for the entire wave (all VMs replicating in parallel via Bulk/RAV).
    // Add 2 hours switchover buffer per wave for final sync + cutover.
    const replicationHours = totalStorageGB > 0
        ? Math.ceil(totalStorageGB / cfg.waveThroughputGBPerHour)
        : 0;
    const switchoverBufferHours = 2;
    const estimatedHours = Math.max(1, replicationHours + switchoverBufferHours);

    return {
        waveNumber,
        name: `Wave ${waveNumber}`,
        vms: [...vms],
        totalVCPUs: vms.reduce((sum, vm) => sum + vm.vCPUs, 0),
        totalMemoryGB: vms.reduce((sum, vm) => sum + vm.memoryGB, 0),
        totalStorageGB,
        requiredNetworks: Array.from(networks),
        estimatedDurationHours: estimatedHours,
        startDayOffset: 0,
        dependsOn: [],
        riskLevel: 'low'
    };
}

/**
 * Finalize wave plan: set start offsets and dependencies.
 */
function finalizePlan(waves: MigrationWave[], cfg: WavePlannerConfig): void {
    for (let i = 0; i < waves.length; i++) {
        waves[i].startDayOffset = i * cfg.daysBetweenWaves;

        // Each wave depends on the previous one completing
        if (i > 0) {
            waves[i].dependsOn = [waves[i - 1].waveNumber];
        }
    }
}

/**
 * Build network extensions list from all waves.
 */
function buildNetworkExtensions(waves: MigrationWave[]): NetworkExtension[] {
    const netMap = new Map<string, { vmCount: number; waves: Set<number> }>();

    for (const wave of waves) {
        for (const vm of wave.vms) {
            for (const net of vm.networks) {
                if (!netMap.has(net)) {
                    netMap.set(net, { vmCount: 0, waves: new Set() });
                }
                const info = netMap.get(net)!;
                info.vmCount++;
                info.waves.add(wave.waveNumber);
            }
        }
    }

    return Array.from(netMap.entries())
        .map(([network, info]) => ({
            sourceNetwork: network,
            vmCount: info.vmCount,
            requiredByWaves: Array.from(info.waves).sort((a, b) => a - b)
        }))
        .sort((a, b) => b.vmCount - a.vmCount);
}

/**
 * Assess risk level for a wave.
 */
function assessWaveRisk(wave: MigrationWave): 'low' | 'medium' | 'high' {
    // High risk: many VMs, large storage, or many networks
    if (wave.vms.length > 20 || wave.totalStorageGB > 4000 || wave.requiredNetworks.length > 5) {
        return 'high';
    }
    // Medium risk: moderate counts
    if (wave.vms.length > 10 || wave.totalStorageGB > 2000 || wave.requiredNetworks.length > 3) {
        return 'medium';
    }
    return 'low';
}

/**
 * Infer infrastructure tier priority from group name and VM names.
 * Lower number = migrates earlier (infrastructure before application before web).
 */
function inferTierPriority(groupKey: string, vms: VMInventoryItem[]): number {
    const lower = groupKey.toLowerCase();
    const vmNames = vms.map(v => v.name.toLowerCase()).join(' ');
    const combined = lower + ' ' + vmNames;

    // Tier 0: Infrastructure (DNS, AD, DHCP, NTP, domain controllers)
    if (/\b(infra|infrastructure|dns|ad\b|dhcp|ntp|dc\b|domain|ldap|pki|cert)\b/.test(combined)) {
        return 0;
    }
    // Tier 1: Data tier (databases, storage, file servers, SQL, Oracle, Mongo)
    if (/\b(db|database|data|sql|oracle|mongo|mysql|postgres|redis|cache|storage|file.?server|nas|san)\b/.test(combined)) {
        return 1;
    }
    // Tier 2: Application / middleware (app servers, API, message queues)
    if (/\b(app|api|middleware|mq|rabbit|kafka|queue|service|backend|logic|worker)\b/.test(combined)) {
        return 2;
    }
    // Tier 3: Web / frontend (web servers, load balancers, reverse proxies)
    if (/\b(web|frontend|front|www|nginx|apache|iis|lb|load.?bal|proxy|gateway|cdn)\b/.test(combined)) {
        return 3;
    }
    // Tier 4: Monitoring / management (monitoring, logging, SIEM)
    if (/\b(monitor|log|siem|grafana|prometheus|nagios|zabbix|splunk|mgmt|manage)\b/.test(combined)) {
        return 4;
    }
    // Tier 9: Unknown / ungrouped
    return 9;
}

/**
 * Export wave plan as human-readable text.
 */
export function exportWavePlanText(plan: MigrationWavePlan): string {
    const lines: string[] = [];

    lines.push('=== Migration Wave Plan ===');
    lines.push(`Total VMs: ${plan.totalVMs}`);
    lines.push(`Total Waves: ${plan.totalWaves}`);
    lines.push(`Estimated Duration: ${plan.estimatedTotalDays} days`);
    lines.push(`Network Extensions: ${plan.networkExtensions.length}`);
    lines.push('');
    lines.push('Assumptions: 100 GB/hr aggregate throughput (1 Gbps ExpressRoute), 2hr switchover buffer per wave.');
    lines.push('For 10 Gbps ExpressRoute, divide durations by ~5-8×. See HCX 4.10 Config Maximums for details.');
    lines.push('');

    for (const wave of plan.waves) {
        lines.push(`--- ${wave.name} ---`);
        lines.push(`  Risk Level: ${wave.riskLevel.toUpperCase()}`);
        lines.push(`  Start: Day ${wave.startDayOffset}`);
        lines.push(`  Duration: ~${wave.estimatedDurationHours} hours`);
        lines.push(`  VMs: ${wave.vms.length} (${wave.totalVCPUs} vCPUs, ${Math.round(wave.totalMemoryGB)} GB RAM, ${Math.round(wave.totalStorageGB)} GB storage)`);
        if (wave.dependsOn.length > 0) {
            lines.push(`  Depends on: Wave ${wave.dependsOn.join(', Wave ')}`);
        }
        lines.push(`  Networks: ${wave.requiredNetworks.join(', ') || 'none'}`);
        lines.push(`  VM List:`);
        for (const vm of wave.vms) {
            lines.push(`    - ${vm.name} (${vm.vCPUs} vCPU, ${vm.memoryGB} GB RAM, ${vm.storageGB} GB disk)`);
        }
        lines.push('');
    }

    return lines.join('\n');
}

/**
 * Export wave plan as CSV for Excel/Sheets/PM tools.
 */
export function exportWavePlanCSV(plan: MigrationWavePlan): string {
    const rows: string[] = [];

    // Header row
    rows.push('Wave,Wave Name,Risk Level,Start Day,Est. Duration (hrs),VM Name,vCPUs,Memory (GB),Storage (GB),OS,Network,Dependency Group,Depends On Wave');

    for (const wave of plan.waves) {
        for (const vm of wave.vms) {
            rows.push([
                wave.waveNumber,
                csvEscape(wave.name),
                wave.riskLevel,
                wave.startDayOffset,
                wave.estimatedDurationHours,
                csvEscape(vm.name),
                vm.vCPUs,
                vm.memoryGB,
                vm.storageGB,
                csvEscape(vm.os),
                csvEscape(vm.networks.join('; ')),
                csvEscape(vm.dependencyGroup),
                wave.dependsOn.join('; ')
            ].join(','));
        }
    }

    return rows.join('\n');
}

/**
 * Escape a value for CSV output.
 */
function csvEscape(value: string): string {
    if (!value) {return '';}
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return '"' + value.replace(/"/g, '""') + '"';
    }
    return value;
}
