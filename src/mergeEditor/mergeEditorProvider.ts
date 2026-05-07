import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { GitService } from '../git/gitService';
import { hasConflictMarkers, parseConflicts } from './conflictParser';

function nonce(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
    '.json': 'json', '.md': 'markdown', '.py': 'python', '.go': 'go', '.rs': 'rust',
    '.java': 'java', '.c': 'c', '.cpp': 'cpp', '.h': 'cpp', '.css': 'css', '.html': 'html',
    '.yml': 'yaml', '.yaml': 'yaml', '.sh': 'shell', '.rb': 'ruby',
  };
  return map[ext] ?? 'plaintext';
}

export class MergeEditorProvider {
  private panels = new Map<string, vscode.WebviewPanel>();
  private activePanel: vscode.WebviewPanel | undefined;

  constructor(private gitService: GitService, private workspaceRoot: string) {}

  sendCommand(command: string): void {
    const panel = this.activePanel;
    if (!panel || !panel.active) return;
    panel.webview.postMessage({ type: 'command', payload: { command } });
  }

  async open(context: vscode.ExtensionContext, fileUri?: vscode.Uri): Promise<void> {
    const target = fileUri ?? vscode.window.activeTextEditor?.document.uri;
    if (!target) {
      vscode.window.showInformationMessage('Forge: No file selected');
      return;
    }
    const filePath = target.fsPath;
    const fileContent = await fs.readFile(filePath, 'utf8');

    if (!hasConflictMarkers(fileContent)) {
      vscode.window.showInformationMessage('Forge: No conflicts found in this file');
      return;
    }

    const relPath = path.relative(this.workspaceRoot, filePath).replace(/\\/g, '/');

    let base = '';
    let ours = '';
    let theirs = '';
    try {
      [base, ours, theirs] = await Promise.all([
        this.gitService.showFileAtIndex(1, relPath).catch(() => ''),
        this.gitService.showFileAtIndex(2, relPath).catch(() => ''),
        this.gitService.showFileAtIndex(3, relPath).catch(() => ''),
      ]);
    } catch {
      // ignore
    }

    if (!ours || !theirs) {
      const parsed = parseConflicts(fileContent);
      const before = parsed.linesBeforeFirst;
      const reconstruct = (side: 'ours' | 'theirs') => {
        const out = [...before];
        for (const c of parsed.chunks) {
          out.push(...(side === 'ours' ? c.ours : c.theirs));
        }
        return out.join('\n');
      };
      ours = ours || reconstruct('ours');
      theirs = theirs || reconstruct('theirs');
      base = base || (parsed.chunks[0]?.baseLines?.join('\n') ?? '');
    }

    const existing = this.panels.get(filePath);
    if (existing) {
      existing.reveal();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'forge.mergeEditor',
      `Merge: ${path.basename(filePath)}`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')],
      }
    );
    this.panels.set(filePath, panel);
    this.activePanel = panel;
    panel.onDidChangeViewState((e) => {
      if (e.webviewPanel.active) this.activePanel = e.webviewPanel;
      else if (this.activePanel === e.webviewPanel) this.activePanel = undefined;
    });
    panel.onDidDispose(() => {
      this.panels.delete(filePath);
      if (this.activePanel === panel) this.activePanel = undefined;
    });

    panel.webview.html = this.renderHtml(panel.webview, context.extensionUri);

    panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg?.type === 'ready') {
        panel.webview.postMessage({
          type: 'init',
          payload: {
            filePath,
            fileName: path.basename(filePath),
            base,
            ours,
            theirs,
            language: detectLanguage(filePath),
          },
        });
      } else if (msg?.type === 'save' || msg?.type === 'markDone') {
        const content: string = msg.payload?.content ?? '';
        try {
          await fs.writeFile(filePath, content, 'utf8');
          await this.gitService.stageFile(relPath);
          vscode.window.showInformationMessage(`Forge: Saved ${path.basename(filePath)}`);
          if (msg.type === 'markDone') panel.dispose();
        } catch (e: any) {
          vscode.window.showErrorMessage(`Forge: Save failed — ${e?.message ?? String(e)}`);
        }
      }
    });
  }

  private renderHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const n = nonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'dist', 'webviews', 'mergeEditor', 'index.js')
    );
    const csp = [
      "default-src 'none'",
      `script-src 'nonce-${n}' 'unsafe-eval' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net`,
      "style-src 'unsafe-inline' https://cdnjs.cloudflare.com",
      "font-src https://cdnjs.cloudflare.com",
      `img-src ${webview.cspSource} data:`,
      "worker-src blob:",
      "connect-src https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp};" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Forge Merge Editor</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${n}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
