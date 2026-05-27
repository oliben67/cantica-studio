import * as vscode from 'vscode';
import type { CanticaNamespace, CanticaPrompt } from './types/index.js';

export class AgentItem extends vscode.TreeItem {
  constructor(
    public override readonly label: string,
    public override readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly namespace?: string,
    public readonly promptName?: string,
  ) {
    super(label, collapsibleState);

    if (namespace !== undefined && promptName !== undefined) {
      this.description = namespace;
      this.iconPath = new vscode.ThemeIcon('robot');
      this.contextValue = 'agent';
      this.tooltip = new vscode.MarkdownString(
        `**${promptName}** \`${namespace}\`\n\nDrag onto the workflow canvas or click to open in browser.`,
        true,
      );
      this.command = {
        command: 'canticaScores.openPanel',
        title: 'Open Workflow Canvas',
        arguments: [],
      };
    } else {
      this.iconPath = new vscode.ThemeIcon('symbol-namespace');
      this.contextValue = 'namespace';
    }
  }
}

export class AgentsProvider implements vscode.TreeDataProvider<AgentItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    AgentItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private namespaces: CanticaNamespace[] = [];
  private promptsByNamespace = new Map<string, CanticaPrompt[]>();
  private errorMessage: string | undefined;

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
    if (this.errorMessage) {
      const item = new AgentItem(
        `Error: ${this.errorMessage}`,
        vscode.TreeItemCollapsibleState.None,
      );
      item.iconPath = new vscode.ThemeIcon('warning');
      return [item];
    }

    if (!element) {
      // Root level — show namespaces
      if (this.namespaces.length === 0) {
        const item = new AgentItem('No actors loaded', vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon('info');
        return [item];
      }
      return this.namespaces.map(
        (ns) =>
          new AgentItem(
            ns.name,
            vscode.TreeItemCollapsibleState.Collapsed,
            ns.name,
            undefined,
          ),
      );
    }

    // Namespace children — show prompts
    const prompts = this.promptsByNamespace.get(element.label) ?? [];
    return prompts.map(
      (p) =>
        new AgentItem(
          p.name,
          vscode.TreeItemCollapsibleState.None,
          element.label,
          p.name,
        ),
    );
  }
}
