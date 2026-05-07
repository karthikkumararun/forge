import * as vscode from 'vscode';
import { GitService } from './gitService';

export class ShowContentProvider implements vscode.TextDocumentContentProvider {
  static readonly scheme = 'forge-show';
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private git: GitService) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const q = uri.query;
    const sep = q.indexOf(':');
    if (sep < 0) return '';
    const sha = q.slice(0, sep);
    const relPath = q.slice(sep + 1);
    try {
      return await this.git.showFileAtCommit(sha, relPath);
    } catch {
      return '';
    }
  }
}
