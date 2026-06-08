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
  uri: vscode.Uri;
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
    readonly uri: vscode.Uri,
    readonly children: SongbookItem[],
  ) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.iconPath = new vscode.ThemeIcon('folder-opened');
    this.tooltip = uri.fsPath;
    this.contextValue = 'songbookFolder';
  }
}

export type SongbookNode = SongbookItem | SongbookFolderItem;

// ── Provider ──────────────────────────────────────────────────────────────────

export class SongbooksProvider
  implements vscode.TreeDataProvider<SongbookNode>, vscode.TreeDragAndDropController<SongbookNode> {
  private readonly _evt = new vscode.EventEmitter<SongbookNode | undefined>();
  readonly onDidChangeTreeData = this._evt.event;

  // Accept both internal moves and drops from the VS Code Explorer / OS
  readonly dropMimeTypes = ['application/vnd.code.tree.canticaScores.songbooksView', 'text/uri-list'];
  readonly dragMimeTypes = ['application/vnd.code.tree.canticaScores.songbooksView'];

  private _mode: SongbookViewMode = 'tree';
  private _entries: SongbookRawEntry[] = [];
  private _dropHandler?: (sources: vscode.Uri[], target: SongbookFolderItem | undefined) => Promise<void>;

  setMode(mode: SongbookViewMode): void {
    this._mode = mode;
    this._evt.fire(undefined);
  }

  update(entries: SongbookRawEntry[]): void {
    this._entries = entries;
    this._evt.fire(undefined);
  }

  setDropHandler(fn: (sources: vscode.Uri[], target: SongbookFolderItem | undefined) => Promise<void>): void {
    this._dropHandler = fn;
  }

  handleDrag(source: SongbookNode[], dataTransfer: vscode.DataTransfer): void {
    const files = source.filter((n): n is SongbookItem => n.kind === 'file');
    const uriList = files.map((f) => f.uri.toString()).join('\r\n');
    // Private MIME: carries URI strings; used for move-within-tree and as fallback
    dataTransfer.set(
      'application/vnd.code.tree.canticaScores.songbooksView',
      new vscode.DataTransferItem(uriList),
    );
    // Standard URI list: lets items be dropped into the canvas WebView to load them
    if (files.length > 0) {
      dataTransfer.set('text/uri-list', new vscode.DataTransferItem(uriList));
    }
  }

  async handleDrop(target: SongbookNode | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    if (!this._dropHandler) return;
    const folder = target?.kind === 'folder' ? target : undefined;

    // Prefer the private MIME (internal tree move); fall back to text/uri-list (Explorer / OS drop)
    const item =
      dataTransfer.get('application/vnd.code.tree.canticaScores.songbooksView') ??
      dataTransfer.get('text/uri-list');
    if (!item) return;

    const raw = await item.asString();
    const uris = raw
      .split(/\r?\n/)
      .map((u) => u.trim())
      .filter((u) => u && !u.startsWith('#'))
      .map((u) => vscode.Uri.parse(u));

    if (uris.length > 0) {
      await this._dropHandler(uris, folder);
    }
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
              e.uri,
              e.children.map((c) => new SongbookItem(c.label, c.uri)),
            ),
      );
    }
    if (el.kind === 'folder') return el.children;
    return [];
  }
}
