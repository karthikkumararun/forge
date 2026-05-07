import React, { useMemo } from 'react';

declare const acquireVsCodeApi: () => any;

interface CommitNode {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  authorEmail: string;
  date: string;
  parents: string[];
  refs: string[];
}

function parseStatFiles(stat: string): { path: string; summary: string }[] {
  if (!stat) return [];
  const lines = stat.split('\n');
  const out: { path: string; summary: string }[] = [];
  for (const line of lines) {
    const m = line.match(/^\s(.+?)\s*\|\s*(.+)$/);
    if (m) out.push({ path: m[1].trim(), summary: m[2].trim() });
  }
  return out;
}

export const CommitDetail: React.FC<{ commit: CommitNode; stat: string; onClose: () => void }> = ({ commit, stat, onClose }) => {
  const files = useMemo(() => parseStatFiles(stat), [stat]);
  const vscode = (window as any).__forgeVscode ?? ((window as any).__forgeVscode = acquireVsCodeApi());

  const openFile = (filePath: string) => {
    vscode.postMessage({ type: 'openFileAtCommit', payload: { sha: commit.sha, parent: commit.parents[0], filePath } });
  };

  return (
    <div style={{
      borderLeft: '1px solid var(--vscode-focusBorder)',
      padding: 12,
      overflow: 'auto',
      background: 'var(--vscode-sideBar-background)',
      fontSize: 12,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <strong>Commit Detail</strong>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer' }}>✕</button>
      </div>
      <div style={{ fontFamily: 'var(--vscode-editor-font-family)', wordBreak: 'break-all', marginBottom: 8 }}>
        <code>{commit.sha}</code>
      </div>
      <div style={{ marginBottom: 8 }}>
        <div><strong>{commit.author}</strong> &lt;{commit.authorEmail}&gt;</div>
        <div style={{ opacity: 0.8 }}>{new Date(commit.date).toLocaleString()}</div>
      </div>
      <div style={{ whiteSpace: 'pre-wrap', marginBottom: 12, padding: 8, background: 'var(--vscode-editor-background)' }}>
        {commit.message}
      </div>
      {commit.refs.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {commit.refs.map((r) => (
            <span key={r} style={{ display: 'inline-block', padding: '2px 6px', marginRight: 4, marginBottom: 4, background: 'var(--vscode-badge-background)', color: 'var(--vscode-badge-foreground)', borderRadius: 3, fontSize: 11 }}>{r}</span>
          ))}
        </div>
      )}
      <div>
        <div style={{ marginBottom: 4, opacity: 0.8 }}>Changed files</div>
        {files.length === 0 ? (
          <div style={{ opacity: 0.6 }}>{stat ? 'No file stats' : 'Loading…'}</div>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {files.map((f) => (
              <li key={f.path} style={{ padding: '3px 0' }}>
                <a
                  onClick={() => openFile(f.path)}
                  style={{ color: 'var(--vscode-textLink-foreground)', cursor: 'pointer', textDecoration: 'none' }}
                  title={`Open diff for ${f.path}`}
                >{f.path}</a>
                <span style={{ opacity: 0.6, marginLeft: 8 }}>{f.summary}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
