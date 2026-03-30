import { VMInventoryItem } from '../models/vm';
import { HCXConfiguration, HCXMobilityGroup, NetworkExtension } from '../models/migrationPlan';
import { MigrationWave } from '../models/migrationPlan';

/**
 * Generate HCX mobility groups from migration waves.
 * Each wave becomes one or more mobility groups, split by network.
 */
export function generateHCXConfiguration(waves: MigrationWave[]): HCXConfiguration {
    const mobilityGroups: HCXMobilityGroup[] = [];
    const networkMap = new Map<string, { vmCount: number; waves: Set<number> }>();

    for (const wave of waves) {
        // Group VMs in this wave by their primary network
        const networkGroups = new Map<string, VMInventoryItem[]>();

        for (const vm of wave.vms) {
            const primaryNetwork = vm.networks.length > 0 ? vm.networks[0] : 'default-network';

            if (!networkGroups.has(primaryNetwork)) {
                networkGroups.set(primaryNetwork, []);
            }
            networkGroups.get(primaryNetwork)!.push(vm);

            // Track all networks
            for (const net of vm.networks) {
                if (!networkMap.has(net)) {
                    networkMap.set(net, { vmCount: 0, waves: new Set() });
                }
                const info = networkMap.get(net)!;
                info.vmCount++;
                info.waves.add(wave.waveNumber);
            }

            // Also track primary if vm has no networks
            if (vm.networks.length === 0) {
                if (!networkMap.has('default-network')) {
                    networkMap.set('default-network', { vmCount: 0, waves: new Set() });
                }
                const info = networkMap.get('default-network')!;
                info.vmCount++;
                info.waves.add(wave.waveNumber);
            }
        }

        // Create a mobility group for each network within the wave
        for (const [network, vms] of networkGroups) {
            const groupName = `MG-Wave${wave.waveNumber}-${sanitizeName(network)}`;
            const targetSegment = `NSX-${sanitizeName(network)}`;

            // Determine migration type based on VM count and size
            const totalStorageGB = vms.reduce((sum, vm) => sum + vm.storageGB, 0);
            const migrationType = determineMigrationType(vms.length, totalStorageGB);

            mobilityGroups.push({
                name: groupName,
                vmNames: vms.map(vm => vm.name),
                migrationType,
                sourceNetwork: network,
                targetSegment,
                switchoverWindow: `Wave ${wave.waveNumber} - ${wave.name}`
            });
        }
    }

    // Build network extensions list
    const networkExtensions: NetworkExtension[] = [];
    for (const [network, info] of networkMap) {
        networkExtensions.push({
            sourceNetwork: network,
            vmCount: info.vmCount,
            requiredByWaves: Array.from(info.waves).sort((a, b) => a - b)
        });
    }

    return {
        mobilityGroups,
        networkExtensions: networkExtensions.sort((a, b) => b.vmCount - a.vmCount),
        totalMigrations: mobilityGroups.reduce((sum, mg) => sum + mg.vmNames.length, 0)
    };
}

/**
 * Determine migration type based on VM count and storage.
 */
function determineMigrationType(vmCount: number, totalStorageGB: number): 'bulk' | 'vMotion' | 'cold' {
    // vMotion: few VMs, minimal downtime needed
    if (vmCount <= 5 && totalStorageGB < 500) {
        return 'vMotion';
    }
    // Bulk: many VMs or large storage
    if (vmCount > 5 || totalStorageGB >= 500) {
        return 'bulk';
    }
    return 'bulk';
}

/**
 * Sanitize a name for use in identifiers.
 */
function sanitizeName(name: string): string {
    return name.replace(/[^a-zA-Z0-9-_]/g, '-').replace(/-+/g, '-').substring(0, 50);
}

/**
 * Generate HCX configuration as JSON string.
 */
export function exportHCXConfigJSON(config: HCXConfiguration): string {
    return JSON.stringify(config, null, 2);
}

/**
 * Generate HCX configuration as human-readable text.
 */
export function exportHCXConfigText(config: HCXConfiguration): string {
    const lines: string[] = [];

    lines.push('=== HCX Migration Configuration ===');
    lines.push(`Total Mobility Groups: ${config.mobilityGroups.length}`);
    lines.push(`Total VM Migrations: ${config.totalMigrations}`);
    lines.push(`Network Extensions Required: ${config.networkExtensions.length}`);
    lines.push('');

    lines.push('--- Network Extensions ---');
    for (const ext of config.networkExtensions) {
        lines.push(`  ${ext.sourceNetwork}: ${ext.vmCount} VMs (Waves: ${ext.requiredByWaves.join(', ')})`);
    }
    lines.push('');

    lines.push('--- Mobility Groups ---');
    for (const mg of config.mobilityGroups) {
        lines.push(`  Group: ${mg.name}`);
        lines.push(`    Type: ${mg.migrationType}`);
        lines.push(`    Source Network: ${mg.sourceNetwork}`);
        lines.push(`    Target Segment: ${mg.targetSegment}`);
        lines.push(`    VMs (${mg.vmNames.length}): ${mg.vmNames.join(', ')}`);
        lines.push(`    Window: ${mg.switchoverWindow}`);
        lines.push('');
    }

    return lines.join('\n');
}
