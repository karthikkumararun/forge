import * as vscode from 'vscode';
import { GitService } from '../git/gitService';

function nonce(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export class GitGraphProvider {
  private panel: vscode.WebviewPanel | undefined;

  constructor(private gitService: GitService) {}

  async open(context: vscode.ExtensionContext): Promise<void> {
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      'forge.gitGraph',
      'Forge: Git Graph',
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
        await this.sendInit();
      } else if (msg?.type === 'requestCommitDetail') {
        const sha: string = msg.payload?.sha;
        try {
          const stat = await this.gitService.getCommitStats(sha);
          this.panel?.webview.postMessage({ type: 'commitDetail', payload: { sha, stat } });
        } catch (e: any) {
          vscode.window.showErrorMessage(`Forge: ${e?.message ?? String(e)}`);
        }
      } else if (msg?.type === 'refresh') {
        await this.sendInit();
      } else if (msg?.type === 'openFileAtCommit') {
        const { sha, parent, filePath } = msg.payload ?? {};
        if (!sha || !filePath) return;
        try {
          const left = vscode.Uri.parse(`forge-show:/${parent ?? sha + '^'}/${filePath}?${parent ?? sha + '^'}:${filePath}`);
          const right = vscode.Uri.parse(`forge-show:/${sha}/${filePath}?${sha}:${filePath}`);
          await vscode.commands.executeCommand('vscode.diff', left, right, `${filePath} @ ${sha.slice(0, 7)}`);
        } catch (e: any) {
          vscode.window.showErrorMessage(`Forge: ${e?.message ?? String(e)}`);
        }
      }
    });
  }

  private async sendInit() {
    const max = vscode.workspace.getConfiguration('forge.gitGraph').get<number>('maxCommits') ?? 500;
    const commits = await this.gitService.getLog({ all: true, maxCount: max });
    const branches = await this.gitService.getBranches().catch(() => [] as string[]);
    this.panel?.webview.postMessage({ type: 'init', payload: { commits, branches } });
  }

  private renderHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const n = nonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'dist', 'webviews', 'gitGraph', 'index.js')
    );
    const csp = [
      "default-src 'none'",
      `script-src 'nonce-${n}'`,
      "style-src 'unsafe-inline'",
      `img-src ${webview.cspSource} data:`,
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp};" />
  <title>Forge Git Graph</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${n}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
