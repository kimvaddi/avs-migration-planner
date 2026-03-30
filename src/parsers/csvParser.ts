import { VMInventoryItem, ParseResult } from '../models/vm';

/**
 * Column mapping definitions for supported CSV formats.
 */
interface ColumnMapping {
    name: string[];
    vCPUs: string[];
    memoryGB: string[];
    storageGB: string[];
    os: string[];
    powerState: string[];
    datacenter: string[];
    cluster: string[];
    host: string[];
    networks: string[];
    additionalNetworks: string[];
    dependencyGroup: string[];
    notes: string[];
}

const RVTOOLS_COLUMNS: ColumnMapping = {
    name: ['vm', 'vm name', 'name', 'vmname'],
    vCPUs: ['cpus', 'vcpus', 'num cpu', 'numcpu', 'cpu', 'num cpus'],
    memoryGB: ['memory', 'memory mb', 'memorymb', 'mem mb', 'memory gb', 'memorygb', 'mem'],
    storageGB: ['provisioned mb', 'provisionedmb', 'provisioned mib', 'in use mb', 'in use mib', 'storage', 'storage gb', 'storagegb', 'provisioned gb', 'disk', 'total disk'],
    os: ['os according to the configuration file', 'os', 'guest os', 'guestos', 'os name', 'os type', 'operating system'],
    powerState: ['powerstate', 'power state', 'power', 'state'],
    datacenter: ['datacenter', 'dc', 'data center'],
    cluster: ['cluster', 'cluster name'],
    host: ['host', 'host name', 'hostname', 'esx host'],
    networks: ['network #1', 'network 1', 'network', 'primary network', 'nic 1', 'portgroup'],
    additionalNetworks: ['network #2', 'network #3', 'network #4', 'network 2', 'network 3', 'network 4', 'nic 2', 'nic 3', 'nic 4'],
    dependencyGroup: ['dependency', 'dependency group', 'dep group', 'group', 'app group', 'application group'],
    notes: ['notes', 'annotation', 'description', 'custom notes', 'comment']
};

const STANDARD_COLUMNS: ColumnMapping = {
    name: ['name', 'vm_name', 'vmname', 'server', 'hostname', 'server_name'],
    vCPUs: ['vcpus', 'cpu', 'cpus', 'cores', 'vcpu', 'cpu_count'],
    memoryGB: ['memory_gb', 'memorygb', 'memory', 'ram_gb', 'ram', 'mem_gb'],
    storageGB: ['storage_gb', 'storagegb', 'storage', 'disk_gb', 'disk', 'total_storage'],
    os: ['os', 'operating_system', 'os_type', 'os_name', 'guest_os'],
    powerState: ['power_state', 'powerstate', 'state', 'status'],
    datacenter: ['datacenter', 'dc', 'site', 'location'],
    cluster: ['cluster', 'cluster_name', 'source_cluster'],
    host: ['host', 'hostname', 'esxi_host', 'host_name'],
    networks: ['network', 'networks', 'vlan', 'portgroup', 'subnet'],
    additionalNetworks: ['network_2', 'network_3', 'network_4', 'vlan_2', 'vlan_3'],
    dependencyGroup: ['dependency_group', 'dep_group', 'app_group', 'group'],
    notes: ['notes', 'description', 'comments', 'tags']
};

/**
 * Detect the delimiter used in a CSV string (comma or semicolon).
 * EU locales often use semicolons as the CSV delimiter.
 */
export function detectDelimiter(content: string): ',' | ';' {
    // Check only the first line (header row) for delimiter frequency
    const firstLine = content.split(/[\r\n]/)[0] || '';
    const commaCount = (firstLine.match(/,/g) || []).length;
    const semicolonCount = (firstLine.match(/;/g) || []).length;
    return semicolonCount > commaCount ? ';' : ',';
}

/**
 * Parse a CSV string into an array of string arrays.
 * Handles quoted fields with commas/semicolons and newlines.
 * Auto-detects comma vs semicolon delimiter.
 */
export function parseCSVLines(content: string): string[][] {
    const delimiter = detectDelimiter(content);
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentField = '';
    let inQuotes = false;
    let i = 0;

    while (i < content.length) {
        const char = content[i];

        if (inQuotes) {
            if (char === '"') {
                // Check for escaped quote ""
                if (i + 1 < content.length && content[i + 1] === '"') {
                    currentField += '"';
                    i += 2;
                    continue;
                }
                inQuotes = false;
            } else {
                currentField += char;
            }
        } else {
            if (char === '"') {
                inQuotes = true;
            } else if (char === delimiter) {
                currentRow.push(currentField.trim());
                currentField = '';
            } else if (char === '\n') {
                currentRow.push(currentField.trim());
                if (currentRow.some(f => f.length > 0)) {
                    rows.push(currentRow);
                }
                currentRow = [];
                currentField = '';
            } else if (char === '\r') {
                // Skip carriage return
            } else {
                currentField += char;
            }
        }
        i++;
    }

    // Push last field and row
    if (currentField.length > 0 || currentRow.length > 0) {
        currentRow.push(currentField.trim());
        if (currentRow.some(f => f.length > 0)) {
            rows.push(currentRow);
        }
    }

    return rows;
}

/**
 * Detect whether the CSV is RVTools or standard format.
 */
export function detectFormat(headers: string[]): 'rvtools' | 'standard' | 'unknown' {
    const lowerHeaders = headers.map(h => h.toLowerCase().trim());

    // RVTools typically has "VM", "Powerstate", "CPUs", "Memory", "Provisioned MB"
    const rvtoolsIndicators = ['vm', 'powerstate', 'cpus', 'provisioned mb', 'datacenter'];
    const rvtoolsMatches = rvtoolsIndicators.filter(ind =>
        lowerHeaders.some(h => h === ind || h.includes(ind))
    ).length;

    // Standard format has more normalized column names
    const standardIndicators = ['vcpus', 'memory_gb', 'storage_gb', 'vm_name', 'power_state'];
    const standardMatches = standardIndicators.filter(ind =>
        lowerHeaders.some(h => h === ind || h.includes(ind))
    ).length;

    if (rvtoolsMatches >= 3) {return 'rvtools';}
    if (standardMatches >= 2) {return 'standard';}

    // Fallback: check if we can find at least name + cpu + memory columns
    const hasName = lowerHeaders.some(h =>
        [...RVTOOLS_COLUMNS.name, ...STANDARD_COLUMNS.name].includes(h)
    );
    const hasCpu = lowerHeaders.some(h =>
        [...RVTOOLS_COLUMNS.vCPUs, ...STANDARD_COLUMNS.vCPUs].includes(h)
    );
    const hasMemory = lowerHeaders.some(h =>
        [...RVTOOLS_COLUMNS.memoryGB, ...STANDARD_COLUMNS.memoryGB].includes(h)
    );

    if (hasName && hasCpu && hasMemory) {
        return rvtoolsMatches >= standardMatches ? 'rvtools' : 'standard';
    }

    return 'unknown';
}

/**
 * Find the column index for a field using the column mapping.
 */
function findColumnIndex(headers: string[], possibleNames: string[]): number {
    const lowerHeaders = headers.map(h => h.toLowerCase().trim());
    for (const name of possibleNames) {
        const idx = lowerHeaders.indexOf(name);
        if (idx !== -1) {return idx;}
    }
    // Partial match fallback
    for (const name of possibleNames) {
        const idx = lowerHeaders.findIndex(h => h.includes(name));
        if (idx !== -1) {return idx;}
    }
    return -1;
}

/**
 * Parse a numeric value, handling different formats.
 */
function parseNumeric(value: string): number {
    if (!value || value.trim() === '') {return 0;}
    const cleaned = value.replace(/[,$\s]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
}

/**
 * Normalize power state strings to standard values.
 */
function normalizePowerState(value: string): 'on' | 'off' | 'suspended' | 'unknown' {
    const lower = (value || '').toLowerCase().trim();
    if (lower === 'poweredon' || lower === 'powered on' || lower === 'on' || lower === 'running') {
        return 'on';
    }
    if (lower === 'poweredoff' || lower === 'powered off' || lower === 'off' || lower === 'stopped') {
        return 'off';
    }
    if (lower === 'suspended' || lower === 'paused') {
        return 'suspended';
    }
    return 'unknown';
}

/**
 * Parse a VM inventory CSV file content.
 * Supports RVTools export and standard CSV formats.
 */
export function parseVMInventory(csvContent: string): ParseResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const vms: VMInventoryItem[] = [];

    if (!csvContent || csvContent.trim().length === 0) {
        return { success: false, vms: [], errors: ['CSV content is empty'], warnings: [], format: 'unknown' };
    }

    const rows = parseCSVLines(csvContent);

    if (rows.length < 2) {
        return { success: false, vms: [], errors: ['CSV must have a header row and at least one data row'], warnings: [], format: 'unknown' };
    }

    const headers = rows[0];
    const format = detectFormat(headers);

    if (format === 'unknown') {
        return {
            success: false, vms: [], format: 'unknown',
            errors: ['Unable to detect CSV format. Expected RVTools or standard columns (name, vCPUs/CPUs, memory, storage).'],
            warnings: []
        };
    }

    const mapping = format === 'rvtools' ? RVTOOLS_COLUMNS : STANDARD_COLUMNS;

    // Resolve column indices
    const nameIdx = findColumnIndex(headers, mapping.name);
    const cpuIdx = findColumnIndex(headers, mapping.vCPUs);
    const memIdx = findColumnIndex(headers, mapping.memoryGB);
    const storageIdx = findColumnIndex(headers, mapping.storageGB);
    const osIdx = findColumnIndex(headers, mapping.os);
    const powerIdx = findColumnIndex(headers, mapping.powerState);
    const dcIdx = findColumnIndex(headers, mapping.datacenter);
    const clusterIdx = findColumnIndex(headers, mapping.cluster);
    const hostIdx = findColumnIndex(headers, mapping.host);
    const netIdx = findColumnIndex(headers, mapping.networks);
    const depIdx = findColumnIndex(headers, mapping.dependencyGroup);
    const notesIdx = findColumnIndex(headers, mapping.notes);

    // Find additional network columns (Network #2, #3, #4 for RVTools)
    const additionalNetIdxs: number[] = [];
    if (mapping.additionalNetworks) {
        const lowerHeaders = headers.map(h => h.toLowerCase().trim());
        for (const colName of mapping.additionalNetworks) {
            const idx = lowerHeaders.indexOf(colName);
            if (idx !== -1 && !additionalNetIdxs.includes(idx)) {
                additionalNetIdxs.push(idx);
            }
        }
    }

    if (nameIdx === -1) {
        errors.push('Required column "Name/VM" not found in CSV headers');
    }
    if (cpuIdx === -1) {
        errors.push('Required column "vCPUs/CPUs" not found in CSV headers');
    }
    if (memIdx === -1) {
        errors.push('Required column "Memory" not found in CSV headers');
    }

    if (errors.length > 0) {
        return { success: false, vms: [], errors, warnings, format };
    }

    if (storageIdx === -1) {
        warnings.push('Storage column not found; storage will be set to 0 for all VMs');
    }

    // Detect if memory is in MB (RVTools) or GB
    const isMemoryMB = format === 'rvtools' &&
        headers[memIdx] && headers[memIdx].toLowerCase().includes('mb');

    // Detect if storage is in MB
    const isStorageMB = storageIdx !== -1 && format === 'rvtools' &&
        headers[storageIdx] && (headers[storageIdx].toLowerCase().includes('mb') || headers[storageIdx].toLowerCase().includes('mib'));

    // Parse data rows
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];

        const name = nameIdx < row.length ? row[nameIdx] : '';
        if (!name || name.trim() === '') {
            warnings.push(`Row ${i + 1}: Skipping row with empty VM name`);
            continue;
        }

        let vcpus = cpuIdx < row.length ? parseNumeric(row[cpuIdx]) : 0;
        let memoryGB = memIdx < row.length ? parseNumeric(row[memIdx]) : 0;
        let storageGB = storageIdx !== -1 && storageIdx < row.length ? parseNumeric(row[storageIdx]) : 0;

        // Convert MB to GB if needed
        if (isMemoryMB && memoryGB > 100) {
            memoryGB = Math.round(memoryGB / 1024 * 100) / 100;
        }
        if (isStorageMB && storageGB > 1000) {
            storageGB = Math.round(storageGB / 1024 * 100) / 100;
        }

        if (vcpus <= 0) {
            warnings.push(`Row ${i + 1} (${name}): vCPUs is 0 or invalid, defaulting to 1`);
            vcpus = 1;
        }
        if (memoryGB <= 0) {
            warnings.push(`Row ${i + 1} (${name}): Memory is 0 or invalid`);
        }

        const networkStr = netIdx !== -1 && netIdx < row.length ? row[netIdx] : '';
        const networks = networkStr ? networkStr.split(/[;|]/).map(n => n.trim()).filter(n => n.length > 0) : [];

        // Parse additional network columns (Network #2, #3, #4)
        for (const addNetIdx of additionalNetIdxs) {
            if (addNetIdx < row.length) {
                const addNet = row[addNetIdx].trim();
                if (addNet.length > 0 && !networks.includes(addNet)) {
                    networks.push(addNet);
                }
            }
        }

        const vm: VMInventoryItem = {
            name: name.trim(),
            vCPUs: vcpus,
            memoryGB,
            storageGB,
            os: osIdx !== -1 && osIdx < row.length ? row[osIdx] : 'Unknown',
            powerState: powerIdx !== -1 && powerIdx < row.length ? normalizePowerState(row[powerIdx]) : 'unknown',
            datacenter: dcIdx !== -1 && dcIdx < row.length ? row[dcIdx] : '',
            cluster: clusterIdx !== -1 && clusterIdx < row.length ? row[clusterIdx] : '',
            host: hostIdx !== -1 && hostIdx < row.length ? row[hostIdx] : '',
            networks,
            dependencyGroup: depIdx !== -1 && depIdx < row.length ? row[depIdx] : '',
            notes: notesIdx !== -1 && notesIdx < row.length ? row[notesIdx] : ''
        };

        vms.push(vm);
    }

    return {
        success: vms.length > 0,
        vms,
        errors: vms.length === 0 ? ['No valid VM records found in CSV'] : errors,
        warnings,
        format
    };
}
