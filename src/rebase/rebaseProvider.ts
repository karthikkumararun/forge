import * as vscode from 'vscode';
import { RebaseService, RebaseStep } from './rebaseService';

function nonce(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export class RebaseProvider {
  private panel: vscode.WebviewPanel | undefined;

  constructor(private service: RebaseService) {}

  async open(context: vscode.ExtensionContext, baseRef?: string): Promise<void> {
    const ref = baseRef ?? await vscode.window.showInputBox({
      prompt: 'Rebase onto which ref?',
      placeHolder: 'e.g. main, HEAD~5, abc123',
    });
    if (!ref) return;

    let commits;
    try {
      commits = await this.service.listCommitsSince(ref);
    } catch (e: any) {
      vscode.window.showErrorMessage(`Forge: ${e?.message ?? String(e)}`);
      return;
    }
    if (commits.length === 0) {
      vscode.window.showInformationMessage('Forge: No commits to rebase');
      return;
    }

    if (this.panel) this.panel.dispose();
    this.panel = vscode.window.createWebviewPanel(
      'forge.rebase',
      `Forge: Interactive Rebase (${ref})`,
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
      if (msg?.type === 'ready') {
        this.panel?.webview.postMessage({ type: 'init', payload: { baseRef: ref, commits } });
      } else if (msg?.type === 'apply') {
        const steps: RebaseStep[] = msg.payload?.steps ?? [];
        const res = await this.service.run(ref, steps);
        this.panel?.webview.postMessage({ type: 'result', payload: res });
        if (res.ok) {
          vscode.window.showInformationMessage('Forge: Rebase complete');
        } else {
          vscode.window.showErrorMessage('Forge: Rebase failed — see panel for output. Run "Forge: Abort Rebase" to back out.');
        }
      } else if (msg?.type === 'cancel') {
        this.panel?.dispose();
      }
    });
  }

  private renderHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const n = nonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'dist', 'webviews', 'rebase', 'index.js')
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
  <title>Forge Rebase</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${n}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
