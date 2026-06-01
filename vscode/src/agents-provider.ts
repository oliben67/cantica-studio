import * as vscode from 'vscode';
import type { CanticaNamespace, CanticaPrompt, CanticaServer } from './types/index.js';

type ItemKind = 'section' | 'graph' | 'server' | 'namespace' | 'agent';

export class AgentItem extends vscode.TreeItem {
  readonly kind: ItemKind;
  readonly value: string | undefined;
  readonly ns: string | undefined;

  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    kind: ItemKind,
    value?: string,
    ns?: string,
  ) {
    super(label, collapsibleState);
    this.kind = kind;
    this.value = value;
    this.ns = ns;
    this._configure();
  }

  private _configure(): void {
    switch (this.kind) {
      case 'section':
        this.contextValue = 'section';
        break;

      case 'graph':
        this.iconPath = new vscode.ThemeIcon('file-code');
        this.contextValue = 'graph';
        if (this.value !== undefined) this.description = this.value;
        if (this.value !== undefined) this.tooltip = `Open graph: ${this.value}`;
        this.command = {
          command: 'canticaScores.openPanel',
          title: 'Open Workflow Canvas',
          arguments: [],
        };
        break;

      case 'server':
        this.iconPath = new vscode.ThemeIcon('server');
        this.contextValue = 'server';
        if (this.value !== undefined) this.description = this.value;
        break;

      case 'namespace':
        this.iconPath = new vscode.ThemeIcon('symbol-namespace');
        this.contextValue = 'namespace';
        break;

      case 'agent':
        this.iconPath = new vscode.ThemeIcon('robot');
        this.contextValue = 'agent';
        if (this.ns !== undefined) this.description = this.ns;
        this.tooltip = new vscode.MarkdownString(
          `**${String(this.label)}** \`${this.ns}\`\n\nDrag onto the workflow canvas or click to open.`,
          true,
        );
        this.command = {
          command: 'canticaScores.openPanel',
          title: 'Open Workflow Canvas',
          arguments: [],
        };
        break;
    }
  }
}

function infoItem(label: string): AgentItem {
  const item = new AgentItem(label, vscode.TreeItemCollapsibleState.None, 'namespace');
  item.iconPath = new vscode.ThemeIcon('info');
  return item;
}

export class AgentsProvider implements vscode.TreeDataProvider<AgentItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<AgentItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private graphs: { label: string; path: string }[] = [];
  private servers: CanticaServer[] = [];
  private namespaces: CanticaNamespace[] = [];
  private promptsByNamespace = new Map<string, CanticaPrompt[]>();
  private errorMessage: string | undefined;

  updateGraphs(graphs: { label: string; path: string }[]): void {
    this.graphs = graphs;
    this._onDidChangeTreeData.fire();
  }

  updateServers(servers: CanticaServer[]): void {
    this.servers = servers;
    this._onDidChangeTreeData.fire();
  }

  update(namespaces: CanticaNamespace[], prompts: CanticaPrompt[]): void {
    this.namespaces = namespaces;
    this.errorMessage = undefined;
    this.promptsByNamespace.clear();
    for (const prompt of prompts) {
      const list = this.promptsByNamespace.get(prompt.namespace) ?? [];
      list.push(prompt);
      this.promptsByNamespace.set(prompt.namespace, list);
    }
    this._onDidChangeTreeData.fire();
  }

  setError(message: string): void {
    this.errorMessage = message;
    this._onDidChangeTreeData.fire();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: AgentItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: AgentItem): AgentItem[] {
    if (!element) {
      return [
        new AgentItem('Graphs', vscode.TreeItemCollapsibleState.Expanded, 'section'),
        new AgentItem('Servers', vscode.TreeItemCollapsibleState.Expanded, 'section'),
        new AgentItem('Actors', vscode.TreeItemCollapsibleState.Collapsed, 'section'),
      ];
    }

    if (element.kind === 'section') {
      const sectionLabel = String(element.label);

      if (sectionLabel === 'Graphs') {
        if (this.graphs.length === 0) return [infoItem('No graph files found')];
        return this.graphs.map(
          (g) => new AgentItem(g.label, vscode.TreeItemCollapsibleState.None, 'graph', g.path),
        );
      }

      if (sectionLabel === 'Servers') {
        if (this.servers.length === 0) return [infoItem('No servers configured')];
        return this.servers.map((s) => {
          let host: string;
          try { host = new URL(s.url).host; } catch { host = s.url; }
          return new AgentItem(host, vscode.TreeItemCollapsibleState.None, 'server', s.url);
        });
      }

      if (sectionLabel === 'Actors') {
        if (this.errorMessage) {
          const item = new AgentItem(
            `Error: ${this.errorMessage}`,
            vscode.TreeItemCollapsibleState.None,
            'namespace',
          );
          item.iconPath = new vscode.ThemeIcon('warning');
          return [item];
        }
        if (this.namespaces.length === 0) return [infoItem('No actors loaded')];
        return this.namespaces.map(
          (ns) =>
            new AgentItem(ns.name, vscode.TreeItemCollapsibleState.Collapsed, 'namespace', undefined, ns.name),
        );
      }

      return [];
    }

    if (element.kind === 'namespace' && element.ns) {
      const prompts = this.promptsByNamespace.get(element.ns) ?? [];
      return prompts.map(
        (p) => new AgentItem(p.name, vscode.TreeItemCollapsibleState.None, 'agent', p.name, element.ns),
      );
    }

    return [];
  }
}
