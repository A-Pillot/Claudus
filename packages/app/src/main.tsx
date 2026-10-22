import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { initDesktop } from './desktop';
import { initSpaceMouse } from './spacemouse';

void initDesktop();
void initSpaceMouse();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
