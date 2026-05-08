import * as vscode from 'vscode';
import { ShelvingService } from './shelvingService';
import { UnshelveResult } from './types';

function nonce(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export type HunkPickerMode = 'shelve' | 'unshelve';

export interface HunkPickerOpenOptions {
  mode: HunkPickerMode;
  shelfName?: string;
  title?: string;
  onShelved?: () => void;
  onUnshelved?: (r: UnshelveResult, label: string) => void;
}

export class HunkPickerProvider {
  private panel: vscode.WebviewPanel | undefined;

  constructor(private service: ShelvingService) {}

  async open(context: vscode.ExtensionContext, opts: HunkPickerOpenOptions): Promise<void> {
    let files;
    try {
      files = opts.mode === 'shelve'
        ? await this.service.getWorkingTreeHunks()
        : await this.service.getShelfHunks(opts.shelfName!);
    } catch (e: any) {
      vscode.window.showErrorMessage(`Forge: ${e?.message ?? String(e)}`);
      return;
    }
    if (!files || files.length === 0) {
      vscode.window.showInformationMessage(opts.mode === 'shelve' ? 'Forge: No changes to shelve' : 'Forge: Shelf is empty');
      return;
    }

    const title = opts.title ?? (opts.mode === 'shelve' ? 'Shelve Hunks' : `Unshelve Hunks: ${opts.shelfName}`);

    if (this.panel) this.panel.dispose();
    this.panel = vscode.window.createWebviewPanel(
      'forge.hunkPicker',
      `Forge: ${title}`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')],
      }
    );
    this.panel.onDidDispose(() => (this.panel = undefined));
    this.panel.webview.html = this.renderHtml(this.panel.webview, context.extensionUri);

    this.panel.webview.onDidReceiveMessage(async (msg) => {
      if (!this.panel) return;
      if (msg?.type === 'ready') {
        this.panel.webview.postMessage({
          type: 'init',
          payload: { mode: opts.mode, title, files, shelfName: opts.shelfName },
        });
      } else if (msg?.type === 'cancel') {
        this.panel.dispose();
      } else if (msg?.type === 'submit') {
        try {
          if (opts.mode === 'shelve') {
            const { name, description, hunkIds } = msg.payload as { name: string; description: string; hunkIds: string[] };
            await this.service.shelveHunks(name, description ?? '', hunkIds);
            opts.onShelved?.();
            vscode.window.showInformationMessage(`✓ Shelved ${hunkIds.length} hunk(s): ${name}`);
            this.panel.dispose();
          } else {
            const { hunkIds, removeAfter } = msg.payload as { hunkIds: string[]; removeAfter: boolean };
            const r = await this.service.unshelveHunks(opts.shelfName!, hunkIds, { keep: !removeAfter });
            opts.onUnshelved?.(r, opts.shelfName!);
            this.panel.dispose();
          }
        } catch (e: any) {
          vscode.window.showErrorMessage(`Forge: ${e?.message ?? String(e)}`);
        }
      } else if (msg?.type === 'error') {
        vscode.window.showWarningMessage(`Forge: ${msg.payload}`);
      }
    });
  }

  private renderHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const n = nonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'dist', 'webviews', 'hunkPicker', 'index.js')
    );
    const csp = [
      "default-src 'none'",
      `script-src 'nonce-${n}'`,
      "style-src 'unsafe-inline'",
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp};" />
  <title>Forge Hunk Picker</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${n}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
