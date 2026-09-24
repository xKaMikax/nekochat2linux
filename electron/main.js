const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { fileURLToPath, pathToFileURL } = require('url');
const fs = require('fs/promises');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const themesRoot = path.join(__dirname, 'themes');
const runtimeThemesRoot = path.join(app.getPath('temp'), 'nekochat-msstyles');
const themeStatePath = path.join(app.getPath('userData'), 'theme-selection.json');
const builtInThemes = [
  { id: 'Classic', classic: true, source: path.join(themesRoot, 'classic', 'theme.css') },
  { id: 'Luna', source: path.join(themesRoot, 'luna', 'Luna.theme') },
  { id: 'Embedded', source: path.join(themesRoot, 'embedded', 'Embedded.msstyles') },
  { id: 'Royale', source: path.join(themesRoot, 'royal', 'Royale.msstyles') },
];
let settingsWindow;
let profileWindow;
let activeTheme;

function notifyThemeChanged(theme) {
  BrowserWindow.getAllWindows().forEach(win => win.webContents.send('theme:changed', theme));
}

function openThemeSettings(owner) {
  if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.focus(); return; }
  settingsWindow = new BrowserWindow({
    title: 'Display Properties', width: 430, height: 390, resizable: false,
    parent: owner, frame: false, transparent: true, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  settingsWindow.on('closed', () => { settingsWindow = null; });
  settingsWindow.loadFile(path.join(__dirname, 'theme_settings.html'));
}

function openProfileSettings() {
  if (profileWindow && !profileWindow.isDestroyed()) { profileWindow.focus(); return; }
  profileWindow = new BrowserWindow({
    title: 'User Accounts', width: 430, height: 390, minWidth: 360, minHeight: 310, resizable: true,
    frame: false, transparent: true, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  profileWindow.on('closed', () => { profileWindow = null; });
  profileWindow.loadFile(path.join(__dirname, 'profile_settings.html'));
}

async function discoverThemes() {
  const found = new Map(builtInThemes.map(theme => [theme.id, theme]));
  const entries = await fs.readdir(themesRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || ['Current', 'Luna', 'Embedded', 'Royale'].includes(entry.name)) continue;
    const directory = path.join(themesRoot, entry.name);
    const files = await fs.readdir(directory, { withFileTypes: true });
    const source = files.find(file => file.isFile() && file.name.toLowerCase().endsWith('.theme')) || files.find(file => file.isFile() && file.name.toLowerCase().endsWith('.msstyles'));
    if (source) found.set(entry.name, { id: entry.name, source: path.join(directory, source.name) });
  }
  return [...found.values()];
}

async function prepareTheme(id) {
  const theme = (await discoverThemes()).find(item => item.id === id);
  if (!theme) throw new Error('Theme not found');
  const output = path.join(runtimeThemesRoot, id);
  await fs.mkdir(runtimeThemesRoot, { recursive: true });
  if (theme.classic) {
    const directory = path.join(output, 'schemes', 'classic');
    await fs.mkdir(directory, { recursive: true });
    await fs.copyFile(theme.source, path.join(directory, 'theme.css'));
    return { ...theme, output, metadata: { theme: 'Windows Classic', schemes: [{ id: 'classic', name: 'Windows Classic' }], defaultScheme: 'classic' } };
  }
  const sourceStat = await fs.stat(theme.source);
  const importerPath = path.join(__dirname, 'tools', 'import_msstyles.py');
  const importerStat = await fs.stat(importerPath);
  const stamp = `${sourceStat.mtimeMs}:${sourceStat.size}:${importerStat.mtimeMs}`;
  let cached = false;
  try { cached = JSON.parse(await fs.readFile(path.join(output, '.cache.json'), 'utf8')).stamp === stamp; } catch {}
  if (!cached) {
    await execFileAsync('python3', [importerPath, theme.source, output]);
    await fs.writeFile(path.join(output, '.cache.json'), JSON.stringify({ stamp }));
  }
  const metadata = JSON.parse(await fs.readFile(path.join(output, 'theme.json'), 'utf8'));
  return { ...theme, output, metadata };
}

function runtimeCssUrl(directory, revision = Date.now()) {
  return `${pathToFileURL(path.join(directory, 'theme.css')).href}?theme=${revision}`;
}

async function activateTheme(id, requestedScheme) {
  const prepared = await prepareTheme(id);
  const scheme = requestedScheme || prepared.metadata.defaultScheme;
  if (!prepared.metadata.schemes?.some(item => item.id === scheme)) throw new Error('Unknown colour scheme');
  const directory = path.join(prepared.output, 'schemes', scheme);
  await fs.access(path.join(directory, 'theme.css'));
  activeTheme = { id, scheme, revision: Date.now(), cssUrl: runtimeCssUrl(directory) };
  await fs.mkdir(path.dirname(themeStatePath), { recursive: true });
  await fs.writeFile(themeStatePath, JSON.stringify({ id, scheme }));
  notifyThemeChanged(activeTheme);
  return activeTheme;
}

async function listThemes() {
  const themes = await discoverThemes();
  return Promise.all(themes.map(async theme => {
    const prepared = await prepareTheme(theme.id);
    return { id: theme.id, name: prepared.metadata.theme || theme.id, schemes: prepared.metadata.schemes || [] };
  }));
}

app.setName('NekoChat');
app.commandLine.appendSwitch('class', 'nekochat');

function createWindow() {
  const win = new BrowserWindow({
    title: 'NekoChat',
    icon: path.join(__dirname, 'assets', 'images', 'nekochat_icon.png'),
    width: 807,
    height: 562,
    minWidth: 320,
    minHeight: 180,
    frame: false,
    transparent: true,
    resizable: true,
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(async () => {
  let saved = { id: 'Luna' };
  try { saved = JSON.parse(await fs.readFile(themeStatePath, 'utf8')); } catch {}
  try { await activateTheme(saved.id, saved.scheme); } catch { await activateTheme('Luna'); }
  ipcMain.on('window:minimize', e => BrowserWindow.fromWebContents(e.sender).minimize());
  ipcMain.on('window:maximize', e => {
    const win = BrowserWindow.fromWebContents(e.sender);
    win.isMaximized() ? win.unmaximize() : win.maximize();
  });
  ipcMain.on('window:close', e => BrowserWindow.fromWebContents(e.sender).close());
  ipcMain.on('theme:open-settings', e => openThemeSettings(BrowserWindow.fromWebContents(e.sender)));
  ipcMain.on('profile:open-settings', () => openProfileSettings());
  ipcMain.on('profile:changed', (_, user) => BrowserWindow.getAllWindows().forEach(win => win.webContents.send('profile:changed', user)));
  ipcMain.handle('theme:list', () => listThemes());
  ipcMain.handle('theme:current', () => activeTheme);
  ipcMain.handle('theme:preview', async (_, id, scheme) => {
    const prepared = await prepareTheme(id);
    const activeScheme = scheme || prepared.metadata.defaultScheme;
    const directory = path.join(prepared.output, 'schemes', activeScheme);
    return { id, scheme: activeScheme, revision: Date.now(), cssUrl: runtimeCssUrl(directory) };
  });
  ipcMain.handle('theme:apply', async (_, id, scheme) => {
    if (!/^[a-zA-Z0-9._ -]+$/.test(id) || (scheme && !/^[a-zA-Z0-9._-]+$/.test(scheme))) throw new Error('Invalid theme name');
    return activateTheme(id, scheme);
  });
  ipcMain.handle('theme:import', async event => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Windows XP themes', extensions: ['theme', 'msstyles'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const sourceFile = result.filePaths[0];
    const base = path.basename(sourceFile, path.extname(sourceFile)).replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 60) || 'Custom-theme';
    const destination = path.join(themesRoot, `${base}-${Date.now()}`);
    await fs.mkdir(destination, { recursive: true });
    await fs.copyFile(sourceFile, path.join(destination, path.basename(sourceFile)));
    const id = path.basename(destination);
    const activated = await activateTheme(id);
    return { themes: await listThemes(), ...activated };
  });
  ipcMain.on('window:set-meta', (e, { title, icon }) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (title && title.trim()) win.setTitle(title.trim());
    if (icon) {
      try {
        win.setIcon(icon.startsWith('file:') ? fileURLToPath(icon) : icon);
      } catch {
        // A web/data URL cannot be used as a Linux window-manager icon path.
      }
    }
  });
  ipcMain.on('window:resize', (e, { direction, dx, dy }) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const bounds = win.getBounds();
    const minimum = win.getMinimumSize();
    let { x, y, width, height } = bounds;
    if (direction.includes('e')) width += dx;
    if (direction.includes('s')) height += dy;
    if (direction.includes('w')) { width -= dx; x += dx; }
    if (direction.includes('n')) { height -= dy; y += dy; }
    if (width < minimum[0]) { if (direction.includes('w')) x -= minimum[0] - width; width = minimum[0]; }
    if (height < minimum[1]) { if (direction.includes('n')) y -= minimum[1] - height; height = minimum[1]; }
    win.setBounds({ x, y, width, height });
  });
  createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
