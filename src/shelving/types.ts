export interface ShelfMeta {
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
}
