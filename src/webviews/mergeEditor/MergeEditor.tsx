import React, { useEffect, useRef, useState, useCallback } from 'react';
import { parseConflicts, ConflictChunk } from '../../mergeEditor/conflictParser';

declare const acquireVsCodeApi: () => any;
declare const window: any;

const vscode = acquireVsCodeApi();

const MONACO_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min';

interface InitPayload {
  filePath: string;
  fileName: string;
  base: string;
  ours: string;
  theirs: string;
  language: string;
}

type MonacoEditor = any;

function loadMonaco(): Promise<any> {
  if ((window as any).__forgeMonacoPromise) return (window as any).__forgeMonacoPromise;
  (window as any).__forgeMonacoPromise = new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `${MONACO_BASE}/vs/editor/editor.main.min.css`;
    document.head.appendChild(link);
    const loader = document.createElement('script');
    loader.src = `${MONACO_BASE}/vs/loader.min.js`;
    loader.onload = () => {
      const req = (window as any).require;
      req.config({ paths: { vs: `${MONACO_BASE}/vs` } });
      req(['vs/editor/editor.main'], () => resolve((window as any).monaco));
    };
    loader.onerror = reject;
    document.body.appendChild(loader);
  });
  return (window as any).__forgeMonacoPromise;
}

function buildResultText(initial: string, chunks: ConflictChunk[], chosen: Map<string, 'ours' | 'theirs'>): string {
  const lines = initial.split('\n');
  const out: string[] = [];
  let i = 0;
  let chunkIdx = 0;
  while (i < lines.length) {
    const ch = chunks[chunkIdx];
    if (ch && i === ch.startLine) {
      const pick = chosen.get(ch.id);
      if (pick === 'ours') out.push(...ch.ours);
      else if (pick === 'theirs') out.push(...ch.theirs);
      else {
        out.push(`<<<<<<< YOURS`);
        out.push(...ch.ours);
        if (ch.baseLines) {
          out.push('|||||||');
          out.push(...ch.baseLines);
        }
        out.push('=======');
        out.push(...ch.theirs);
        out.push('>>>>>>> THEIRS');
      }
      i = ch.endLine + 1;
      chunkIdx++;
    } else {
      out.push(lines[i]);
      i++;
    }
  }
  return out.join('\n');
}

function PaneEditor(props: { value: string; language: string; readOnly: boolean; onMount?: (e: MonacoEditor) => void; onChange?: (v: string) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<MonacoEditor | null>(null);

  useEffect(() => {
    let disposed = false;
    loadMonaco().then((monaco) => {
      if (disposed || !ref.current) return;
      const ed = monaco.editor.create(ref.current, {
        value: props.value,
        language: props.language,
        readOnly: props.readOnly,
        automaticLayout: true,
        minimap: { enabled: !props.readOnly },
        scrollBeyondLastLine: false,
        fontSize: 13,
        theme: 'vs-dark',
      });
      editorRef.current = ed;
      props.onMount?.(ed);
      if (props.onChange) {
        ed.onDidChangeModelContent(() => props.onChange!(ed.getValue()));
      }
    });
    return () => {
      disposed = true;
      editorRef.current?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const ed = editorRef.current;
    if (ed && ed.getValue() !== props.value) {
      const pos = ed.getPosition();
      ed.setValue(props.value);
      if (pos) ed.setPosition(pos);
    }
  }, [props.value]);

  return <div ref={ref} style={{ width: '100%', height: '100%' }} />;
}

export const MergeEditor: React.FC = () => {
  const [init, setInit] = useState<InitPayload | null>(null);
  const [chunks, setChunks] = useState<ConflictChunk[]>([]);
  const [chosen, setChosen] = useState<Map<string, 'ours' | 'theirs'>>(new Map());
  const [currentIdx, setCurrentIdx] = useState(0);
  const [result, setResult] = useState('');
  const [editing, setEditing] = useState<{ chunkId: string; side: 'ours' | 'theirs'; text: string } | null>(null);
  const initialFileRef = useRef<string>('');

  const stateRef = useRef({ chunks: [] as ConflictChunk[], chosen: new Map<string, 'ours' | 'theirs'>(), currentIdx: 0, result: '' });
  stateRef.current = { chunks, chosen, currentIdx, result };

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const msg = e.data;
      if (msg?.type === 'command') {
        const cmd = msg.payload?.command as string;
        const st = stateRef.current;
        if (cmd === 'nextConflict') setCurrentIdx((i) => Math.min(st.chunks.length - 1, i + 1));
        else if (cmd === 'prevConflict') setCurrentIdx((i) => Math.max(0, i - 1));
        else if (cmd === 'acceptYours' || cmd === 'acceptTheirs') {
          const ch = st.chunks[st.currentIdx];
          const side: 'ours' | 'theirs' = cmd === 'acceptYours' ? 'ours' : 'theirs';
          if (ch) {
            setChosen((prev) => {
              const next = new Map(prev);
              next.set(ch.id, side);
              return next;
            });
            const nextIdx = st.chunks.findIndex((c, i) => i > st.currentIdx && !st.chosen.has(c.id));
            if (nextIdx >= 0) setCurrentIdx(nextIdx);
          }
        } else if (cmd === 'save') {
          vscode.postMessage({ type: 'save', payload: { content: st.result } });
        }
        return;
      }
      if (msg?.type === 'init') {
        const p: InitPayload = msg.payload;
        setInit(p);
        // The current file content (with markers) is reconstructable from ours/theirs;
        // but we want to parse the actual file. Request it via a synthetic concat.
        // Instead derive a markered text from p.ours/p.theirs by stitching chunks via parse of "current file"
        // The provider sends the 3 sides. We need the markered file too — we'll use "ours" content if no markers,
        // but for parsing chunks we need an actual conflict text. Use ours if it has markers; otherwise reconstruct.
        const markered = /^<{7}/m.test(p.ours) ? p.ours : reconstructMarkered(p.ours, p.theirs, p.base);
        const parsed = parseConflicts(markered);
        setChunks(parsed.chunks);
        initialFileRef.current = markered;
        setResult(markered);
      }
    };
    window.addEventListener('message', handler);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', handler);
  }, []);

  useEffect(() => {
    if (!init) return;
    setResult(buildResultText(initialFileRef.current, chunks, chosen));
  }, [chosen, chunks, init]);

  const startEdit = useCallback((chunkId: string, side: 'ours' | 'theirs') => {
    const ch = chunks.find((c) => c.id === chunkId);
    if (!ch) return;
    setEditing({ chunkId, side, text: (side === 'ours' ? ch.ours : ch.theirs).join('\n') });
  }, [chunks]);

  const commitEdit = useCallback(() => {
    if (!editing) return;
    const newLines = editing.text.split('\n');
    setChunks((prev) => prev.map((c) => {
      if (c.id !== editing.chunkId) return c;
      return { ...c, [editing.side]: newLines } as ConflictChunk;
    }));
    setChosen((prev) => {
      const next = new Map(prev);
      next.set(editing.chunkId, editing.side);
      return next;
    });
    setEditing(null);
  }, [editing]);

  const accept = useCallback((chunkId: string, side: 'ours' | 'theirs') => {
    setChosen((prev) => {
      const next = new Map(prev);
      next.set(chunkId, side);
      return next;
    });
    const idx = chunks.findIndex((c) => c.id === chunkId);
    const nextUnresolved = chunks.findIndex((c, i) => i > idx && !chosen.has(c.id));
    if (nextUnresolved >= 0) setCurrentIdx(nextUnresolved);
  }, [chunks, chosen]);

  const save = (close: boolean) => {
    vscode.postMessage({ type: close ? 'markDone' : 'save', payload: { content: result } });
  };

  if (!init) {
    return <div style={{ padding: 16, color: 'var(--vscode-editor-foreground)' }}>Loading…</div>;
  }

  const resolvedCount = chosen.size;

  return (
    <div style={{
      display: 'grid',
      gridTemplateRows: '36px 1fr 1fr 36px',
      height: '100vh',
      width: '100vw',
      background: 'var(--vscode-editor-background)',
      color: 'var(--vscode-editor-foreground)',
      fontFamily: 'var(--vscode-font-family)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '0 12px', borderBottom: '1px solid var(--vscode-focusBorder)', justifyContent: 'space-between' }}>
        <div><strong>FORGE MERGE</strong> — {init.fileName}</div>
        <div>
          <button onClick={() => save(false)} style={btnStyle}>Save</button>
          <button onClick={() => save(true)} style={{ ...btnStyle, marginLeft: 8 }}>✓ Mark Done</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', borderBottom: '1px solid var(--vscode-focusBorder)' }}>
        <SidePane title="● YOURS (current)" content={init.ours} language={init.language} bg="rgba(86,156,214,0.08)" chunks={chunks} side="ours" onAccept={accept} onEdit={startEdit} chosen={chosen} />
        <SidePane title="◎ BASE (common ancestor)" content={init.base} language={init.language} bg="rgba(255,255,255,0.02)" chunks={chunks} side="base" onAccept={accept} onEdit={startEdit} chosen={chosen} />
        <SidePane title="● THEIRS (incoming)" content={init.theirs} language={init.language} bg="rgba(181,206,168,0.08)" chunks={chunks} side="theirs" onAccept={accept} onEdit={startEdit} chosen={chosen} />
      </div>

      <div>
        <PaneEditor value={result} language={init.language} readOnly={false} onChange={setResult} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', padding: '0 12px', borderTop: '1px solid var(--vscode-focusBorder)', gap: 12 }}>
        <button onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))} style={btnStyle}>← Prev</button>
        <button onClick={() => setCurrentIdx((i) => Math.min(chunks.length - 1, i + 1))} style={btnStyle}>Next →</button>
        <span style={{ marginLeft: 'auto', opacity: 0.8 }}>{resolvedCount} of {chunks.length} resolved</span>
      </div>

      {editing && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }}
          onClick={() => setEditing(null)}
        >
          <div onClick={(e) => e.stopPropagation()} style={{
            background: 'var(--vscode-editor-background)',
            border: '1px solid var(--vscode-focusBorder)',
            padding: 16, width: '70vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            <div><strong>Edit {editing.side === 'ours' ? 'YOURS' : 'THEIRS'} — {editing.chunkId}</strong></div>
            <textarea
              value={editing.text}
              onChange={(e) => setEditing({ ...editing, text: e.target.value })}
              style={{
                flex: 1, minHeight: 240,
                background: 'var(--vscode-input-background)',
                color: 'var(--vscode-input-foreground)',
                border: '1px solid var(--vscode-input-border, transparent)',
                fontFamily: 'var(--vscode-editor-font-family)',
                fontSize: 13, padding: 8,
              }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setEditing(null)} style={btnStyle}>Cancel</button>
              <button onClick={commitEdit} style={btnStyle}>Apply</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const btnStyle: React.CSSProperties = {
  background: 'var(--vscode-button-background)',
  color: 'var(--vscode-button-foreground)',
  border: 'none',
  padding: '4px 10px',
  cursor: 'pointer',
  fontSize: 12,
};

function SidePane(props: {
  title: string;
  content: string;
  language: string;
  bg: string;
  chunks: ConflictChunk[];
  side: 'ours' | 'base' | 'theirs';
  onAccept: (id: string, side: 'ours' | 'theirs') => void;
  onEdit: (id: string, side: 'ours' | 'theirs') => void;
  chosen: Map<string, 'ours' | 'theirs'>;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateRows: '24px 1fr', borderRight: '1px solid var(--vscode-focusBorder)', background: props.bg, position: 'relative' }}>
      <div style={{ fontSize: 11, padding: '4px 8px', opacity: 0.85, borderBottom: '1px solid var(--vscode-focusBorder)' }}>{props.title}</div>
      <div style={{ position: 'relative' }}>
        <PaneEditor value={props.content} language={props.language} readOnly={true} />
        {props.side !== 'base' && (
          <div style={{ position: 'absolute', top: 4, right: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {props.chunks.map((c) => {
              const isChosen = props.chosen.get(c.id) === props.side;
              return (
                <div key={c.id} style={{ display: 'flex', gap: 4 }}>
                  <button
                    onClick={() => props.onAccept(c.id, props.side as 'ours' | 'theirs')}
                    style={{ ...btnStyle, opacity: isChosen ? 1 : 0.85, fontSize: 10 }}
                    title={`Accept ${props.side} for ${c.id}`}
                  >
                    {isChosen ? '✓ ' : ''}Accept {props.side === 'ours' ? 'Yours' : 'Theirs'} ({c.id})
                  </button>
                  <button
                    onClick={() => props.onEdit(c.id, props.side as 'ours' | 'theirs')}
                    style={{ ...btnStyle, fontSize: 10 }}
                    title={`Edit ${props.side} for ${c.id}`}
                  >Edit</button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function reconstructMarkered(ours: string, theirs: string, base: string): string {
  const oursLines = ours.split('\n');
  const theirsLines = theirs.split('\n');
  const baseLines = base ? base.split('\n') : [];
  const out: string[] = [];
  out.push('<<<<<<< YOURS');
  out.push(...oursLines);
  if (baseLines.length) {
    out.push('|||||||');
    out.push(...baseLines);
  }
  out.push('=======');
  out.push(...theirsLines);
  out.push('>>>>>>> THEIRS');
  return out.join('\n');
}
