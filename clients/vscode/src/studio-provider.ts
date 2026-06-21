import * as vscode from 'vscode';

export type StudioHealth = 'healthy' | 'starting' | 'down';

export interface StudioInfo {
  mode: 'local' | 'remote';
  url: string;
  version?: string;
  uptimeSeconds?: number;
  workspace?: string;
  containerized?: boolean;
}

function _formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.floor(seconds)}s`;
}

function _detail(label: string, value: string, icon: string): vscode.TreeItem {
  const item = new vscode.TreeItem(label);
  item.description = value;
  item.iconPath = new vscode.ThemeIcon(icon);
  item.collapsibleState = vscode.TreeItemCollapsibleState.None;
  return item;
}

function _separator(id: string): vscode.TreeItem {
  const item = new vscode.TreeItem('');
  item.id = id;
  // TreeItemKind.Separator was added in VS Code 1.75; guard against older runtimes.
  const separatorKind = (vscode as unknown as Record<string, Record<string, number>>)['TreeItemKind']?.['Separator'];
  if (separatorKind !== undefined) (item as unknown as Record<string, number>)['kind'] = separatorKind;
  return item;
}

export class StudioProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly _onChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onChange.event;

  private _status: StudioHealth = 'down';
  private _info: StudioInfo | undefined;
  private _setupDone = false;
  private _items: vscode.TreeItem[] = [];

  setStatus(status: StudioHealth, info?: StudioInfo): void {
    this._status = status;
    this._info = info;
    this._items = this._build();
    this._onChange.fire();
  }

  setSetupDone(done: boolean): void {
    this._setupDone = done;
    this._items = this._build();
    this._onChange.fire();
  }

  getTreeItem(el: vscode.TreeItem): vscode.TreeItem { return el; }

  getChildren(): vscode.TreeItem[] { return this._items; }

  private _build(): vscode.TreeItem[] {
    const studioMode = vscode.workspace.getConfiguration('canticaScores').get<string>('studioMode', 'local');
    const isLocal = studioMode === 'local';

    const status = new vscode.TreeItem('Studio Server');
    status.description = this._status === 'healthy' ? 'healthy'
      : this._status === 'starting' ? 'starting…'
      : 'not running';
    status.iconPath = this._status === 'healthy'
      ? new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('terminal.ansiGreen'))
      : this._status === 'starting'
      ? new vscode.ThemeIcon('loading~spin', new vscode.ThemeColor('terminal.ansiYellow'))
      : new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('testing.iconFailed'));
    status.contextValue = `studioStatus.${this._status}`;
    status.collapsibleState = vscode.TreeItemCollapsibleState.None;
    if (this._status === 'down') {
      status.command = { command: 'canticaScores.startLocalStudio', title: 'Start Studio API', arguments: [] };
    }

    const items: vscode.TreeItem[] = [status];

    if (this._status === 'healthy' && this._info) {
      const info = this._info;
      if (info.mode === 'remote') {
        items.push(_detail('Location', 'remote', 'remote'));
      } else if (info.containerized) {
        items.push(_detail('Location', 'local', 'server'));
        items.push(_detail('Runtime', 'container', 'package'));
      } else {
        items.push(_detail('Location', 'local', 'server'));
        items.push(_detail('Runtime', 'native', 'terminal'));
      }
      items.push(_detail('URL', info.url, 'link'));
      if (info.version !== undefined) {
        items.push(_detail('Version', info.version, 'tag'));
      }
      if (info.uptimeSeconds !== undefined) {
        items.push(_detail('Uptime', _formatUptime(info.uptimeSeconds), 'clock'));
      }
      if (info.workspace) {
        items.push(_detail('Workspace', info.workspace, 'folder'));
      }
    }

    if (isLocal) {
      items.push(_separator('studio-actions-sep'));

      const configure = new vscode.TreeItem('Configure Providers');
      configure.iconPath = new vscode.ThemeIcon('wrench');
      configure.command = { command: 'canticaScores.configureProviderKeys', title: 'Configure Providers', arguments: [] };
      configure.collapsibleState = vscode.TreeItemCollapsibleState.None;
      items.push(configure);

      const setup = new vscode.TreeItem('Setup Studio');
      setup.iconPath = new vscode.ThemeIcon('gear');
      setup.command = { command: 'canticaScores.setupStudio', title: 'Setup Studio', arguments: [] };
      setup.collapsibleState = vscode.TreeItemCollapsibleState.None;
      items.push(setup);
    }

    return items;
  }
}
