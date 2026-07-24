import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/index.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Không tìm thấy #root trong index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
