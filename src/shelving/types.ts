export type ShelfFileStatus = 'A' | 'M' | 'D' | 'R';

export interface ShelfFileEntry {
  path: string;
  status: ShelfFileStatus;
  oldPath?: string;
  patchOffset: number;
  patchLength: number;
}

export type ShelfOrigin = 'manual' | 'auto-checkout' | 'auto-pull' | 'auto-merge' | 'auto-rebase';

export interface ShelfMeta {
  schemaVersion?: 2;
  name: string;
  displayName: string;
  description: string;
  createdAt: string;
  updatedAt?: string;
  branch: string;
  baseCommit: string;
  files: ShelfFileEntry[];
  origin?: ShelfOrigin;
}

export interface ShelfMetaV1 {
  name: string;
  displayName: string;
  description: string;
  createdAt: string;
  branch: string;
  baseCommit: string;
  files: string[];
}

export interface ShelfItem {
  meta: ShelfMeta;
  patchPath: string;
  metaPath: string;
  trashed?: boolean;
  deletedAt?: string;
}

export interface UnshelveResult {
  applied: string[];
  conflicted: string[];
  skipped: string[];
  shelfRemaining: boolean;
}

export interface UnshelveOptions {
  files?: string[];
  keep?: boolean;
  onConflict?: 'abort' | 'merge';
}
