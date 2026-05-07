import React from 'react';
import { createRoot } from 'react-dom/client';
import { MergeEditor } from './MergeEditor';

const container = document.getElementById('root')!;
const root = createRoot(container);
root.render(<MergeEditor />);
