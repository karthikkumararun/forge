import React, { useEffect, useState } from 'react';

declare const acquireVsCodeApi: () => any;
const vscode = acquireVsCodeApi();

type Action = 'pick' | 'squash' | 'fixup' | 'drop' | 'reword' | 'edit';

interface CommitNode {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
}

interface Step {
  sha: string;
  action: Action;
  message: string;
}

const ACTIONS: Action[] = ['pick', 'squash', 'fixup', 'reword', 'edit', 'drop'];

export const RebaseUI: React.FC = () => {
  const [baseRef, setBaseRef] = useState('');
  const [steps, setSteps] = useState<Step[]>([]);
  const [output, setOutput] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const msg = e.data;
      if (msg?.type === 'init') {
        setBaseRef(msg.payload.baseRef);
        setSteps(msg.payload.commits.map((c: CommitNode) => ({ sha: c.sha, action: 'pick' as Action, message: c.message })));
      } else if (msg?.type === 'result') {
        setBusy(false);
        setOutput(msg.payload.output ?? '');
      }
    };
    window.addEventListener('message', handler);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', handler);
  }, []);

  const move = (i: number, dir: -1 | 1) => {
    setSteps((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const setAction = (i: number, action: Action) => {
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, action } : s)));
  };

  const apply = () => {
    setBusy(true);
    setOutput('');
    vscode.postMessage({ type: 'apply', payload: { steps } });
  };

  return (
    <div style={{
      padding: 16, fontFamily: 'var(--vscode-font-family)',
      background: 'var(--vscode-editor-background)', color: 'var(--vscode-editor-foreground)',
      minHeight: '100vh',
    }}>
      <h2 style={{ marginTop: 0 }}>Interactive Rebase onto <code>{baseRef}</code></h2>
      <p style={{ opacity: 0.8, fontSize: 12 }}>
        Top of list is applied first (oldest). Reorder with ↑/↓. Drop to remove. Squash/fixup folds into the previous commit.
        Reword/edit will pause the rebase — finish it manually after.
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--vscode-focusBorder)' }}>
            <th style={th}>#</th>
            <th style={th}>Action</th>
            <th style={th}>SHA</th>
            <th style={th}>Message</th>
            <th style={th}>Move</th>
          </tr>
        </thead>
        <tbody>
          {steps.map((s, i) => (
            <tr key={s.sha} style={{ borderBottom: '1px solid var(--vscode-focusBorder)', opacity: s.action === 'drop' ? 0.4 : 1 }}>
              <td style={td}>{i + 1}</td>
              <td style={td}>
                <select value={s.action} onChange={(e) => setAction(i, e.target.value as Action)} style={selStyle}>
                  {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </td>
              <td style={{ ...td, fontFamily: 'var(--vscode-editor-font-family)' }}>{s.sha.slice(0, 7)}</td>
              <td style={td}>{s.message.split('\n')[0]}</td>
              <td style={td}>
                <button onClick={() => move(i, -1)} style={btnStyle}>↑</button>
                <button onClick={() => move(i, 1)} style={{ ...btnStyle, marginLeft: 4 }}>↓</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <button onClick={apply} disabled={busy} style={{ ...btnStyle, padding: '6px 14px' }}>
          {busy ? 'Rebasing…' : 'Apply Rebase'}
        </button>
        <button onClick={() => vscode.postMessage({ type: 'cancel' })} style={{ ...btnStyle, padding: '6px 14px' }}>Cancel</button>
      </div>
      {output && (
        <pre style={{
          marginTop: 16, padding: 12, background: 'var(--vscode-textCodeBlock-background, #1e1e1e)',
          fontFamily: 'var(--vscode-editor-font-family)', fontSize: 12, whiteSpace: 'pre-wrap',
        }}>{output}</pre>
      )}
    </div>
  );
};

const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', fontWeight: 600 };
const td: React.CSSProperties = { padding: '6px 8px', verticalAlign: 'top' };
const btnStyle: React.CSSProperties = {
  background: 'var(--vscode-button-background)',
  color: 'var(--vscode-button-foreground)',
  border: 'none', padding: '3px 8px', cursor: 'pointer', fontSize: 12,
};
const selStyle: React.CSSProperties = {
  background: 'var(--vscode-dropdown-background)',
  color: 'var(--vscode-dropdown-foreground)',
  border: '1px solid var(--vscode-dropdown-border, transparent)',
  padding: '3px 6px',
};
