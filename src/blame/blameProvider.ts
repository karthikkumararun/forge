import * as vscode from 'vscode';
import * as path from 'path';
import { GitService } from '../git/gitService';

export interface BlameLine {
  sha: string;
  author: string;
  authorTime: number;
  summary: string;
}

export class BlameProvider implements vscode.Disposable {
  private cache = new Map<string, BlameLine[]>();
  private decoration: vscode.TextEditorDecorationType;
  private enabled = true;
  private disposables: vscode.Disposable[] = [];

  constructor(private git: GitService, private workspaceRoot: string) {
    this.decoration = vscode.window.createTextEditorDecorationType({
      after: {
        margin: '0 0 0 2em',
        color: new vscode.ThemeColor('editorCodeLens.foreground'),
        fontStyle: 'italic',
      },
    });

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((ed) => this.refresh(ed)),
      vscode.workspace.onDidSaveTextDocument(() => {
        this.cache.clear();
        this.refresh(vscode.window.activeTextEditor);
      }),
      vscode.window.onDidChangeTextEditorSelection((e) => this.applyDecorations(e.textEditor)),
    );
    this.refresh(vscode.window.activeTextEditor);
  }

  toggle(): void {
    this.enabled = !this.enabled;
    if (!this.enabled) {
      vscode.window.visibleTextEditors.forEach((e) => e.setDecorations(this.decoration, []));
    } else {
      this.refresh(vscode.window.activeTextEditor);
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  private async refresh(editor?: vscode.TextEditor): Promise<void> {
    if (!this.enabled || !editor) return;
    const doc = editor.document;
    if (doc.uri.scheme !== 'file') return;
    const rel = path.relative(this.workspaceRoot, doc.uri.fsPath).replace(/\\/g, '/');
    if (rel.startsWith('..')) return;

    let lines = this.cache.get(doc.uri.fsPath);
    if (!lines) {
      try {
        const raw = await this.git.blame(rel);
        lines = parsePorcelain(raw);
        this.cache.set(doc.uri.fsPath, lines);
      } catch {
        return;
      }
    }
    this.applyDecorations(editor);
  }

  private applyDecorations(editor: vscode.TextEditor): void {
    if (!this.enabled) return;
    const lines = this.cache.get(editor.document.uri.fsPath);
    if (!lines) return;
    const sel = editor.selection.active.line;
    const decos: vscode.DecorationOptions[] = [];
    const bl = lines[sel];
    if (bl) {
      const date = new Date(bl.authorTime * 1000);
      const ago = relativeTime(date);
      const text = bl.sha.startsWith('0000') ? 'Uncommitted' : `${bl.author}, ${ago} • ${bl.summary}`;
      const range = editor.document.lineAt(sel).range;
      decos.push({
        range: new vscode.Range(range.end, range.end),
        renderOptions: { after: { contentText: `   ${text}` } },
      });
    }
    editor.setDecorations(this.decoration, decos);
  }

  dispose(): void {
    this.decoration.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}

function parsePorcelain(out: string): BlameLine[] {
  const lines = out.split('\n');
  const result: BlameLine[] = [];
  const meta = new Map<string, { author?: string; authorTime?: number; summary?: string }>();
  let i = 0;
  while (i < lines.length) {
    const header = lines[i];
    const m = header.match(/^([0-9a-f]{40}) (\d+) (\d+)(?: (\d+))?$/);
    if (!m) { i++; continue; }
    const sha = m[1];
    let entry = meta.get(sha) ?? {};
    i++;
    while (i < lines.length && !lines[i].startsWith('\t')) {
      const line = lines[i];
      if (line.startsWith('author ')) entry.author = line.slice(7);
      else if (line.startsWith('author-time ')) entry.authorTime = parseInt(line.slice(12), 10);
      else if (line.startsWith('summary ')) entry.summary = line.slice(8);
      i++;
    }
    meta.set(sha, entry);
    if (i < lines.length && lines[i].startsWith('\t')) i++; // content line
    result.push({
      sha,
      author: entry.author ?? '',
      authorTime: entry.authorTime ?? 0,
      summary: entry.summary ?? '',
    });
  }
  return result;
}

function relativeTime(date: Date): string {
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 86400 * 365) return `${Math.floor(diff / (86400 * 30))}mo ago`;
  return `${Math.floor(diff / (86400 * 365))}y ago`;
}
