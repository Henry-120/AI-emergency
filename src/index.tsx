
import React from 'react';
import ReactDOM from 'react-dom/client';
<<<<<<< HEAD
import { Capacitor } from '@capacitor/core';
import App from './App';

if (Capacitor.getPlatform() !== 'web') {
  document.documentElement.classList.add('capacitor-native');
}

=======
import App from './App';

>>>>>>> 58fdbf595c177e942c8e1e94f609c964f5121f17
const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
