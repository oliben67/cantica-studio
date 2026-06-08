import * as vscode from 'vscode';

export type StudioHealth = 'healthy' | 'starting' | 'down';

class StudioStatusItem extends vscode.TreeItem {
  constructor(status: StudioHealth) {
    super('Studio API');
    this.description = status === 'healthy' ? 'healthy'
      : status === 'starting' ? 'starting…'
      : 'not running';
    this.iconPath = status === 'healthy'
      ? new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('terminal.ansiGreen'))
      : status === 'starting'
      ? new vscode.ThemeIcon('loading~spin', new vscode.ThemeColor('terminal.ansiYellow'))
      : new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('testing.iconFailed'));
    if (status === 'down') {
      this.command = { command: 'canticaScores.startLocalStudio', title: 'Start Studio API', arguments: [] };
    }
    this.contextValue = `studioStatus.${status}`;
    this.collapsibleState = vscode.TreeItemCollapsibleState.None;
  }
}

export class StudioProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly _onChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onChange.event;

  private _status: StudioHealth = 'down';

  setStatus(status: StudioHealth): void {
    this._status = status;
    this._onChange.fire();
  }

  getTreeItem(el: vscode.TreeItem): vscode.TreeItem { return el; }

  getChildren(): vscode.TreeItem[] {
    return [new StudioStatusItem(this._status)];
  }
}
