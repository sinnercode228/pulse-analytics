import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadAppConfig } from './config';
import { createDataSource } from './data';
import './styles/app.css';

const dataSource = createDataSource(loadAppConfig());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App dataSource={dataSource} />
  </StrictMode>,
);
