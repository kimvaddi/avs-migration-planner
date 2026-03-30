const https = require('https');

const filter = "contains(productName, 'VMware')";
const encoded = encodeURIComponent(filter);
const url = `https://prices.azure.com/api/retail/prices?api-version=2023-01-01-preview&$filter=${encoded}`;

console.log('Searching ALL VMware pricing (all regions, all types)...\n');

function fetchPage(pageUrl, allItems) {
    https.get(pageUrl, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
            const json = JSON.parse(data);
            const items = (json.Items || []).filter(item =>
                item.retailPrice > 0 &&
                item.retailPrice < 50 &&
                !item.skuName.includes('Trial') &&
                item.isPrimaryMeterRegion === true
            );
            allItems.push(...items);

            if (json.NextPageLink) {
                fetchPage(json.NextPageLink, allItems);
            } else {
                console.log(`Total hourly-priced items: ${allItems.length}\n`);
                const bySku = {};
                allItems.forEach(i => {
                    if (!bySku[i.skuName]) { bySku[i.skuName] = []; }
                    bySku[i.skuName].push({ region: i.armRegionName, hourly: i.retailPrice, monthly: Math.round(i.retailPrice * 730) });
                });
                for (const [sku, prices] of Object.entries(bySku).sort()) {
                    console.log(`${sku} (${prices.length} regions): ${prices.slice(0, 3).map(p => `${p.region}=$${p.hourly}/hr($${p.monthly}/mo)`).join(', ')}${prices.length > 3 ? '...' : ''}`);
                }
            }
        });
    }).on('error', (e) => console.error('Error:', e.message));
}

fetchPage(url, []);
