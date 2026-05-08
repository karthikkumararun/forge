import * as vscode from 'vscode';
import { ShelvingService } from './shelvingService';
import { ShelfFileEntry, ShelfFileStatus, ShelfItem, ShelfMeta } from './types';

export class ShelfTreeItem extends vscode.TreeItem {
  constructor(public readonly meta: ShelfMeta) {
    super(meta.displayName, vscode.TreeItemCollapsibleState.Collapsed);
    const date = new Date(meta.createdAt).toLocaleString();
    this.description = `${meta.files.length} file${meta.files.length === 1 ? '' : 's'} • ${meta.branch} • ${date}`;
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

const STATUS_ICON: Record<ShelfFileStatus, string> = {
  A: 'diff-added',
  M: 'diff-modified',
  D: 'diff-removed',
  R: 'diff-renamed',
};

const STATUS_COLOR: Record<ShelfFileStatus, string> = {
  A: 'gitDecoration.addedResourceForeground',
  M: 'gitDecoration.modifiedResourceForeground',
  D: 'gitDecoration.deletedResourceForeground',
  R: 'gitDecoration.renamedResourceForeground',
};

export class ShelfFileItem extends vscode.TreeItem {
  constructor(public readonly shelfName: string, public readonly entry: ShelfFileEntry) {
    super(basename(entry.path), vscode.TreeItemCollapsibleState.None);
    const dir = dirname(entry.path);
    this.description = dir === '.' ? '' : dir;
    this.tooltip = entry.status === 'R' && entry.oldPath
      ? `${entry.oldPath} → ${entry.path}`
      : entry.path;
    this.contextValue = 'shelf-file';
    this.iconPath = new vscode.ThemeIcon(STATUS_ICON[entry.status], new vscode.ThemeColor(STATUS_COLOR[entry.status]));
    this.command = {
      command: 'forge.shelf.openFileDiff',
      title: 'Open Diff',
      arguments: [shelfName, entry.path],
    };
  }
}

class EmptyShelfItem extends vscode.TreeItem {
  constructor() {
    super('No shelves yet — shelve your changes to get started', vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'shelf-empty';
    this.iconPath = new vscode.ThemeIcon('info');
  }
}

export class TrashRootItem extends vscode.TreeItem {
  constructor(public readonly count: number) {
    super('Recently Deleted', vscode.TreeItemCollapsibleState.Collapsed);
    this.description = `${count}`;
    this.contextValue = 'shelf-trash-root';
    this.iconPath = new vscode.ThemeIcon('trash');
  }
}

export class TrashedShelfItem extends vscode.TreeItem {
  constructor(public readonly item: ShelfItem) {
    super(item.meta.displayName, vscode.TreeItemCollapsibleState.None);
    const deletedAt = item.deletedAt ? new Date(item.deletedAt).toLocaleString() : '';
    this.description = `${item.meta.files.length} file${item.meta.files.length === 1 ? '' : 's'} • deleted ${deletedAt}`;
    this.tooltip = [
      `**${item.meta.displayName}** (deleted)`,
      item.meta.description ? item.meta.description : '_no description_',
      '',
      `Branch: ${item.meta.branch}`,
      `Deleted: ${deletedAt}`,
      `Files: ${item.meta.files.length}`,
    ].join('\n');
    this.contextValue = 'shelf-trashed';
    this.iconPath = new vscode.ThemeIcon('archive');
  }
  get trashedName(): string {
    return this.item.metaPath.split(/[\\/]/).pop()!.replace(/\.meta\.json$/, '');
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

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!element) {
      const [items, trashed] = await Promise.all([
        this.service.listShelves(),
        this.service.listTrashed(),
      ]);
      const out: vscode.TreeItem[] = [];
      if (items.length === 0 && trashed.length === 0) return [new EmptyShelfItem()];
      for (const i of items) out.push(new ShelfTreeItem(i.meta));
      if (trashed.length > 0) out.push(new TrashRootItem(trashed.length));
      return out;
    }
    if (element instanceof ShelfTreeItem) {
      return element.meta.files.map((f) => new ShelfFileItem(element.meta.name, f));
    }
    if (element instanceof TrashRootItem) {
      const trashed = await this.service.listTrashed();
      return trashed.map((t) => new TrashedShelfItem(t));
    }
    return [];
  }
}

export class ShelfPreviewContentProvider implements vscode.TextDocumentContentProvider {
  static readonly scheme = 'forge-shelf-preview';
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private service: ShelvingService) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const name = uri.path.replace(/^\//, '').replace(/\.patch$/, '');
    try {
      return await this.service.peekShelf(name);
    } catch (e: any) {
      return `# Failed to load shelf: ${e?.message ?? String(e)}`;
    }
  }
}

export class ShelfFileContentProvider implements vscode.TextDocumentContentProvider {
  static readonly scheme = 'forge-shelf-file';
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private service: ShelvingService) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const shelfName = uri.authority;
    const segs = uri.path.replace(/^\//, '').split('/');
    const side = segs.shift();
    const filePath = decodeURIComponent(segs.join('/'));
    try {
      if (side === 'base') return await this.service.getFileBaseContent(shelfName, filePath);
      if (side === 'shelved') return await this.service.getFileShelvedContent(shelfName, filePath);
      return `# Unknown side: ${side}`;
    } catch (e: any) {
      return `# Failed: ${e?.message ?? String(e)}`;
    }
  }
}

export function buildShelfFileUri(shelfName: string, side: 'base' | 'shelved', filePath: string): vscode.Uri {
  return vscode.Uri.parse(`${ShelfFileContentProvider.scheme}://${shelfName}/${side}/${encodeURIComponent(filePath)}`);
}

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? p : p.slice(i + 1);
}
function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? '.' : p.slice(0, i);
}
