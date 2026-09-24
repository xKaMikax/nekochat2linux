const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('windowControls', {
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  setWindowMeta: (title, icon) => ipcRenderer.send('window:set-meta', { title, icon }),
  openThemeSettings: () => ipcRenderer.send('theme:open-settings'),
  openProfileSettings: () => ipcRenderer.send('profile:open-settings'),
  listThemes: () => ipcRenderer.invoke('theme:list'),
  getActiveTheme: () => ipcRenderer.invoke('theme:current'),
  previewTheme: (id, scheme) => ipcRenderer.invoke('theme:preview', id, scheme),
  applyTheme: (id, scheme) => ipcRenderer.invoke('theme:apply', id, scheme),
  importTheme: () => ipcRenderer.invoke('theme:import'),
  onThemeChanged: callback => ipcRenderer.on('theme:changed', (_, data) => callback(data)),
  onProfileChanged: callback => ipcRenderer.on('profile:changed', (_, data) => callback(data)),
  profileChanged: user => ipcRenderer.send('profile:changed', user),
  resize: (direction, dx, dy) => ipcRenderer.send('window:resize', { direction, dx, dy })
});
