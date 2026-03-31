/**
 * AVS regional availability and SKU support matrix.
 * Data sourced from AVS Calculator v4.04 Hidden - Regional Support sheet.
 */

export interface AVSRegionInfo {
    /** Azure region identifier (display name) */
    region: string;
    /** Whether stretched clusters are supported in this region */
    supportsStretchedCluster: boolean;
    /** Whether Gen 2 (AV64, AV48) nodes are supported */
    supportsGen2: boolean;
}

/**
 * Regional availability matrix for AVS.
 * Regions that support AVS deployments.
 */
export const AVS_REGION_AVAILABILITY: AVSRegionInfo[] = [
    { region: 'AE North', supportsStretchedCluster: false, supportsGen2: false },
    { region: 'AP East', supportsStretchedCluster: false, supportsGen2: false },
    { region: 'AP Southeast', supportsStretchedCluster: false, supportsGen2: false },
    { region: 'AU East', supportsStretchedCluster: true, supportsGen2: false },
    { region: 'AU Southeast', supportsStretchedCluster: false, supportsGen2: false },
    { region: 'BE Central', supportsStretchedCluster: false, supportsGen2: true },
    { region: 'BR South', supportsStretchedCluster: false, supportsGen2: false },
    { region: 'CA Central', supportsStretchedCluster: false, supportsGen2: true },
    { region: 'CA East', supportsStretchedCluster: false, supportsGen2: true },
    { region: 'CH North', supportsStretchedCluster: false, supportsGen2: false },
    { region: 'CH West', supportsStretchedCluster: false, supportsGen2: true },
    { region: 'CL Central', supportsStretchedCluster: false, supportsGen2: false },
    { region: 'DE West Central', supportsStretchedCluster: true, supportsGen2: false },
    { region: 'EU North', supportsStretchedCluster: false, supportsGen2: true },
    { region: 'EU West', supportsStretchedCluster: true, supportsGen2: false },
    { region: 'FR Central', supportsStretchedCluster: false, supportsGen2: false },
    { region: 'IN Central', supportsStretchedCluster: false, supportsGen2: false },
    { region: 'IT North', supportsStretchedCluster: false, supportsGen2: false },
    { region: 'JA East', supportsStretchedCluster: false, supportsGen2: false },
    { region: 'JA West', supportsStretchedCluster: false, supportsGen2: false },
    { region: 'KR Central', supportsStretchedCluster: false, supportsGen2: false },
    { region: 'MX Central', supportsStretchedCluster: false, supportsGen2: false },
    { region: 'QA Central', supportsStretchedCluster: false, supportsGen2: false },
    { region: 'SE Central', supportsStretchedCluster: false, supportsGen2: false },
    { region: 'UK South', supportsStretchedCluster: true, supportsGen2: false },
    { region: 'UK West', supportsStretchedCluster: false, supportsGen2: true },
    { region: 'US Central', supportsStretchedCluster: false, supportsGen2: false },
    { region: 'US East', supportsStretchedCluster: true, supportsGen2: true },
    { region: 'US East 2', supportsStretchedCluster: false, supportsGen2: false },
    { region: 'US Gov AZ', supportsStretchedCluster: false, supportsGen2: false },
    { region: 'US Gov Virginia', supportsStretchedCluster: false, supportsGen2: false },
    { region: 'US North Central', supportsStretchedCluster: false, supportsGen2: false },
    { region: 'US South Central', supportsStretchedCluster: false, supportsGen2: false },
    { region: 'US West', supportsStretchedCluster: false, supportsGen2: false },
    { region: 'US West 2', supportsStretchedCluster: false, supportsGen2: false },
    { region: 'US West 3', supportsStretchedCluster: false, supportsGen2: false },
    { region: 'ZA North', supportsStretchedCluster: false, supportsGen2: false },
];

/**
 * ARM region name to display name mapping for pricing API compatibility.
 */
export const ARM_REGION_MAP: Record<string, string> = {
    'eastus': 'US East',
    'eastus2': 'US East 2',
    'westus': 'US West',
    'westus2': 'US West 2',
    'westus3': 'US West 3',
    'centralus': 'US Central',
    'northcentralus': 'US North Central',
    'southcentralus': 'US South Central',
    'uksouth': 'UK South',
    'ukwest': 'UK West',
    'northeurope': 'EU North',
    'westeurope': 'EU West',
    'swedencentral': 'SE Central',
    'germanywestcentral': 'DE West Central',
    'francecentral': 'FR Central',
    'switzerlandnorth': 'CH North',
    'switzerlandwest': 'CH West',
    'australiaeast': 'AU East',
    'australiasoutheast': 'AU Southeast',
    'japaneast': 'JA East',
    'japanwest': 'JA West',
    'koreacentral': 'KR Central',
    'southeastasia': 'AP Southeast',
    'eastasia': 'AP East',
    'centralindia': 'IN Central',
    'brazilsouth': 'BR South',
    'canadacentral': 'CA Central',
    'canadaeast': 'CA East',
    'southafricanorth': 'ZA North',
    'uaenorth': 'AE North',
    'qatarcentral': 'QA Central',
    'italynorth': 'IT North',
    'belgiumcentral': 'BE Central',
    'mexicocentral': 'MX Central',
    'chilecentral': 'CL Central',
    'usgovarizona': 'US Gov AZ',
    'usgovvirginia': 'US Gov Virginia',
};

/**
 * Get region info by ARM region name or display name.
 * Returns undefined if the region is not found.
 */
export function getRegionInfo(regionInput: string): AVSRegionInfo | undefined {
    const displayName = ARM_REGION_MAP[regionInput.toLowerCase()] || regionInput;
    return AVS_REGION_AVAILABILITY.find(r =>
        r.region.toLowerCase() === displayName.toLowerCase()
    );
}

/**
 * Check which AVS node types are available in a given region.
 * Gen 1 nodes (AV36, AV36P, AV52) are available in all AVS regions.
 * Gen 2 nodes (AV48, AV64) require supportsGen2 = true.
 */
export function getAvailableNodeTypes(regionInput: string): string[] {
    const info = getRegionInfo(regionInput);
    if (!info) {
        // Region not found — assume Gen 1 only (safe default)
        return ['AV36', 'AV36P', 'AV52'];
    }

    const types = ['AV36', 'AV36P', 'AV52'];
    if (info.supportsGen2) {
        types.push('AV48', 'AV64');
    }
    return types;
}
