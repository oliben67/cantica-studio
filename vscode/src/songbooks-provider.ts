import * as vscode from 'vscode';

// ── Raw data shapes (produced by findSongbooks in extension.ts) ───────────────

export interface SongbookRawFile {
  kind: 'file';
  label: string;
  uri: vscode.Uri;
}

export interface SongbookRawFolder {
  kind: 'folder';
  label: string;
  children: SongbookRawFile[];
}

export type SongbookRawEntry = SongbookRawFile | SongbookRawFolder;

export type SongbookViewMode = 'tree' | 'list';

// ── Tree-item classes ─────────────────────────────────────────────────────────

export class SongbookItem extends vscode.TreeItem {
  readonly kind = 'file' as const;

  constructor(
    readonly label: string,
    readonly uri: vscode.Uri,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('file-code');
    this.description = vscode.workspace.asRelativePath(uri, false);
    this.tooltip = uri.fsPath;
    this.contextValue = 'songbook';
    this.command = {
      command: 'canticaScores.viewSongbook',
      title: 'Open Songbook',
      arguments: [this],
    };
  }
}

export class SongbookFolderItem extends vscode.TreeItem {
  readonly kind = 'folder' as const;

  constructor(
    readonly label: string,
    readonly children: SongbookItem[],
  ) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.iconPath = new vscode.ThemeIcon('folder-opened');
    this.contextValue = 'songbookFolder';
  }
}

type SongbookNode = SongbookItem | SongbookFolderItem;

// ── Provider ──────────────────────────────────────────────────────────────────

export class SongbooksProvider implements vscode.TreeDataProvider<SongbookNode> {
  private readonly _evt = new vscode.EventEmitter<SongbookNode | undefined>();
  readonly onDidChangeTreeData = this._evt.event;

  private _mode: SongbookViewMode = 'tree';
  private _entries: SongbookRawEntry[] = [];

  setMode(mode: SongbookViewMode): void {
    this._mode = mode;
    this._evt.fire(undefined);
  }

  update(entries: SongbookRawEntry[]): void {
    this._entries = entries;
    this._evt.fire(undefined);
  }

  getTreeItem(el: SongbookNode): vscode.TreeItem {
    return el;
  }

  getChildren(el?: SongbookNode): SongbookNode[] {
    if (this._mode === 'list') {
      if (el) return [];
      return this._entries.flatMap((e): SongbookItem[] =>
        e.kind === 'file'
          ? [new SongbookItem(e.label, e.uri)]
          : e.children.map((c) => new SongbookItem(`${e.label}/${c.label}`, c.uri)),
      );
    }

    // tree mode
    if (!el) {
      return this._entries.map((e): SongbookNode =>
        e.kind === 'file'
          ? new SongbookItem(e.label, e.uri)
          : new SongbookFolderItem(
              e.label,
              e.children.map((c) => new SongbookItem(c.label, c.uri)),
            ),
      );
    }
    if (el.kind === 'folder') return el.children;
    return [];
  }
}
