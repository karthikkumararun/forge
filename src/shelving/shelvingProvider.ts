import * as vscode from 'vscode';
import { ShelvingService } from './shelvingService';
import { ShelfMeta } from './types';

export class ShelfTreeItem extends vscode.TreeItem {
  constructor(public readonly meta: ShelfMeta) {
    super(meta.displayName, vscode.TreeItemCollapsibleState.None);
    const date = new Date(meta.createdAt).toLocaleString();
    this.description = `${meta.branch} • ${date}`;
    this.tooltip = [
      `**${meta.displayName}**`,
      meta.description ? meta.description : '_no description_',
      '',
      `Branch: ${meta.branch}`,
      `Base: ${meta.baseCommit.slice(0, 7)}`,
      `Created: ${date}`,
      `Files: ${meta.files.length}`,
    ].join('\n');
    this.contextValue = 'shelf';
    this.iconPath = new vscode.ThemeIcon('archive');
  }
}

class EmptyShelfItem extends vscode.TreeItem {
  constructor() {
    super('No shelves yet — shelve your changes to get started', vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'shelf-empty';
    this.iconPath = new vscode.ThemeIcon('info');
  }
}

export class ShelvingProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private service: ShelvingService) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<vscode.TreeItem[]> {
    const items = await this.service.listShelves();
    if (items.length === 0) return [new EmptyShelfItem()];
    return items.map((i) => new ShelfTreeItem(i.meta));
  }
}

export class ShelfPreviewContentProvider implements vscode.TextDocumentContentProvider {
  static readonly scheme = 'forge-shelf-preview';
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private service: ShelvingService) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const name = uri.path.replace(/^\//, '');
    try {
      return await this.service.peekShelf(name);
    } catch (e: any) {
      return `# Failed to load shelf: ${e?.message ?? String(e)}`;
    }
  }
}
