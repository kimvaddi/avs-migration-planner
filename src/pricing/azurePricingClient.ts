import * as https from 'https';

/**
 * Live Azure Retail Prices API client for AVS node pricing.
 * Uses the public API at prices.azure.com (no auth required).
 * 
 * Based on: https://github.com/kimvaddi/awesome-copilot/tree/main/skills/azure-pricing
 * API docs: https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices
 */

const API_BASE = 'https://prices.azure.com/api/retail/prices';
const API_VERSION = '2023-01-01-preview';

/**
 * Raw pricing item from the Azure Retail Prices API.
 */
export interface AzurePriceItem {
    retailPrice: number;
    unitPrice: number;
    unitOfMeasure: string;
    skuName: string;
    meterName: string;
    productName: string;
    serviceName: string;
    armRegionName: string;
    priceType: string;
    isPrimaryMeterRegion: boolean;
    reservationTerm?: string;
}

/**
 * Resolved AVS node pricing for a specific region.
 */
export interface AVSLivePricing {
    region: string;
    fetchedAt: string;
    source: 'live-api' | 'fallback-defaults';
    nodes: {
        skuName: string;
        displayName: string;
        hourlyRate: number;
        monthlyRate: number;
        ri1YearMonthly?: number;
        ri3YearMonthly?: number;
    }[];
}

/**
 * SKU mapping: API skuName → our node type.
 * The API uses different naming for standard vs VCF BYOL SKUs.
 */
const SKU_MAP: Record<string, { nodeType: string; displayName: string }> = {
    // Standard (non-VCF) SKUs - rare in API
    'AV36': { nodeType: 'AV36', displayName: 'AV36 (Standard)' },
    'AV36P': { nodeType: 'AV36P', displayName: 'AV36P (Performance)' },
    'AV52': { nodeType: 'AV52', displayName: 'AV52 (High Performance)' },
    // VCF BYOL SKUs - widely available in API, same hardware
    'AV36P VCF BYOL': { nodeType: 'AV36P', displayName: 'AV36P (Performance)' },
    'AV52 VCF BYOL': { nodeType: 'AV52', displayName: 'AV52 (High Performance)' },
    'AV36 VCF BYOL': { nodeType: 'AV36', displayName: 'AV36 (Standard)' },
    'AV48 VCF BYOL': { nodeType: 'AV48', displayName: 'AV48 (VCF)' },
    'AV64 VCF BYOL': { nodeType: 'AV64', displayName: 'AV64 (VCF)' },
};

/**
 * Fetch AVS node pricing from the Azure Retail Prices API.
 * Falls back to hardcoded defaults on failure.
 */
export async function fetchAVSPricing(region: string = 'eastus'): Promise<AVSLivePricing> {
    try {
        const items = await queryPricingAPI(region);
        const nodes = processResults(items, region);

        if (nodes.length > 0) {
            return {
                region,
                fetchedAt: new Date().toISOString(),
                source: 'live-api',
                nodes
            };
        }
    } catch (err) {
        console.warn('AVS Pricing API fetch failed, using fallback defaults:', (err as Error).message);
    }

    // Fallback to hardcoded defaults
    return getFallbackPricing(region);
}

/**
 * Query the Azure Retail Prices API with pagination support.
 */
async function queryPricingAPI(region: string): Promise<AzurePriceItem[]> {
    const filter = `contains(productName, 'VMware') and armRegionName eq '${region}'`;
    const encoded = encodeURIComponent(filter);
    const url = `${API_BASE}?api-version=${API_VERSION}&$filter=${encoded}`;

    const allItems: AzurePriceItem[] = [];

    let pageUrl: string | null = url;
    let pages = 0;
    const maxPages = 5; // Safety limit

    while (pageUrl && pages < maxPages) {
        const response = await httpGet(pageUrl);
        const json = JSON.parse(response);

        if (json.Items) {
            allItems.push(...json.Items);
        }

        pageUrl = json.NextPageLink || null;
        pages++;
    }

    return allItems;
}

/**
 * Process API results into our pricing format.
 * Prioritizes: standard SKU > VCF BYOL (same hardware, different licensing).
 */
function processResults(items: AzurePriceItem[], region: string): AVSLivePricing['nodes'] {
    const nodeMap = new Map<string, {
        hourlyRate: number;
        displayName: string;
        ri1YearTotal?: number;
        ri3YearTotal?: number;
    }>();

    for (const item of items) {
        if (item.retailPrice <= 0 || !item.isPrimaryMeterRegion) {
            continue;
        }
        if (item.skuName.includes('Trial')) {
            continue;
        }

        const mapping = SKU_MAP[item.skuName];
        if (!mapping) {
            continue;
        }

        const nodeType = mapping.nodeType;

        // Hourly consumption prices (< $50/hr as safety check)
        if (item.retailPrice < 50 && (!item.priceType || item.priceType === 'Consumption')) {
            const existing = nodeMap.get(nodeType);
            if (!existing) {
                nodeMap.set(nodeType, {
                    hourlyRate: item.retailPrice,
                    displayName: mapping.displayName
                });
            } else if (!item.skuName.includes('VCF') && existing.hourlyRate) {
                // Prefer standard SKU over VCF BYOL
                existing.hourlyRate = item.retailPrice;
            }
        }

        // Reservation prices (large numbers = total for term)
        if (item.retailPrice > 1000 && item.priceType === 'Reservation') {
            const existing = nodeMap.get(nodeType) || { hourlyRate: 0, displayName: mapping.displayName };
            if (item.reservationTerm === '1 Year' || (item.retailPrice > 30000 && item.retailPrice < 120000)) {
                existing.ri1YearTotal = item.retailPrice;
            }
            if (item.reservationTerm === '3 Years' || item.retailPrice > 120000) {
                existing.ri3YearTotal = item.retailPrice;
            }
            nodeMap.set(nodeType, existing);
        }
    }

    return Array.from(nodeMap.entries()).map(([type, data]) => {
        const monthly = Math.round(data.hourlyRate * 730);
        return {
            skuName: type,
            displayName: data.displayName,
            hourlyRate: data.hourlyRate,
            monthlyRate: monthly,
            ri1YearMonthly: data.ri1YearTotal ? Math.round(data.ri1YearTotal / 12) : undefined,
            ri3YearMonthly: data.ri3YearTotal ? Math.round(data.ri3YearTotal / 36) : undefined
        };
    }).filter(n => n.hourlyRate > 0);
}

/**
 * Fallback pricing when API is unavailable.
 * DISCLAIMER: These are approximate reference prices and may be outdated.
 */
function getFallbackPricing(region: string): AVSLivePricing {
    return {
        region,
        fetchedAt: new Date().toISOString(),
        source: 'fallback-defaults',
        nodes: [
            {
                skuName: 'AV36',
                displayName: 'AV36 (Standard)',
                hourlyRate: 14.68,
                monthlyRate: 10720,
                ri1YearMonthly: 7504,
                ri3YearMonthly: 5360
            },
            {
                skuName: 'AV36P',
                displayName: 'AV36P (Performance)',
                hourlyRate: 17.62,
                monthlyRate: 12864,
                ri1YearMonthly: 9005,
                ri3YearMonthly: 6432
            },
            {
                skuName: 'AV52',
                displayName: 'AV52 (High Performance)',
                hourlyRate: 25.78,
                monthlyRate: 18816,
                ri1YearMonthly: 13171,
                ri3YearMonthly: 9408
            },
            {
                skuName: 'AV48',
                displayName: 'AV48 (Gen 2 - ESA)',
                hourlyRate: 21.89,
                monthlyRate: 15979,
                ri1YearMonthly: 11185,
                ri3YearMonthly: 7990
            },
            {
                skuName: 'AV64',
                displayName: 'AV64 (Gen 2)',
                hourlyRate: 22.89,
                monthlyRate: 16714,
                ri1YearMonthly: 11700,
                ri3YearMonthly: 8357
            }
        ]
    };
}

/**
 * Simple HTTPS GET returning body as string.
 */
function httpGet(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Request timeout (10s)')), 10000);

        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk: string) => data += chunk);
            res.on('end', () => {
                clearTimeout(timeout);
                if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(data);
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
                }
            });
            res.on('error', (err: Error) => {
                clearTimeout(timeout);
                reject(err);
            });
        }).on('error', (err: Error) => {
            clearTimeout(timeout);
            reject(err);
        });
    });
}

/**
 * Get available AVS regions from the pricing API.
 */
export async function getAVSAvailableRegions(): Promise<string[]> {
    try {
        const filter = "contains(productName, 'VMware') and isPrimaryMeterRegion eq true";
        const encoded = encodeURIComponent(filter);
        const url = `${API_BASE}?api-version=${API_VERSION}&$filter=${encoded}`;

        const response = await httpGet(url);
        const json = JSON.parse(response);

        const regions = new Set<string>();
        for (const item of json.Items || []) {
            if (item.retailPrice > 0 && item.armRegionName) {
                regions.add(item.armRegionName);
            }
        }
        return Array.from(regions).sort();
    } catch {
        // Fallback common AVS regions
        return [
            'eastus', 'eastus2', 'westus2', 'westus3', 'centralus', 'southcentralus',
            'northcentralus', 'westeurope', 'northeurope', 'uksouth', 'ukwest',
            'germanywestcentral', 'francecentral', 'switzerlandnorth',
            'canadacentral', 'canadaeast', 'australiaeast', 'australiasoutheast',
            'japaneast', 'japanwest', 'southeastasia', 'eastasia',
            'brazilsouth', 'uaenorth', 'southafricanorth'
        ];
    }
}
