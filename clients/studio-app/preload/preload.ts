import { contextBridge, ipcRenderer } from 'electron';

// Expose a minimal bridge so the renderer can send/receive messages
// identically to the VSCode webview postMessage API.
contextBridge.exposeInMainWorld('__canticaBridge', {
  postMessage: (msg: unknown) => ipcRenderer.send('from-renderer', msg),
});

// Forward messages from main → renderer as window.postMessage so the
// existing React store (window.addEventListener('message', ...)) works unchanged.
ipcRenderer.on('to-renderer', (_event, msg: unknown) => {
  window.postMessage(msg, '*');
});
