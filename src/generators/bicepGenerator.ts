import { ClusterRecommendation } from '../models/avsNode';
import { NetworkExtension } from '../models/migrationPlan';

export interface BicepTemplateParams {
    /** Azure region for deployment */
    location: string;
    /** Private cloud name */
    privateCloudName: string;
    /** Resource group name */
    resourceGroupName: string;
    /** Management CIDR block (/22) */
    managementCIDR: string;
    /** The cluster recommendation to use */
    recommendation: ClusterRecommendation;
    /** Network extensions for NSX-T segments */
    networkExtensions: NetworkExtension[];
    /** ExpressRoute authorization key (optional) */
    expressRouteAuthKey?: string;
    /** On-premises ExpressRoute circuit ID (optional) */
    onPremExpressRouteId?: string;
}

/**
 * Generate a Bicep template for AVS Private Cloud deployment.
 */
export function generateBicepTemplate(params: BicepTemplateParams): string {
    const {
        location,
        privateCloudName,
        managementCIDR,
        recommendation,
        networkExtensions
    } = params;

    const nodeType = recommendation.nodeType.type;
    const clusterSize = recommendation.nodesPerCluster[0] || 3;

    const segments = networkExtensions.map((ext, idx) => {
        const segmentName = `segment-${sanitizeBicepName(ext.sourceNetwork)}`;
        const gatewayAddress = `10.${100 + idx}.1.1/24`;
        const dhcpRange = `10.${100 + idx}.1.100-10.${100 + idx}.1.200`;
        return { segmentName, sourceNetwork: ext.sourceNetwork, gatewayAddress, dhcpRange, idx };
    });

    const lines: string[] = [];

    lines.push(`// ============================================================`);
    lines.push(`// AVS Migration Planner - Auto-Generated Bicep Template`);
    lines.push(`// Generated: ${new Date().toISOString().split('T')[0]}`);
    lines.push(`// ============================================================`);
    lines.push(``);
    lines.push(`targetScope = 'resourceGroup'`);
    lines.push(``);

    // Parameters
    lines.push(`// --- Parameters ---`);
    lines.push(`@description('Azure region for the AVS Private Cloud')`);
    lines.push(`param location string = '${location}'`);
    lines.push(``);
    lines.push(`@description('Name of the AVS Private Cloud')`);
    lines.push(`param privateCloudName string = '${privateCloudName}'`);
    lines.push(``);
    lines.push(`@description('Management network CIDR (/22 required)')`);
    lines.push(`param managementCIDR string = '${managementCIDR}'`);
    lines.push(``);
    lines.push(`@description('Number of nodes in the initial cluster')`);
    lines.push(`@minValue(3)`);
    lines.push(`@maxValue(16)`);
    lines.push(`param clusterSize int = ${clusterSize}`);
    lines.push(``);
    lines.push(`@description('AVS node SKU')`);
    lines.push(`param skuName string = '${nodeType}'`);
    lines.push(``);

    if (params.onPremExpressRouteId) {
        lines.push(`@description('On-premises ExpressRoute circuit resource ID for Global Reach')`);
        lines.push(`param onPremExpressRouteId string = '${params.onPremExpressRouteId}'`);
        lines.push(``);
        lines.push(`@description('ExpressRoute authorization key for Global Reach peering')`);
        lines.push(`@secure()`);
        lines.push(`param expressRouteAuthKey string`);
        lines.push(``);
    }

    // AVS Private Cloud resource
    lines.push(`// --- AVS Private Cloud ---`);
    lines.push(`resource avsPrivateCloud 'Microsoft.AVS/privateClouds@2023-09-01' = {`);
    lines.push(`  name: privateCloudName`);
    lines.push(`  location: location`);
    lines.push(`  sku: {`);
    lines.push(`    name: skuName`);
    lines.push(`  }`);
    lines.push(`  properties: {`);
    lines.push(`    networkBlock: managementCIDR`);
    lines.push(`    managementCluster: {`);
    lines.push(`      clusterSize: clusterSize`);
    lines.push(`    }`);
    lines.push(`    internet: 'Disabled'`);
    lines.push(`  }`);
    lines.push(`}`);
    lines.push(``);

    // Additional clusters if needed
    if (recommendation.nodesPerCluster.length > 1) {
        for (let i = 1; i < recommendation.nodesPerCluster.length; i++) {
            const clusterName = `cluster-${i + 1}`;
            lines.push(`// --- Additional Cluster ${i + 1} ---`);
            lines.push(`resource ${clusterName.replace(/-/g, '_')} 'Microsoft.AVS/privateClouds/clusters@2023-09-01' = {`);
            lines.push(`  parent: avsPrivateCloud`);
            lines.push(`  name: '${clusterName}'`);
            lines.push(`  sku: {`);
            lines.push(`    name: skuName`);
            lines.push(`  }`);
            lines.push(`  properties: {`);
            lines.push(`    clusterSize: ${recommendation.nodesPerCluster[i]}`);
            lines.push(`  }`);
            lines.push(`}`);
            lines.push(``);
        }
    }

    // ExpressRoute authorization
    lines.push(`// --- ExpressRoute Authorization ---`);
    lines.push(`resource expressRouteAuth 'Microsoft.AVS/privateClouds/authorizations@2023-09-01' = {`);
    lines.push(`  parent: avsPrivateCloud`);
    lines.push(`  name: 'er-auth-onprem'`);
    lines.push(`}`);
    lines.push(``);

    // Global Reach peering (if on-prem ER provided)
    if (params.onPremExpressRouteId) {
        lines.push(`// --- ExpressRoute Global Reach Peering ---`);
        lines.push(`resource globalReach 'Microsoft.AVS/privateClouds/globalReachConnections@2023-09-01' = {`);
        lines.push(`  parent: avsPrivateCloud`);
        lines.push(`  name: 'globalreach-onprem'`);
        lines.push(`  properties: {`);
        lines.push(`    authorizationKey: expressRouteAuthKey`);
        lines.push(`    peerExpressRouteCircuit: onPremExpressRouteId`);
        lines.push(`  }`);
        lines.push(`}`);
        lines.push(``);
    }

    // NSX-T Segments
    if (segments.length > 0) {
        lines.push(`// --- NSX-T Workload Segments ---`);
        for (const seg of segments) {
            const resourceName = `segment_${seg.idx}`;
            lines.push(`resource ${resourceName} 'Microsoft.AVS/privateClouds/workloadNetworks/segments@2023-09-01' = {`);
            lines.push(`  parent: avsPrivateCloud::defaultWorkloadNetwork`);
            lines.push(`  name: '${seg.segmentName}'`);
            lines.push(`  properties: {`);
            lines.push(`    displayName: '${seg.segmentName}'`);
            lines.push(`    connectedGateway: '/infra/tier-1s/TNT*-T1'`);
            lines.push(`    subnet: {`);
            lines.push(`      gatewayAddress: '${seg.gatewayAddress}'`);
            lines.push(`      dhcpRanges: [`);
            lines.push(`        '${seg.dhcpRange}'`);
            lines.push(`      ]`);
            lines.push(`    }`);
            lines.push(`  }`);
            lines.push(`}`);
            lines.push(``);
        }

        // Default workload network reference
        lines.push(`resource defaultWorkloadNetwork 'Microsoft.AVS/privateClouds/workloadNetworks@2023-09-01' existing = {`);
        lines.push(`  parent: avsPrivateCloud`);
        lines.push(`  name: 'default'`);
        lines.push(`}`);
        lines.push(``);
    }

    // Outputs
    lines.push(`// --- Outputs ---`);
    lines.push(`output privateCloudId string = avsPrivateCloud.id`);
    lines.push(`output privateCloudName string = avsPrivateCloud.name`);
    lines.push(`output managementClusterHosts int = avsPrivateCloud.properties.managementCluster.clusterSize`);
    lines.push(`output vcenterUrl string = 'https://\${avsPrivateCloud.properties.endpoints.vcsa}/ui'`);
    lines.push(`output nsxManagerUrl string = 'https://\${avsPrivateCloud.properties.endpoints.nsxtManager}'`);
    lines.push(`output hcxCloudManagerUrl string = 'https://\${avsPrivateCloud.properties.endpoints.hcxCloudManager}'`);

    return lines.join('\n');
}

/**
 * Sanitize a name for use in Bicep resource names.
 */
function sanitizeBicepName(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 50);
}

/**
 * Generate a parameters file for the Bicep template.
 */
export function generateBicepParameters(params: BicepTemplateParams): string {
    const paramValues: Record<string, { value: string | number }> = {
        location: { value: params.location },
        privateCloudName: { value: params.privateCloudName },
        managementCIDR: { value: params.managementCIDR },
        clusterSize: { value: params.recommendation.nodesPerCluster[0] || 3 },
        skuName: { value: params.recommendation.nodeType.type }
    };

    if (params.onPremExpressRouteId) {
        paramValues['onPremExpressRouteId'] = { value: params.onPremExpressRouteId };
    }

    const paramFile = {
        '$schema': 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#',
        contentVersion: '1.0.0.0',
        parameters: paramValues
    };

    return JSON.stringify(paramFile, null, 2);
}
