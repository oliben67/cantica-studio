import * as path from 'path';
import * as vscode from 'vscode';

export const SONGBOOKS_SCHEME = 'cantica-songbooks';

export class SongbooksFileSystemProvider implements vscode.FileSystemProvider {
  private readonly _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this._onDidChangeFile.event;

  private _root: string;

  constructor(root: string) {
    this._root = root;
  }

  updateRoot(root: string): void {
    this._root = root;
  }

  private _real(uri: vscode.Uri): vscode.Uri {
    return vscode.Uri.file(path.join(this._root, uri.path));
  }

  watch(uri: vscode.Uri, options: { readonly recursive: boolean; readonly excludes: readonly string[] }): vscode.Disposable {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(this._real(uri), options.recursive ? '**' : '*'),
    );
    const emit = (type: vscode.FileChangeType) => (changed: vscode.Uri) => {
      const rel = path.relative(this._root, changed.fsPath).split(path.sep).join('/');
      this._onDidChangeFile.fire([{ type, uri: vscode.Uri.parse(`${SONGBOOKS_SCHEME}:///${rel}`) }]);
    };
    watcher.onDidCreate(emit(vscode.FileChangeType.Created));
    watcher.onDidChange(emit(vscode.FileChangeType.Changed));
    watcher.onDidDelete(emit(vscode.FileChangeType.Deleted));
    return watcher;
  }

  stat(uri: vscode.Uri): Thenable<vscode.FileStat> {
    return vscode.workspace.fs.stat(this._real(uri));
  }

  readDirectory(uri: vscode.Uri): Thenable<[string, vscode.FileType][]> {
    return vscode.workspace.fs.readDirectory(this._real(uri));
  }

  createDirectory(uri: vscode.Uri): Thenable<void> {
    return vscode.workspace.fs.createDirectory(this._real(uri));
  }

  readFile(uri: vscode.Uri): Thenable<Uint8Array> {
    return vscode.workspace.fs.readFile(this._real(uri));
  }

  writeFile(uri: vscode.Uri, content: Uint8Array, _options: { readonly create: boolean; readonly overwrite: boolean }): Thenable<void> {
    return vscode.workspace.fs.writeFile(this._real(uri), content);
  }

  delete(uri: vscode.Uri, options: { readonly recursive: boolean }): Thenable<void> {
    return vscode.workspace.fs.delete(this._real(uri), { recursive: options.recursive, useTrash: true });
  }

  rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { readonly overwrite: boolean }): Thenable<void> {
    return vscode.workspace.fs.rename(this._real(oldUri), this._real(newUri), { overwrite: options.overwrite });
  }

  copy?(source: vscode.Uri, destination: vscode.Uri, options: { readonly overwrite: boolean }): Thenable<void> {
    return vscode.workspace.fs.copy(this._real(source), this._real(destination), { overwrite: options.overwrite });
  }
}
