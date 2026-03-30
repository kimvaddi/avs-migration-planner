import * as vscode from 'vscode';
import { VMInventoryItem } from '../models/vm';

/**
 * Tree data provider for the VM Inventory sidebar view.
 */
export class VMInventoryTreeProvider implements vscode.TreeDataProvider<VMTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<VMTreeItem | undefined | null> = new vscode.EventEmitter<VMTreeItem | undefined | null>();
    readonly onDidChangeTreeData: vscode.Event<VMTreeItem | undefined | null> = this._onDidChangeTreeData.event;

    private _vms: VMInventoryItem[] = [];

    setVMs(vms: VMInventoryItem[]): void {
        this._vms = vms;
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: VMTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: VMTreeItem): VMTreeItem[] {
        if (!element) {
            // Root level: group by datacenter
            const datacenters = new Map<string, VMInventoryItem[]>();
            for (const vm of this._vms) {
                const dc = vm.datacenter || 'Unknown';
                if (!datacenters.has(dc)) {datacenters.set(dc, []);}
                datacenters.get(dc)!.push(vm);
            }

            if (datacenters.size === 0) {
                return [new VMTreeItem('No VMs imported', '', vscode.TreeItemCollapsibleState.None)];
            }

            return Array.from(datacenters.entries()).map(([dc, vms]) =>
                new VMTreeItem(
                    `${dc} (${vms.length} VMs)`,
                    'datacenter',
                    vscode.TreeItemCollapsibleState.Expanded,
                    undefined,
                    dc
                )
            );
        }

        if (element.contextType === 'datacenter') {
            const dcVMs = this._vms.filter(vm => (vm.datacenter || 'Unknown') === element.dcKey);
            return dcVMs.map(vm => {
                const stateIcon = vm.powerState === 'on' ? '$(vm-running)' : '$(vm)';
                const label = `${vm.name}`;
                const desc = `${vm.vCPUs} vCPU | ${vm.memoryGB} GB RAM | ${vm.storageGB} GB`;
                const item = new VMTreeItem(
                    label,
                    'vm',
                    vscode.TreeItemCollapsibleState.None,
                    desc
                );
                item.iconPath = new vscode.ThemeIcon(vm.powerState === 'on' ? 'vm-running' : 'vm');
                item.tooltip = `${vm.name}\nOS: ${vm.os}\nCPU: ${vm.vCPUs} vCPUs\nMemory: ${vm.memoryGB} GB\nStorage: ${vm.storageGB} GB\nPower: ${vm.powerState}\nNetwork: ${vm.networks.join(', ')}`;
                return item;
            });
        }

        return [];
    }
}

export class VMTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly contextType: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        description?: string,
        public readonly dcKey?: string
    ) {
        super(label, collapsibleState);
        this.description = description;
    }
}

/**
 * Tree data provider for the Recommendations sidebar view.
 */
export class RecommendationsTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null> = new vscode.EventEmitter<vscode.TreeItem | undefined | null>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null> = this._onDidChangeTreeData.event;

    private _items: vscode.TreeItem[] = [];

    setItems(items: vscode.TreeItem[]): void {
        this._items = items;
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(): vscode.TreeItem[] {
        if (this._items.length === 0) {
            const empty = new vscode.TreeItem('Import a CSV to see recommendations');
            return [empty];
        }
        return this._items;
    }
}
