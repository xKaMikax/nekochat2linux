const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { fileURLToPath, pathToFileURL } = require('url');
const fs = require('fs/promises');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const themesRoot = path.join(__dirname, 'themes');
const prebuiltRoot = path.join(__dirname, 'prebuilt');
const userThemesRoot = path.join(app.getPath('userData'), 'themes');
const runtimeThemesRoot = path.join(app.getPath('temp'), 'nekochat-msstyles');
const themeStatePath = path.join(app.getPath('userData'), 'theme-selection.json');
const displayStatePath = path.join(app.getPath('userData'), 'display-settings.json');
const builtInThemes = [
  { id: 'Classic', classic: true, source: path.join(themesRoot, 'classic', 'theme.css') },
  { id: 'Luna', source: path.join(themesRoot, 'luna', 'Luna.theme') },
  { id: 'Embedded', source: path.join(themesRoot, 'embedded', 'Embedded.msstyles') },
  { id: 'Royale', source: path.join(themesRoot, 'royal', 'Royale.msstyles') },
];
let settingsWindow;
let profileWindow;
let activeTheme;
let activeDisplay = { language: 'ru', loginUi: 'xp' };

function notifyThemeChanged(theme) {
  BrowserWindow.getAllWindows().forEach(win => win.webContents.send('theme:changed', theme));
}
function notifyDisplayChanged(settings) {
  BrowserWindow.getAllWindows().forEach(win => win.webContents.send('display:changed', settings));
}
async function saveDisplaySettings(settings) {
  activeDisplay = { language: settings.language === 'en' ? 'en' : 'ru', loginUi: settings.loginUi === 'classic' ? 'classic' : 'xp' };
  await fs.mkdir(path.dirname(displayStatePath), { recursive: true });
  await fs.writeFile(displayStatePath, JSON.stringify(activeDisplay));
  notifyDisplayChanged(activeDisplay);
  return activeDisplay;
}

function openThemeSettings(owner) {
  if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.focus(); return; }
  settingsWindow = new BrowserWindow({
    title: 'Display Properties', width: 520, height: 480, minWidth: 460, minHeight: 400, resizable: true,
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

const reservedThemeIds = ['Current', 'Luna', 'Embedded', 'Royale'];

async function scanThemes(root) {
  const found = [];
  let entries;
  try { entries = await fs.readdir(root, { withFileTypes: true }); } catch { return found; }
  for (const entry of entries) {
    if (!entry.isDirectory() || reservedThemeIds.includes(entry.name)) continue;
    const directory = path.join(root, entry.name);
    const files = await fs.readdir(directory, { withFileTypes: true });
    const source = files.find(file => file.isFile() && file.name.toLowerCase().endsWith('.theme')) || files.find(file => file.isFile() && file.name.toLowerCase().endsWith('.msstyles'));
    if (source) found.push({ id: entry.name, source: path.join(directory, source.name) });
  }
  return found;
}

async function discoverThemes() {
  const found = new Map(builtInThemes.map(theme => [theme.id, theme]));
  for (const root of [themesRoot, userThemesRoot]) {
    for (const theme of await scanThemes(root)) found.set(theme.id, theme);
  }
  return [...found.values()];
}

async function copyThemeBundle(sourceFile, destination) {
  if (path.extname(sourceFile).toLowerCase() !== '.theme') {
    await fs.copyFile(sourceFile, path.join(destination, path.basename(sourceFile)));
    return path.join(destination, path.basename(sourceFile));
  }
  const sourceRoot = path.dirname(sourceFile);
  const copyRelevantFiles = async directory => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const from = path.join(directory, entry.name);
      if (entry.isDirectory()) { await copyRelevantFiles(from); continue; }
      if (!/\.(theme|msstyles)$/i.test(entry.name)) continue;
      const relative = path.relative(sourceRoot, from);
      const target = path.join(destination, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(from, target);
    }
  };
  await copyRelevantFiles(sourceRoot);
  return path.join(destination, path.basename(sourceFile));
}

const produceThemeAssets = async (id, destination) => {
  const source = (await discoverThemes()).find(item => item.id === id);
  if (!source) throw new Error('Theme not found');

  if (source.classic) {
    const directory = path.join(destination, 'schemes', 'classic');
    await fs.mkdir(directory, { recursive: true });
    await fs.copyFile(source.source, path.join(directory, 'theme.css'));
    return { theme: 'Windows Classic', schemes: [{ id: 'classic', name: 'Windows Classic' }], defaultScheme: 'classic' };
  }

  const runImporter = async python => {
    await execFileAsync(python, [path.join(__dirname, 'tools', 'import_msstyles.py'), source.source, destination]);
    return JSON.parse(await fs.readFile(path.join(destination, 'theme.json'), 'utf8'));
  };

  const candidates = process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python'];
  let cause;
  for (const python of candidates) {
    try {
      return await runImporter(python);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      cause = error;
    }
  }
  throw Object.assign(new Error('Importing themes requires Python 3 with the "pefile" and "Pillow" packages installed.'), { code: 'ENOENT', cause });
};

async function prebuiltFor(id) {
  const directory = path.join(prebuiltRoot, id);
  try {
    await fs.readFile(path.join(directory, 'theme.json'), 'utf8');
    const metadata = JSON.parse(await fs.readFile(path.join(directory, 'theme.json'), 'utf8'));
    return { output: directory, metadata };
  } catch {
    return null;
  }
}

async function materializePrebuiltTheme(id, source, metadata) {
  const output = path.join(runtimeThemesRoot, id);
  const sourceStat = await fs.stat(path.join(source, 'theme.json'));
  const stamp = `${sourceStat.mtimeMs}:${sourceStat.size}`;
  let cached = false;
  try { cached = JSON.parse(await fs.readFile(path.join(output, '.prebuilt-cache.json'), 'utf8')).stamp === stamp; } catch {}
  if (!cached) {
    // CSS custom properties resolve url(...) in the stylesheet that consumes
    // them, not where the variable was declared.  Keep the rendered assets in
    // tmp and make every asset URL absolute before the app loads the theme.
    await fs.rm(output, { recursive: true, force: true });
    await fs.cp(source, output, { recursive: true });
    const rewriteCss = async directory => {
      const cssPath = path.join(directory, 'theme.css');
      let css = await fs.readFile(cssPath, 'utf8');
      css = css.replace(/url\("[^"]+"\)/g, match => {
        const asset = path.basename(match.slice(5, -2));
        return `url("${pathToFileURL(path.join(directory, asset)).href}")`;
      });
      await fs.writeFile(cssPath, css);
    };
    await rewriteCss(output);
    for (const scheme of metadata.schemes || []) await rewriteCss(path.join(output, 'schemes', scheme.id));
    await fs.writeFile(path.join(output, '.prebuilt-cache.json'), JSON.stringify({ stamp }));
  }
  return output;
}

async function prepareTheme(id) {
  const theme = (await discoverThemes()).find(item => item.id === id);
  if (!theme) throw new Error('Theme not found');
  const prebuilt = await prebuiltFor(id);
  if (prebuilt) return { ...theme, output: await materializePrebuiltTheme(id, prebuilt.output, prebuilt.metadata), metadata: prebuilt.metadata };
  const output = path.join(runtimeThemesRoot, id);
  await fs.mkdir(runtimeThemesRoot, { recursive: true });
  if (theme.classic) {
    await produceThemeAssets(id, output);
    return { ...theme, output, metadata: JSON.parse(await fs.readFile(path.join(output, 'theme.json'), 'utf8')) };
  }
  const sourceStat = await fs.stat(theme.source);
  const importerPath = path.join(__dirname, 'tools', 'import_msstyles.py');
  const importerStat = await fs.stat(importerPath);
  const stamp = `${sourceStat.mtimeMs}:${sourceStat.size}:${importerStat.mtimeMs}`;
  let cached = false;
  try { cached = JSON.parse(await fs.readFile(path.join(output, '.cache.json'), 'utf8')).stamp === stamp; } catch {}
  if (!cached) {
    await produceThemeAssets(id, output);
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
  const results = await Promise.all(themes.map(async theme => {
    try {
      const prepared = await prepareTheme(theme.id);
      const rawName = prepared.metadata.theme || theme.id;
      const name = String(rawName).replace(/\.(theme|msstyles)$/i, '');
      return { id: theme.id, name, schemes: prepared.metadata.schemes || [] };
    } catch (error) {
      console.warn(`Ignoring incomplete theme ${theme.id}: ${error.message}`);
      return null;
    }
  }));
  return results.filter(Boolean);
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
  try { activeDisplay = { ...activeDisplay, ...JSON.parse(await fs.readFile(displayStatePath, 'utf8')) }; } catch {}
  try { await activateTheme(saved.id, saved.scheme); }
  catch { try { await activateTheme('Luna'); } catch (error) { console.error('Theme activation failed (built-in assets missing?):', error); } }
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
  ipcMain.handle('display:current', () => activeDisplay);
  ipcMain.handle('display:apply', (_, settings) => saveDisplaySettings(settings || {}));
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
    const destination = path.join(userThemesRoot, `${base}-${Date.now()}`);
    await fs.mkdir(destination, { recursive: true });
    try {
      await copyThemeBundle(sourceFile, destination);
      const id = path.basename(destination);
      const prepared = await prepareTheme(id);
      const scheme = prepared.metadata.defaultScheme;
      return { themes: await listThemes(), id, scheme, revision: Date.now(), cssUrl: runtimeCssUrl(path.join(prepared.output, 'schemes', scheme)) };
    } catch (error) {
      await fs.rm(destination, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
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
