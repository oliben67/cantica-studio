import * as vscode from 'vscode';
import type { CanticaServer } from './types/index.js';

export class ServerItem extends vscode.TreeItem {
  constructor(readonly server: CanticaServer) {
    let host: string;
    try { host = new URL(server.url).host; } catch { host = server.url; }
    super(host, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('server');
    this.description = server.url;
    this.tooltip = server.url;
    this.contextValue = 'server';
  }
}

export class ServersProvider implements vscode.TreeDataProvider<ServerItem> {
  private readonly _evt = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._evt.event;
  private items: ServerItem[] = [];

  update(servers: CanticaServer[]): void {
    this.items = servers.map((s) => new ServerItem(s));
    this._evt.fire();
  }

  getTreeItem(el: ServerItem): vscode.TreeItem {
    return el;
  }

  getChildren(): ServerItem[] {
    return this.items;
  }
}
