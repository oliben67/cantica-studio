import * as vscode from 'vscode';

// ── Helpers ───────────────────────────────────────────────────────────────────

const SONGBOOK_EXTS = new Set(['.json', '.jsonld', '.yaml', '.yml']);

function _isSongbook(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot !== -1 && SONGBOOK_EXTS.has(name.slice(dot));
}

/** Strip the file extension to produce a clean display name. */
function _displayLabel(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

// ── Tree-item classes ─────────────────────────────────────────────────────────

export class SongbookItem extends vscode.TreeItem {
  readonly kind = 'file' as const;

  constructor(
    readonly label: string,
    readonly uri: vscode.Uri,
    isActive = false,
    description?: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.id = uri.fsPath;
    this.resourceUri = uri;
    this.tooltip = new vscode.MarkdownString(`**${label}**\n\n\`${uri.fsPath}\``);
    this.contextValue = 'songbook';
    this.command = { command: 'canticaScores.viewSongbook', title: 'Open', arguments: [this] };

    if (isActive) {
      this.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.green'));
      this.description = description ?? 'open';
    } else {
      this.iconPath = new vscode.ThemeIcon('file-code');
      if (description) this.description = description;
    }
  }
}

export class SongbookFolderItem extends vscode.TreeItem {
  readonly kind = 'folder' as const;

  constructor(
    readonly label: string,
    readonly uri: vscode.Uri,
    isExpanded = false,
  ) {
    super(label, isExpanded
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.Collapsed);
    this.id = uri.fsPath;
    this.resourceUri = uri;
    this.tooltip = uri.fsPath;
    this.contextValue = 'canticaFolder';
    this.iconPath = new vscode.ThemeIcon(isExpanded ? 'folder-opened' : 'folder');
  }
}

export type SongbookNode = SongbookItem | SongbookFolderItem;
export type SongbookViewMode = 'tree' | 'list';

// ── Provider ──────────────────────────────────────────────────────────────────

export class SongbooksProvider
  implements vscode.TreeDataProvider<SongbookNode>, vscode.TreeDragAndDropController<SongbookNode> {
  private readonly _evt = new vscode.EventEmitter<SongbookNode | undefined>();
  readonly onDidChangeTreeData = this._evt.event;

  // Accept both internal moves and drops from the VS Code Explorer / OS
  readonly dropMimeTypes = ['application/vnd.code.tree.canticaScores.songbooksView', 'text/uri-list'];
  readonly dragMimeTypes = ['application/vnd.code.tree.canticaScores.songbooksView'];

  private _mode: SongbookViewMode = 'tree';
  private _rootUri: vscode.Uri | undefined;
  private _activeUri: string | undefined;
  private _expandedFolders = new Set<string>();
  private _dropHandler?: (sources: vscode.Uri[], target: SongbookFolderItem | undefined) => Promise<void>;

  setRoot(uri: vscode.Uri): void {
    this._rootUri = uri;
    this._evt.fire(undefined);
  }

  refresh(): void {
    this._evt.fire(undefined);
  }

  setMode(mode: SongbookViewMode): void {
    this._mode = mode;
    this._evt.fire(undefined);
  }

  get activeUri(): string | undefined { return this._activeUri; }

  setActive(uri: vscode.Uri | undefined): void {
    const next = uri?.fsPath;
    if (next !== this._activeUri) {
      this._activeUri = next;
      this._evt.fire(undefined);
    }
  }

  setFolderExpanded(fsPath: string, expanded: boolean): void {
    const had = this._expandedFolders.has(fsPath);
    if (expanded === had) return;
    if (expanded) {
      this._expandedFolders.add(fsPath);
    } else {
      this._expandedFolders.delete(fsPath);
    }
    this._evt.fire(undefined);
  }

  setDropHandler(fn: (sources: vscode.Uri[], target: SongbookFolderItem | undefined) => Promise<void>): void {
    this._dropHandler = fn;
  }

  handleDrag(source: SongbookNode[], dataTransfer: vscode.DataTransfer): void {
    const uriList = source.map((n) => n.uri.toString()).join('\r\n');
    dataTransfer.set(
      'application/vnd.code.tree.canticaScores.songbooksView',
      new vscode.DataTransferItem(uriList),
    );
    dataTransfer.set('text/uri-list', new vscode.DataTransferItem(uriList));
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

  async getChildren(el?: SongbookNode): Promise<SongbookNode[]> {
    if (this._mode === 'list') {
      if (el) return [];
      return this._listAll(this._rootUri);
    }
    const dir = el ? el.uri : this._rootUri;
    if (!dir) return [];
    return this._readDir(dir);
  }

  private async _readDir(dir: vscode.Uri): Promise<SongbookNode[]> {
    try {
      const entries = await vscode.workspace.fs.readDirectory(dir);

      const nodes: SongbookNode[] = [];
      const folders: [string, vscode.Uri][] = [];
      const files: [string, vscode.Uri][] = [];

      for (const [name, type] of entries) {
        const uri = vscode.Uri.joinPath(dir, name);
        if (type === vscode.FileType.Directory) {
          folders.push([name, uri]);
        } else if (_isSongbook(name)) {
          files.push([name, uri]);
        }
      }

      // Sort each group alphabetically
      folders.sort(([a], [b]) => a.localeCompare(b));
      files.sort(([a], [b]) => a.localeCompare(b));

      for (const [name, uri] of folders) {
        nodes.push(new SongbookFolderItem(name, uri, this._expandedFolders.has(uri.fsPath)));
      }
      for (const [name, uri] of files) {
        nodes.push(new SongbookItem(_displayLabel(name), uri, uri.fsPath === this._activeUri));
      }

      return nodes;
    } catch {
      return [];
    }
  }

  private async _listAll(dir: vscode.Uri | undefined, prefix = ''): Promise<SongbookItem[]> {
    if (!dir) return [];
    try {
      const entries = await vscode.workspace.fs.readDirectory(dir);
      const results: SongbookItem[] = [];

      for (const [name, type] of entries.sort(([a], [b]) => a.localeCompare(b))) {
        const uri = vscode.Uri.joinPath(dir, name);
        if (type === vscode.FileType.Directory) {
          results.push(...(await this._listAll(uri, prefix ? `${prefix}/${name}` : name)));
        } else if (_isSongbook(name)) {
          results.push(new SongbookItem(
            _displayLabel(name),
            uri,
            uri.fsPath === this._activeUri,
            prefix || undefined,
          ));
        }
      }

      return results;
    } catch {
      return [];
    }
  }
}
