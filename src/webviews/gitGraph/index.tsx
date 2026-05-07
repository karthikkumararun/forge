import React from 'react';
import { createRoot } from 'react-dom/client';
import { GitGraph } from './GitGraph';

const container = document.getElementById('root')!;
createRoot(container).render(<GitGraph />);
