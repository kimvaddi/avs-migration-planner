import {
    AVSNodeSpec,
    AVS_NODE_SPECS,
    AVS_CLUSTER_MIN_NODES,
    AVS_CLUSTER_MAX_NODES,
    ClusterRecommendation,
    SizingResult,
    SizingConfig,
    DEFAULT_SIZING_CONFIG,
    calculateUsableStorage,
    calculateUsableMemory,
    calculateUsableVCPUs
} from '../models/avsNode';

/**
 * Calculate the number of nodes required for a given resource requirement and node type.
 * Uses the provided SizingConfig for overcommit ratios, storage policy, etc.
 * Returns node count plus the driving dimension.
 */
export function calculateNodesRequired(
    requiredVCPUs: number,
    requiredMemoryGB: number,
    requiredStorageTB: number,
    nodeSpec: AVSNodeSpec,
    config: SizingConfig = DEFAULT_SIZING_CONFIG
): { nodes: number; drivingDimension: 'CPU' | 'Memory' | 'Storage' } {
    const usableVCPUs = calculateUsableVCPUs(nodeSpec.cpuCores, config);
    const usableMemGB = calculateUsableMemory(nodeSpec.ramGB, config);
    const usableStorTB = calculateUsableStorage(nodeSpec.rawStorageTB, config);

    const nodesByCPU = Math.ceil(parseFloat((requiredVCPUs / usableVCPUs).toFixed(2)));
    const nodesByMemory = Math.ceil(parseFloat((requiredMemoryGB / usableMemGB).toFixed(2)));
    const nodesByStorage = requiredStorageTB > 0
        ? Math.ceil(parseFloat((requiredStorageTB / usableStorTB).toFixed(2)))
        : 0;

    const rawMax = Math.max(nodesByCPU, nodesByMemory, nodesByStorage);
    let drivingDimension: 'CPU' | 'Memory' | 'Storage' = 'CPU';
    if (rawMax === nodesByMemory && rawMax > nodesByCPU) {
        drivingDimension = 'Memory';
    } else if (rawMax === nodesByStorage && rawMax > nodesByCPU && rawMax > nodesByMemory) {
        drivingDimension = 'Storage';
    } else {
        drivingDimension = 'CPU';
    }

    // Add N+1 HA node if enabled
    let total = rawMax;
    if (config.enableHANode) {
        total = rawMax + 1;
    }

    // Minimum is 3 nodes (AVS cluster minimum)
    return {
        nodes: Math.max(total, AVS_CLUSTER_MIN_NODES),
        drivingDimension
    };
}

/**
 * Distribute nodes across clusters.
 * Each cluster must have between MIN and MAX nodes.
 */
export function distributeNodesToClusters(totalNodes: number): number[] {
    if (totalNodes <= AVS_CLUSTER_MAX_NODES) {
        return [totalNodes];
    }

    const clusters: number[] = [];
    let remaining = totalNodes;

    while (remaining > 0) {
        if (remaining <= AVS_CLUSTER_MAX_NODES) {
            // If remaining fits in one cluster and meets minimum
            if (remaining >= AVS_CLUSTER_MIN_NODES) {
                clusters.push(remaining);
            } else {
                // Redistribute: take nodes from previous cluster
                if (clusters.length > 0) {
                    const prevCluster = clusters[clusters.length - 1];
                    const totalForTwo = prevCluster + remaining;
                    const half = Math.ceil(totalForTwo / 2);
                    clusters[clusters.length - 1] = half;
                    clusters.push(totalForTwo - half);
                } else {
                    // Edge case: very few nodes, just make one cluster
                    clusters.push(remaining);
                }
            }
            remaining = 0;
        } else {
            // Fill a cluster with MAX nodes
            clusters.push(AVS_CLUSTER_MAX_NODES);
            remaining -= AVS_CLUSTER_MAX_NODES;
        }
    }

    return clusters;
}

/**
 * Generate a cluster recommendation for a specific node type.
 */
function generateRecommendation(
    requiredVCPUs: number,
    requiredMemoryGB: number,
    requiredStorageGB: number,
    nodeSpec: AVSNodeSpec,
    config: SizingConfig
): ClusterRecommendation {
    const requiredStorageTB = requiredStorageGB / 1024;

    const { nodes: nodesRequired, drivingDimension } = calculateNodesRequired(
        requiredVCPUs,
        requiredMemoryGB,
        requiredStorageTB,
        nodeSpec,
        config
    );

    const nodesPerCluster = distributeNodesToClusters(nodesRequired);

    const usableVCPUsPerNode = calculateUsableVCPUs(nodeSpec.cpuCores, config);
    const usableMemPerNode = calculateUsableMemory(nodeSpec.ramGB, config);
    const usableStorPerNode = calculateUsableStorage(nodeSpec.rawStorageTB, config);

    const totalUsableVCPUs = nodesRequired * usableVCPUsPerNode;
    const totalUsableRamGB = parseFloat((nodesRequired * usableMemPerNode).toFixed(2));
    const totalUsableStorageTB = parseFloat((nodesRequired * usableStorPerNode).toFixed(2));

    const utilizationCpu = totalUsableVCPUs > 0
        ? Math.round((requiredVCPUs / totalUsableVCPUs) * 100)
        : 0;
    const utilizationMemory = totalUsableRamGB > 0
        ? Math.round((requiredMemoryGB / totalUsableRamGB) * 100)
        : 0;
    const utilizationStorage = totalUsableStorageTB > 0
        ? Math.round((requiredStorageTB / totalUsableStorageTB) * 100)
        : 0;

    // Score: higher utilization = better fit, but penalize over-commitment
    // Ideal is 60-80% utilization. Under 40% wastes money. Over 90% is risky.
    const cpuScore = scoreUtilization(utilizationCpu);
    const memScore = scoreUtilization(utilizationMemory);
    const storScore = requiredStorageGB > 0 ? scoreUtilization(utilizationStorage) : 70; // neutral if no storage
    const fitScore = Math.round((cpuScore + memScore + storScore) / 3);

    return {
        nodeType: nodeSpec,
        nodesRequired,
        clustersRequired: nodesPerCluster.length,
        nodesPerCluster,
        totalUsableVCPUs,
        totalUsableRamGB,
        totalUsableStorageTB,
        utilizationCpu,
        utilizationMemory,
        utilizationStorage,
        fitScore,
        drivingDimension,
        includesHANode: config.enableHANode
    };
}

/**
 * Score a utilization percentage (0-100).
 * Sweet spot: 50-80% → high score. Too low = waste. Too high = risk.
 */
function scoreUtilization(utilization: number): number {
    if (utilization >= 50 && utilization <= 80) {
        return 90 + (10 * (1 - Math.abs(utilization - 65) / 15));
    }
    if (utilization > 80 && utilization <= 90) {
        return 80;
    }
    if (utilization > 90) {
        return 60;
    }
    if (utilization >= 30 && utilization < 50) {
        return 70;
    }
    // Below 30%
    return 50;
}

/**
 * Generate sizing recommendations for all AVS node types.
 * Returns sorted recommendations with best fit first.
 * Accepts optional SizingConfig for overcommit/storage parameters.
 */
export function generateSizingRecommendations(
    requiredVCPUs: number,
    requiredMemoryGB: number,
    requiredStorageGB: number,
    config: SizingConfig = DEFAULT_SIZING_CONFIG
): SizingResult {
    const recommendations: ClusterRecommendation[] = AVS_NODE_SPECS.map(spec =>
        generateRecommendation(requiredVCPUs, requiredMemoryGB, requiredStorageGB, spec, config)
    );

    // Sort by fit score descending, then by node count ascending (prefer fewer nodes)
    recommendations.sort((a, b) => {
        if (b.fitScore !== a.fitScore) {return b.fitScore - a.fitScore;}
        return a.nodesRequired - b.nodesRequired;
    });

    return {
        requiredVCPUs,
        requiredMemoryGB,
        requiredStorageGB,
        sizingConfig: config,
        recommendations,
        bestFit: recommendations[0]
    };
}
