import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { CommitDetail } from './CommitDetail';

declare const acquireVsCodeApi: () => any;
const vscode = (window as any).__forgeVscode ?? ((window as any).__forgeVscode = acquireVsCodeApi());

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

const BRANCH_COLORS = ['#569cd6', '#4ec9b0', '#ce9178', '#dcdcaa', '#c586c0', '#9cdcfe', '#f48771', '#b5cea8'];

interface Layout {
  commit: CommitNode;
  lane: number;
  y: number;
}

function assignLanes(commits: CommitNode[]): Layout[] {
  const laneMap = new Map<string, number>();
  const activeLanes: (string | null)[] = [];
  const layouts: Layout[] = [];
  const ROW = 28;

  const claim = (sha: string): number => {
    let lane = laneMap.get(sha);
    if (lane !== undefined) return lane;
    for (let i = 0; i < activeLanes.length; i++) {
      if (activeLanes[i] === null) {
        activeLanes[i] = sha;
        laneMap.set(sha, i);
        return i;
      }
    }
    activeLanes.push(sha);
    const idx = activeLanes.length - 1;
    laneMap.set(sha, idx);
    return idx;
  };

  commits.forEach((c, i) => {
    const lane = claim(c.sha);
    layouts.push({ commit: c, lane, y: i * ROW + 20 });
    activeLanes[lane] = null;
    if (c.parents.length > 0) {
      activeLanes[lane] = c.parents[0];
      laneMap.set(c.parents[0], lane);
      for (let p = 1; p < c.parents.length; p++) claim(c.parents[p]);
    }
  });

  return layouts;
}

export const GitGraph: React.FC = () => {
  const [commits, setCommits] = useState<CommitNode[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [branchFilter, setBranchFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<CommitNode | null>(null);
  const [stat, setStat] = useState<string>('');
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const msg = e.data;
      if (msg?.type === 'init') {
        setCommits(msg.payload.commits);
        setBranches(msg.payload.branches ?? []);
      }
      else if (msg?.type === 'commitDetail') {
        if (msg.payload.sha === selected?.sha) setStat(msg.payload.stat);
      }
    };
    window.addEventListener('message', handler);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', handler);
  }, [selected]);

  const filtered = useMemo(() => {
    let list = commits;
    if (branchFilter) {
      list = list.filter((c) => c.refs.some((r) => r === branchFilter || r.endsWith('/' + branchFilter)));
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((c) => c.message.toLowerCase().includes(q) || c.author.toLowerCase().includes(q) || c.sha.startsWith(q));
    }
    return list;
  }, [commits, search, branchFilter]);

  const layouts = useMemo(() => assignLanes(filtered), [filtered]);
  const indexBySha = useMemo(() => new Map(layouts.map((l) => [l.commit.sha, l])), [layouts]);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (layouts.length === 0) return;

    const LANE_W = 18;
    const X0 = 16;

    const g = svg.append('g');

    const zoom = d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.3, 3]).on('zoom', (ev) => {
      g.attr('transform', ev.transform.toString());
    });
    svg.call(zoom as any);

    layouts.forEach((l) => {
      l.commit.parents.forEach((pSha) => {
        const parent = indexBySha.get(pSha);
        if (!parent) return;
        const x1 = X0 + l.lane * LANE_W;
        const y1 = l.y;
        const x2 = X0 + parent.lane * LANE_W;
        const y2 = parent.y;
        const path = d3.path();
        path.moveTo(x1, y1);
        path.bezierCurveTo(x1, (y1 + y2) / 2, x2, (y1 + y2) / 2, x2, y2);
        g.append('path')
          .attr('d', path.toString())
          .attr('stroke', BRANCH_COLORS[l.lane % BRANCH_COLORS.length])
          .attr('fill', 'none')
          .attr('stroke-width', 1.5);
      });
    });

    layouts.forEach((l) => {
      const cx = X0 + l.lane * LANE_W;
      g.append('circle')
        .attr('cx', cx)
        .attr('cy', l.y)
        .attr('r', 5)
        .attr('fill', BRANCH_COLORS[l.lane % BRANCH_COLORS.length])
        .style('cursor', 'pointer')
        .on('click', () => {
          setSelected(l.commit);
          setStat('');
          vscode.postMessage({ type: 'requestCommitDetail', payload: { sha: l.commit.sha } });
        });

      const refsText = l.commit.refs.length ? ` [${l.commit.refs.join(', ')}]` : '';
      g.append('text')
        .attr('x', X0 + 8 * LANE_W + 8)
        .attr('y', l.y + 4)
        .attr('font-size', 12)
        .attr('fill', 'var(--vscode-editor-foreground)')
        .style('font-family', 'var(--vscode-font-family)')
        .text(`${l.commit.shortSha}${refsText}  ${l.commit.message}`);

      g.append('text')
        .attr('x', X0 + 8 * LANE_W + 8 + 600)
        .attr('y', l.y + 4)
        .attr('font-size', 11)
        .attr('fill', 'var(--vscode-descriptionForeground, #888)')
        .text(`${l.commit.author} • ${new Date(l.commit.date).toLocaleDateString()}`);
    });
  }, [layouts, indexBySha]);

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: selected ? '1fr 360px' : '1fr',
      gridTemplateRows: '40px 1fr',
      height: '100vh',
      width: '100vw',
      background: 'var(--vscode-editor-background)',
      color: 'var(--vscode-editor-foreground)',
      fontFamily: 'var(--vscode-font-family)',
    }}>
      <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', padding: '0 12px', gap: 12, borderBottom: '1px solid var(--vscode-focusBorder)' }}>
        <strong>FORGE GIT GRAPH</strong>
        <select
          value={branchFilter}
          onChange={(e) => setBranchFilter(e.target.value)}
          style={{
            background: 'var(--vscode-dropdown-background)',
            color: 'var(--vscode-dropdown-foreground)',
            border: '1px solid var(--vscode-dropdown-border, transparent)',
            padding: '4px 6px',
          }}
        >
          <option value="">All branches</option>
          {branches.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <input
          placeholder="Search commits…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            background: 'var(--vscode-input-background)',
            color: 'var(--vscode-input-foreground)',
            border: '1px solid var(--vscode-input-border, transparent)',
            padding: '4px 8px',
            flex: 1,
          }}
        />
        <button
          onClick={() => vscode.postMessage({ type: 'refresh' })}
          style={{
            background: 'var(--vscode-button-background)',
            color: 'var(--vscode-button-foreground)',
            border: 'none',
            padding: '4px 10px',
            cursor: 'pointer',
          }}
        >Refresh</button>
        <span style={{ opacity: 0.7, fontSize: 12 }}>{filtered.length} commits</span>
      </div>
      <div style={{ overflow: 'auto' }}>
        <svg ref={svgRef} width={1400} height={Math.max(400, layouts.length * 28 + 40)} />
      </div>
      {selected && <CommitDetail commit={selected} stat={stat} onClose={() => setSelected(null)} />}
    </div>
  );
};
