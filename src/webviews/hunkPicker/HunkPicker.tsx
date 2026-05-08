import React, { useEffect, useMemo, useState } from 'react';

declare const acquireVsCodeApi: () => any;
const vscode = acquireVsCodeApi();

interface PatchHunk {
  id: string;
  header: string;
  body: string;
  raw: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
}

interface PatchFile {
  path: string;
  status: 'A' | 'M' | 'D' | 'R';
  oldPath?: string;
  fileHeader: string;
  hunks: PatchHunk[];
}

type Mode = 'shelve' | 'unshelve';

interface InitPayload {
  mode: Mode;
  title: string;
  files: PatchFile[];
  shelfName?: string;
}

const STATUS_LABEL: Record<PatchFile['status'], string> = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed' };
const STATUS_COLOR: Record<PatchFile['status'], string> = {
  A: 'var(--vscode-gitDecoration-addedResourceForeground, #6cc644)',
  M: 'var(--vscode-gitDecoration-modifiedResourceForeground, #d18616)',
  D: 'var(--vscode-gitDecoration-deletedResourceForeground, #cb2431)',
  R: 'var(--vscode-gitDecoration-renamedResourceForeground, #00ad9a)',
};

export const HunkPicker: React.FC = () => {
  const [init, setInit] = useState<InitPayload | undefined>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [removeAfter, setRemoveAfter] = useState(false);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const msg = e.data;
      if (msg?.type === 'init') {
        const p: InitPayload = msg.payload;
        setInit(p);
        const all = new Set<string>();
        for (const f of p.files) for (const h of f.hunks) all.add(h.id);
        setSelected(all);
      }
    };
    window.addEventListener('message', handler);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', handler);
  }, []);

  const totalHunks = useMemo(() => init?.files.reduce((n, f) => n + f.hunks.length, 0) ?? 0, [init]);

  if (!init) return <div style={{ padding: 16 }}>Loading…</div>;

  const toggleHunk = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const toggleFile = (f: PatchFile) => {
    const allOn = f.hunks.every((h) => selected.has(h.id));
    setSelected((prev) => {
      const n = new Set(prev);
      for (const h of f.hunks) {
        if (allOn) n.delete(h.id);
        else n.add(h.id);
      }
      return n;
    });
  };
  const toggleCollapsed = (p: string) => {
    setCollapsed((prev) => {
      const n = new Set(prev);
      if (n.has(p)) n.delete(p); else n.add(p);
      return n;
    });
  };

  const fileTri = (f: PatchFile): 'all' | 'none' | 'partial' => {
    const total = f.hunks.length;
    if (total === 0) return 'none';
    const on = f.hunks.filter((h) => selected.has(h.id)).length;
    if (on === total) return 'all';
    if (on === 0) return 'none';
    return 'partial';
  };

  const submit = () => {
    if (init.mode === 'shelve') {
      if (!name.trim()) {
        vscode.postMessage({ type: 'error', payload: 'Name is required' });
        return;
      }
      vscode.postMessage({
        type: 'submit',
        payload: { name: name.trim(), description, hunkIds: Array.from(selected) },
      });
    } else {
      vscode.postMessage({
        type: 'submit',
        payload: { hunkIds: Array.from(selected), removeAfter },
      });
    }
  };

  const cancel = () => vscode.postMessage({ type: 'cancel' });

  const styles: Record<string, React.CSSProperties> = {
    page: { fontFamily: 'var(--vscode-font-family)', color: 'var(--vscode-foreground)', padding: 12 },
    header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12 },
    title: { fontSize: 14, fontWeight: 600 },
    counter: { fontSize: 12, opacity: 0.75 },
    file: { border: '1px solid var(--vscode-panel-border)', borderRadius: 4, marginBottom: 8 },
    fileRow: { display: 'flex', alignItems: 'center', padding: '6px 8px', cursor: 'pointer', gap: 8, background: 'var(--vscode-sideBarSectionHeader-background)' },
    chevron: { width: 12, opacity: 0.6 },
    statusTag: { fontSize: 10, padding: '0 6px', borderRadius: 2, fontWeight: 600 },
    filename: { flex: 1, fontFamily: 'var(--vscode-editor-font-family)', fontSize: 12 },
    fileHunkCount: { fontSize: 11, opacity: 0.6 },
    hunk: { borderTop: '1px solid var(--vscode-panel-border)', padding: '6px 8px 4px 28px', display: 'flex', gap: 8 },
    hunkBody: { flex: 1, fontFamily: 'var(--vscode-editor-font-family)', fontSize: 11, whiteSpace: 'pre', overflowX: 'auto', margin: 0 },
    hunkHeader: { color: 'var(--vscode-descriptionForeground)', marginBottom: 2 },
    line: (tag: string): React.CSSProperties => ({
      background:
        tag === '+' ? 'var(--vscode-diffEditor-insertedLineBackground, rgba(108,198,68,0.18))' :
        tag === '-' ? 'var(--vscode-diffEditor-removedLineBackground, rgba(203,36,49,0.18))' :
        'transparent',
      display: 'block',
    }),
    actions: { display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' },
    btn: { background: 'var(--vscode-button-background)', color: 'var(--vscode-button-foreground)', border: 0, padding: '6px 12px', cursor: 'pointer', borderRadius: 2, fontSize: 12 },
    btnSecondary: { background: 'var(--vscode-button-secondaryBackground)', color: 'var(--vscode-button-secondaryForeground)', border: 0, padding: '6px 12px', cursor: 'pointer', borderRadius: 2, fontSize: 12 },
    input: { background: 'var(--vscode-input-background)', color: 'var(--vscode-input-foreground)', border: '1px solid var(--vscode-input-border, transparent)', padding: '4px 6px', fontSize: 12, flex: 1 },
    formRow: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 },
    formLabel: { width: 88, fontSize: 12, opacity: 0.85 },
  };

  const renderHunkBody = (raw: string) => {
    const lines = raw.split('\n');
    const header = lines[0];
    const body = lines.slice(1);
    while (body.length > 0 && body[body.length - 1] === '') body.pop();
    return (
      <pre style={styles.hunkBody}>
        <span style={styles.hunkHeader}>{header}</span>
        {'\n'}
        {body.map((ln, i) => {
          const tag = ln[0] ?? ' ';
          return <span key={i} style={styles.line(tag)}>{ln}{'\n'}</span>;
        })}
      </pre>
    );
  };

  const selCount = selected.size;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div style={styles.title}>{init.title}</div>
        <div style={styles.counter}>{selCount} / {totalHunks} hunk{totalHunks === 1 ? '' : 's'} selected</div>
      </div>

      {init.mode === 'shelve' && (
        <div style={{ marginBottom: 12 }}>
          <div style={styles.formRow}>
            <label style={styles.formLabel}>Name</label>
            <input style={styles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. wip-feature" autoFocus />
          </div>
          <div style={styles.formRow}>
            <label style={styles.formLabel}>Description</label>
            <input style={styles.input} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="(optional)" />
          </div>
        </div>
      )}

      {init.files.map((f) => {
        const tri = fileTri(f);
        const isCollapsed = collapsed.has(f.path);
        return (
          <div key={f.path} style={styles.file}>
            <div style={styles.fileRow} onClick={() => toggleCollapsed(f.path)}>
              <span style={styles.chevron}>{isCollapsed ? '▸' : '▾'}</span>
              <input
                type="checkbox"
                checked={tri === 'all'}
                ref={(el) => { if (el) el.indeterminate = tri === 'partial'; }}
                onClick={(e) => e.stopPropagation()}
                onChange={() => toggleFile(f)}
              />
              <span style={{ ...styles.statusTag, color: STATUS_COLOR[f.status] }}>{STATUS_LABEL[f.status]}</span>
              <span style={styles.filename}>{f.path}{f.oldPath && f.oldPath !== f.path ? `  ← ${f.oldPath}` : ''}</span>
              <span style={styles.fileHunkCount}>{f.hunks.length} hunk{f.hunks.length === 1 ? '' : 's'}</span>
            </div>
            {!isCollapsed && f.hunks.map((h) => (
              <div key={h.id} style={styles.hunk}>
                <input
                  type="checkbox"
                  checked={selected.has(h.id)}
                  onChange={() => toggleHunk(h.id)}
                />
                {renderHunkBody(h.raw)}
              </div>
            ))}
          </div>
        );
      })}

      <div style={styles.actions}>
        {init.mode === 'unshelve' && (
          <label style={{ fontSize: 12, display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={removeAfter} onChange={(e) => setRemoveAfter(e.target.checked)} />
            Remove from shelf after apply
          </label>
        )}
        <span style={{ flex: 1 }} />
        <button style={styles.btnSecondary} onClick={cancel}>Cancel</button>
        <button style={styles.btn} onClick={submit} disabled={selCount === 0}>
          {init.mode === 'shelve' ? 'Shelve Selected' : 'Unshelve Selected'}
        </button>
      </div>
    </div>
  );
};
