import * as vscode from 'vscode';

export class SongbookItem extends vscode.TreeItem {
  constructor(
    readonly label: string,
    readonly uri: vscode.Uri,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('file-code');
    this.description = vscode.workspace.asRelativePath(uri, false);
    this.tooltip = uri.fsPath;
    this.contextValue = 'songbook';
    // Single-click opens the canvas workspace, not the raw JSON file
    this.command = {
      command: 'canticaScores.viewSongbook',
      title: 'Open Songbook',
      arguments: [this],
    };
  }
}

export class SongbooksProvider implements vscode.TreeDataProvider<SongbookItem> {
  private readonly _evt = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._evt.event;
  private items: SongbookItem[] = [];

  update(graphs: { label: string; uri: vscode.Uri }[]): void {
    this.items = graphs.map((g) => new SongbookItem(g.label, g.uri));
    this._evt.fire();
  }

  getTreeItem(el: SongbookItem): vscode.TreeItem {
    return el;
  }

  getChildren(): SongbookItem[] {
    return this.items;
  }
}
