import * as vscode from 'vscode';
import { GitService } from './git/gitService';
import { ShelvingService } from './shelving/shelvingService';
import { ShelvingProvider, ShelfTreeItem, ShelfPreviewContentProvider, ShelfFileContentProvider, ShelfFileItem, TrashedShelfItem, buildShelfFileUri } from './shelving/shelvingProvider';
import { HunkPickerProvider } from './shelving/hunkPickerProvider';
import { MergeEditorProvider } from './mergeEditor/mergeEditorProvider';
import { GitGraphProvider } from './gitGraph/gitGraphProvider';
import { ShowContentProvider } from './git/showContentProvider';
import { BlameProvider } from './blame/blameProvider';
import { RebaseService } from './rebase/rebaseService';
import { RebaseProvider } from './rebase/rebaseProvider';
import { CloudSync } from './shelving/cloudSync';
import { hasConflictMarkers } from './mergeEditor/conflictParser';
import { UnshelveResult } from './shelving/types';

const CLOUD_TOKEN_KEY = 'forge.cloud.gistToken';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showInformationMessage('Forge: Open a folder to use Forge');
    return;
  }
  const root = folder.uri.fsPath;

  const gitService = new GitService(root);
  if (!(await gitService.isGitRepo())) {
    vscode.window.showInformationMessage('Forge: Current workspace is not a git repository');
    return;
  }

  const shelvingService = new ShelvingService(gitService, root);
  const shelvingProvider = new ShelvingProvider(shelvingService);
  const previewProvider = new ShelfPreviewContentProvider(shelvingService);
  const shelfFileProvider = new ShelfFileContentProvider(shelvingService);
  const mergeEditorProvider = new MergeEditorProvider(gitService, root);
  const gitGraphProvider = new GitGraphProvider(gitService);
  const rebaseService = new RebaseService(gitService, root);
  const rebaseProvider = new RebaseProvider(rebaseService);
  const cloudSync = new CloudSync(shelvingService, root);
  const hunkPickerProvider = new HunkPickerProvider(shelvingService);

  const blameEnabled = vscode.workspace.getConfiguration('forge.blame').get<boolean>('enabled', true);
  const blameProvider = blameEnabled ? new BlameProvider(gitService, root) : undefined;
  if (blameProvider) context.subscriptions.push(blameProvider);

  const reportUnshelve = async (r: UnshelveResult, label: string, removed: boolean = false): Promise<void> => {
    if (r.conflicted.length > 0) {
      const choice = await vscode.window.showWarningMessage(
        `Forge: ${r.conflicted.length} conflict(s) while unshelving "${label}". Resolve via merge editor.`,
        'Open Merge Editor', 'Dismiss'
      );
      if (choice === 'Open Merge Editor') {
        const first = r.conflicted[0];
        const uri = vscode.Uri.file(`${root}/${first}`);
        await vscode.commands.executeCommand('forge.openMergeEditor', uri);
      }
      return;
    }
    const tail = removed ? ' & removed' : (r.shelfRemaining ? '' : ' — shelf trashed');
    vscode.window.showInformationMessage(`✓ Unshelved${tail}: ${label} (${r.applied.length} file(s))`);
  };

  const requireCloud = async (): Promise<{ token: string; gistId?: string } | undefined> => {
    const token = await context.secrets.get(CLOUD_TOKEN_KEY);
    if (!token) {
      vscode.window.showErrorMessage('Forge: No gist token. Run "Forge: Set Gist Token".');
      return undefined;
    }
    const gistId = vscode.workspace.getConfiguration('forge.shelves').get<string>('cloudGistId') || undefined;
    return { token, gistId };
  };

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('forge-shelves', shelvingProvider),
    vscode.workspace.registerTextDocumentContentProvider(ShelfPreviewContentProvider.scheme, previewProvider),
    vscode.workspace.registerTextDocumentContentProvider(ShelfFileContentProvider.scheme, shelfFileProvider),
    vscode.workspace.registerTextDocumentContentProvider(ShowContentProvider.scheme, new ShowContentProvider(gitService)),
  );

  const conflictStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  conflictStatusItem.text = '$(git-merge) Forge: Resolve Conflict';
  conflictStatusItem.command = 'forge.openMergeEditor';
  conflictStatusItem.tooltip = 'Open Forge merge editor for this file';
  context.subscriptions.push(conflictStatusItem);

  const updateConflictStatus = async (doc?: vscode.TextDocument) => {
    const target = doc ?? vscode.window.activeTextEditor?.document;
    if (!target || target.uri.scheme !== 'file') {
      conflictStatusItem.hide();
      return;
    }
    if (hasConflictMarkers(target.getText())) {
      conflictStatusItem.show();
    } else {
      conflictStatusItem.hide();
    }
  };

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((ed) => updateConflictStatus(ed?.document)),
    vscode.workspace.onDidOpenTextDocument((d) => updateConflictStatus(d)),
    vscode.workspace.onDidChangeTextDocument((e) => updateConflictStatus(e.document)),
  );
  updateConflictStatus();

  context.subscriptions.push(
    vscode.commands.registerCommand('forge.shelvePartial', async () => {
      const files = await shelvingService.listChangedFiles();
      if (files.length === 0) {
        vscode.window.showInformationMessage('Forge: No changes to shelve');
        return;
      }
      const picked = await vscode.window.showQuickPick(
        files.map((f) => ({ label: f, picked: true })),
        { canPickMany: true, placeHolder: 'Select files to shelve' }
      );
      if (!picked || picked.length === 0) return;
      const name = await vscode.window.showInputBox({ prompt: 'Shelf name' });
      if (!name) return;
      const desc = await vscode.window.showInputBox({ prompt: 'Description (optional)' });
      try {
        await shelvingService.shelveChanges(name, desc ?? '', picked.map((p) => p.label));
        shelvingProvider.refresh();
        vscode.window.showInformationMessage(`✓ Shelved ${picked.length} file(s): ${name}`);
      } catch (e: any) {
        vscode.window.showErrorMessage(`Forge: ${e?.message ?? String(e)}`);
      }
    }),

    vscode.commands.registerCommand('forge.mergeEditor.nextConflict', () => mergeEditorProvider.sendCommand('nextConflict')),
    vscode.commands.registerCommand('forge.mergeEditor.prevConflict', () => mergeEditorProvider.sendCommand('prevConflict')),
    vscode.commands.registerCommand('forge.mergeEditor.acceptYours', () => mergeEditorProvider.sendCommand('acceptYours')),
    vscode.commands.registerCommand('forge.mergeEditor.acceptTheirs', () => mergeEditorProvider.sendCommand('acceptTheirs')),
    vscode.commands.registerCommand('forge.mergeEditor.save', () => mergeEditorProvider.sendCommand('save')),

    vscode.commands.registerCommand('forge.shelveChanges', async () => {
      const name = await vscode.window.showInputBox({ prompt: 'Shelf name', placeHolder: 'e.g. wip-feature-auth' });
      if (!name) return;
      const desc = await vscode.window.showInputBox({ prompt: 'Description (optional)', placeHolder: '' });
      try {
        await shelvingService.shelveChanges(name, desc ?? '');
        shelvingProvider.refresh();
        vscode.window.showInformationMessage(`✓ Shelved: ${name}`);
      } catch (e: any) {
        vscode.window.showErrorMessage(`Forge: ${e?.message ?? String(e)}`);
      }
    }),

    vscode.commands.registerCommand('forge.unshelveChanges', async (item: ShelfTreeItem) => {
      const cfg = vscode.workspace.getConfiguration('forge.shelving');
      const defaultKeep = cfg.get<boolean>('defaultUnshelveKeepShelf', true);
      try {
        const r = await shelvingService.unshelveChanges(item.meta.name, { keep: defaultKeep });
        shelvingProvider.refresh();
        await reportUnshelve(r, item.meta.displayName);
      } catch (e: any) {
        vscode.window.showErrorMessage(`Forge: ${e?.message ?? String(e)}`);
      }
    }),

    vscode.commands.registerCommand('forge.shelf.unshelveAndRemove', async (item: ShelfTreeItem) => {
      try {
        const r = await shelvingService.unshelveChanges(item.meta.name, { keep: false });
        shelvingProvider.refresh();
        await reportUnshelve(r, item.meta.displayName, true);
      } catch (e: any) {
        vscode.window.showErrorMessage(`Forge: ${e?.message ?? String(e)}`);
      }
    }),

    vscode.commands.registerCommand('forge.shelf.unshelvePartial', async (item: ShelfTreeItem) => {
      const picks = await vscode.window.showQuickPick(
        item.meta.files.map((f) => ({ label: f.path, description: f.status, picked: true, file: f })),
        { canPickMany: true, placeHolder: `Pick files to unshelve from "${item.meta.displayName}"` }
      );
      if (!picks || picks.length === 0) return;
      const removeAfter = await vscode.window.showQuickPick(
        [
          { label: 'Keep in shelf', value: true },
          { label: 'Remove from shelf after apply', value: false },
        ],
        { placeHolder: 'After unshelve…' }
      );
      if (!removeAfter) return;
      try {
        const r = await shelvingService.unshelveChanges(item.meta.name, {
          files: picks.map((p) => p.file.path),
          keep: removeAfter.value,
        });
        shelvingProvider.refresh();
        await reportUnshelve(r, item.meta.displayName);
      } catch (e: any) {
        vscode.window.showErrorMessage(`Forge: ${e?.message ?? String(e)}`);
      }
    }),

    vscode.commands.registerCommand('forge.shelf.unshelveFile', async (fileItem: ShelfFileItem) => {
      try {
        const r = await shelvingService.unshelveChanges(fileItem.shelfName, { files: [fileItem.entry.path], keep: true });
        shelvingProvider.refresh();
        await reportUnshelve(r, fileItem.entry.path);
      } catch (e: any) {
        vscode.window.showErrorMessage(`Forge: ${e?.message ?? String(e)}`);
      }
    }),

    vscode.commands.registerCommand('forge.shelf.rename', async (item: ShelfTreeItem) => {
      const v = await vscode.window.showInputBox({ prompt: 'New shelf name', value: item.meta.displayName });
      if (!v) return;
      try {
        await shelvingService.renameShelf(item.meta.name, v);
        shelvingProvider.refresh();
      } catch (e: any) {
        vscode.window.showErrorMessage(`Forge: ${e?.message ?? String(e)}`);
      }
    }),

    vscode.commands.registerCommand('forge.shelf.editDescription', async (item: ShelfTreeItem) => {
      const v = await vscode.window.showInputBox({ prompt: 'Shelf description', value: item.meta.description });
      if (v === undefined) return;
      try {
        await shelvingService.setShelfDescription(item.meta.name, v);
        shelvingProvider.refresh();
      } catch (e: any) {
        vscode.window.showErrorMessage(`Forge: ${e?.message ?? String(e)}`);
      }
    }),

    vscode.commands.registerCommand('forge.shelf.shelveHunks', async () => {
      await hunkPickerProvider.open(context, {
        mode: 'shelve',
        title: 'Shelve Hunks',
        onShelved: () => shelvingProvider.refresh(),
      });
    }),

    vscode.commands.registerCommand('forge.shelf.unshelveHunks', async (item: ShelfTreeItem) => {
      await hunkPickerProvider.open(context, {
        mode: 'unshelve',
        shelfName: item.meta.name,
        title: `Unshelve Hunks: ${item.meta.displayName}`,
        onUnshelved: async (r, _label) => {
          shelvingProvider.refresh();
          await reportUnshelve(r, item.meta.displayName);
        },
      });
    }),

    vscode.commands.registerCommand('forge.shelf.autoShelf', async () => {
      try {
        const name = await shelvingService.autoShelf('manual', 'manual snapshot');
        if (!name) {
          vscode.window.showInformationMessage('Forge: No changes to shelve');
          return;
        }
        shelvingProvider.refresh();
        vscode.window.showInformationMessage(`✓ Auto-shelved: ${name}`);
      } catch (e: any) {
        vscode.window.showErrorMessage(`Forge: ${e?.message ?? String(e)}`);
      }
    }),

    vscode.commands.registerCommand('forge.deleteShelve', async (item: ShelfTreeItem) => {
      const cfg = vscode.workspace.getConfiguration('forge.shelving');
      const confirmHard = cfg.get<boolean>('confirmHardDelete', true);
      const choice = await vscode.window.showWarningMessage(
        `Delete shelf "${item.meta.displayName}"?`,
        { modal: false },
        'Move to Recently Deleted', 'Delete Permanently'
      );
      if (!choice) return;
      const hard = choice === 'Delete Permanently';
      if (hard && confirmHard) {
        const c2 = await vscode.window.showWarningMessage(`Permanently delete "${item.meta.displayName}"? This cannot be undone.`, 'Delete', 'Cancel');
        if (c2 !== 'Delete') return;
      }
      try {
        await shelvingService.deleteShelve(item.meta.name, { hard });
        shelvingProvider.refresh();
      } catch (e: any) {
        vscode.window.showErrorMessage(`Forge: ${e?.message ?? String(e)}`);
      }
    }),

    vscode.commands.registerCommand('forge.shelf.restore', async (item: TrashedShelfItem) => {
      try {
        await shelvingService.restoreFromTrash(item.trashedName);
        shelvingProvider.refresh();
        vscode.window.showInformationMessage(`✓ Restored: ${item.item.meta.displayName}`);
      } catch (e: any) {
        vscode.window.showErrorMessage(`Forge: ${e?.message ?? String(e)}`);
      }
    }),

    vscode.commands.registerCommand('forge.shelf.purgeOne', async (item: TrashedShelfItem) => {
      const c = await vscode.window.showWarningMessage(`Permanently delete "${item.item.meta.displayName}"?`, 'Delete', 'Cancel');
      if (c !== 'Delete') return;
      try {
        await shelvingService.purgeOneTrashed(item.trashedName);
        shelvingProvider.refresh();
      } catch (e: any) {
        vscode.window.showErrorMessage(`Forge: ${e?.message ?? String(e)}`);
      }
    }),

    vscode.commands.registerCommand('forge.shelf.purgeAll', async () => {
      const c = await vscode.window.showWarningMessage('Permanently delete all trashed shelves?', 'Delete All', 'Cancel');
      if (c !== 'Delete All') return;
      try {
        const n = await shelvingService.purgeTrash(0);
        shelvingProvider.refresh();
        vscode.window.showInformationMessage(`✓ Purged ${n} shelf(s)`);
      } catch (e: any) {
        vscode.window.showErrorMessage(`Forge: ${e?.message ?? String(e)}`);
      }
    }),

    vscode.commands.registerCommand('forge.previewShelve', async (item: ShelfTreeItem) => {
      const uri = vscode.Uri.parse(`${ShelfPreviewContentProvider.scheme}:/${item.meta.name}.patch`);
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.languages.setTextDocumentLanguage(doc, 'diff');
      await vscode.window.showTextDocument(doc, { preview: true });
    }),

    vscode.commands.registerCommand('forge.refreshShelves', () => shelvingProvider.refresh()),

    vscode.commands.registerCommand('forge.shelf.openFileDiff', async (shelfNameOrItem: string | ShelfFileItem, maybeFile?: string) => {
      let shelfName: string;
      let filePath: string;
      if (typeof shelfNameOrItem === 'string') {
        shelfName = shelfNameOrItem;
        filePath = maybeFile ?? '';
      } else {
        shelfName = shelfNameOrItem.shelfName;
        filePath = shelfNameOrItem.entry.path;
      }
      if (!shelfName || !filePath) return;
      const baseUri = buildShelfFileUri(shelfName, 'base', filePath);
      const shelvedUri = buildShelfFileUri(shelfName, 'shelved', filePath);
      const title = `${filePath} (shelf: ${shelfName})`;
      await vscode.commands.executeCommand('vscode.diff', baseUri, shelvedUri, title, { preview: true });
    }),

    vscode.commands.registerCommand('forge.openMergeEditor', (uri?: vscode.Uri) => mergeEditorProvider.open(context, uri)),

    vscode.commands.registerCommand('forge.openGitGraph', () => gitGraphProvider.open(context)),

    vscode.commands.registerCommand('forge.toggleBlame', () => {
      if (!blameProvider) {
        vscode.window.showInformationMessage('Forge: Blame disabled in settings');
        return;
      }
      blameProvider.toggle();
      vscode.window.showInformationMessage(`Forge blame: ${blameProvider.isEnabled() ? 'on' : 'off'}`);
    }),

    vscode.commands.registerCommand('forge.startInteractiveRebase', () => rebaseProvider.open(context)),
    vscode.commands.registerCommand('forge.abortRebase', async () => {
      const r = await rebaseService.abort();
      vscode.window.showInformationMessage(r.ok ? 'Forge: Rebase aborted' : `Forge: ${r.output || 'abort failed'}`);
    }),

    vscode.commands.registerCommand('forge.shelves.setCloudToken', async () => {
      const tok = await vscode.window.showInputBox({
        prompt: 'GitHub personal access token (gist scope)',
        password: true,
        ignoreFocusOut: true,
      });
      if (!tok) return;
      await context.secrets.store(CLOUD_TOKEN_KEY, tok);
      vscode.window.showInformationMessage('Forge: Gist token stored');
    }),
    vscode.commands.registerCommand('forge.shelves.cloudPush', async () => {
      const cred = await requireCloud();
      if (!cred) return;
      try {
        const r = await cloudSync.push(cred);
        if (!cred.gistId) {
          await vscode.workspace.getConfiguration('forge.shelves').update('cloudGistId', r.gistId, vscode.ConfigurationTarget.Workspace);
        }
        vscode.window.showInformationMessage(`Forge: Pushed shelves → ${r.url}`, 'Open').then((c) => {
          if (c === 'Open') vscode.env.openExternal(vscode.Uri.parse(r.url));
        });
      } catch (e: any) {
        vscode.window.showErrorMessage(`Forge: ${e?.message ?? String(e)}`);
      }
    }),
    vscode.commands.registerCommand('forge.shelves.cloudPull', async () => {
      const cred = await requireCloud();
      if (!cred || !cred.gistId) {
        vscode.window.showErrorMessage('Forge: forge.shelves.cloudGistId not configured');
        return;
      }
      try {
        const r = await cloudSync.pull(cred);
        shelvingProvider.refresh();
        vscode.window.showInformationMessage(`Forge: Pulled ${r.pulled} shelf(s)`);
      } catch (e: any) {
        vscode.window.showErrorMessage(`Forge: ${e?.message ?? String(e)}`);
      }
    }),
  );

  const ttlDays = vscode.workspace.getConfiguration('forge.shelving').get<number>('trashTtlDays', 0);
  if (ttlDays && ttlDays > 0) {
    shelvingService.purgeTrash(ttlDays).then((n) => {
      if (n > 0) shelvingProvider.refresh();
    }).catch(() => {});
  }

  if (!context.globalState.get('forge.welcomed')) {
    vscode.window.showInformationMessage(
      '⚡ Forge is ready — supercharged git for VS Code',
      'Open Git Graph', 'View Shelves'
    ).then((choice) => {
      if (choice === 'Open Git Graph') vscode.commands.executeCommand('forge.openGitGraph');
      else if (choice === 'View Shelves') vscode.commands.executeCommand('workbench.view.extension.forge');
    });
    context.globalState.update('forge.welcomed', true);
  }
}

export function deactivate(): void {
  // nothing to clean up
}
