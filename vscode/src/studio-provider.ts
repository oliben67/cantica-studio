import * as vscode from 'vscode';

export class StudioProvider implements vscode.TreeDataProvider<never> {
  getTreeItem(): never { throw new Error('no items'); }
  getChildren(): never[] { return []; }
}
