import React from 'react';
import ReactDOM from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

// React Flow triggers ResizeObserver notifications faster than one animation
// frame, causing a benign browser warning that CRA surfaces as an error overlay.
// Wrapping the callback in rAF prevents the warning at the source.
const _RO = window.ResizeObserver;
window.ResizeObserver = function (cb) {
  return new _RO((entries, observer) => requestAnimationFrame(() => cb(entries, observer)));
};
window.ResizeObserver.prototype = _RO.prototype;

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

reportWebVitals();
