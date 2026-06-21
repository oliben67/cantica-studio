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

class PanelItem extends vscode.TreeItem {
  constructor(label: string, readonly children: vscode.TreeItem[]) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
  }
}

export class StudioProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly _onChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onChange.event;

  private _status: StudioHealth = 'down';
  private _info: StudioInfo | undefined;
  private _roots: vscode.TreeItem[] = [];

  constructor(private readonly extensionUri: vscode.Uri) {}

  setStatus(status: StudioHealth, info?: StudioInfo): void {
    this._status = status;
    this._info = info;
    this._roots = this._build();
    this._onChange.fire();
  }

  getTreeItem(el: vscode.TreeItem): vscode.TreeItem { return el; }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (element instanceof PanelItem) return element.children;
    return this._roots;
  }

  private _icon(name: string): vscode.Uri {
    return vscode.Uri.joinPath(this.extensionUri, 'icons', name);
  }

  private _build(): vscode.TreeItem[] {
    const studioMode = vscode.workspace.getConfiguration('canticaScores').get<string>('studioMode', 'local');
    const isLocal = studioMode === 'local';
    const roots: vscode.TreeItem[] = [];

    // ── Status panel ──────────────────────────────────────────────────────────
    const statusChildren: vscode.TreeItem[] = [];

    const statusItem = new vscode.TreeItem('Studio Server');
    statusItem.description = this._status === 'healthy' ? 'healthy'
      : this._status === 'starting' ? 'starting…'
      : 'not running';
    statusItem.iconPath = this._status === 'healthy'
      ? new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('terminal.ansiGreen'))
      : this._status === 'starting'
      ? new vscode.ThemeIcon('loading~spin', new vscode.ThemeColor('terminal.ansiYellow'))
      : new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('testing.iconFailed'));
    statusItem.contextValue = `studioStatus.${this._status}`;
    statusItem.collapsibleState = vscode.TreeItemCollapsibleState.None;
    if (this._status === 'down') {
      statusItem.command = { command: 'canticaScores.startLocalStudio', title: 'Start Studio API', arguments: [] };
    }
    statusChildren.push(statusItem);

    if (this._status === 'healthy' && this._info) {
      const info = this._info;
      if (info.mode === 'remote') {
        statusChildren.push(_detail('Location', 'remote', 'remote'));
      } else if (info.containerized) {
        statusChildren.push(_detail('Location', 'local', 'server'));
        statusChildren.push(_detail('Runtime', 'container', 'package'));
      } else {
        statusChildren.push(_detail('Location', 'local', 'server'));
        statusChildren.push(_detail('Runtime', 'native', 'terminal'));
      }
      statusChildren.push(_detail('URL', info.url, 'link'));
      if (info.version !== undefined) {
        statusChildren.push(_detail('Version', info.version, 'tag'));
      }
      if (info.uptimeSeconds !== undefined) {
        statusChildren.push(_detail('Uptime', _formatUptime(info.uptimeSeconds), 'clock'));
      }
      if (info.workspace) {
        statusChildren.push(_detail('Workspace', info.workspace, 'folder'));
      }
    }

    roots.push(new PanelItem('Status', statusChildren));

    // Spacer between panels
    const spacer = new vscode.TreeItem('');
    spacer.collapsibleState = vscode.TreeItemCollapsibleState.None;
    roots.push(spacer);

    // ── Configuration panel ───────────────────────────────────────────────────
    if (isLocal) {
      const configChildren: vscode.TreeItem[] = [];

      const configure = new vscode.TreeItem('Configure Cantica Studio');
      configure.iconPath = this._icon('service.svg');
      configure.command = { command: 'canticaScores.configureServer', title: 'Configure Cantica Studio', arguments: [] };
      configure.collapsibleState = vscode.TreeItemCollapsibleState.None;
      configChildren.push(configure);

      const setup = new vscode.TreeItem('Run Setup');
      setup.iconPath = this._icon('automation.svg');
      setup.command = { command: 'canticaScores.setupStudio', title: 'Run Setup', arguments: [] };
      setup.collapsibleState = vscode.TreeItemCollapsibleState.None;
      configChildren.push(setup);

      const providers = new vscode.TreeItem('Configure Providers');
      providers.iconPath = new vscode.ThemeIcon('wrench');
      providers.command = { command: 'canticaScores.configureProviderKeys', title: 'Configure Providers', arguments: [] };
      providers.collapsibleState = vscode.TreeItemCollapsibleState.None;
      configChildren.push(providers);

      roots.push(new PanelItem('Configuration', configChildren));
    }

    return roots;
  }
}
