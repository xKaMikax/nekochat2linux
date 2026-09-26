const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, Notification, desktopCapturer, session } = require('electron');
const path = require('path');
const { fileURLToPath, pathToFileURL } = require('url');
const fs = require('fs/promises');
const { execFile } = require('child_process');
const { promisify } = require('util');
const zlib = require('zlib');

const execFileAsync = promisify(execFile);
function readZipEntries(buffer) {
  const minEOCD = 22;
  let eocdOffset = -1;
  for (let i = buffer.length - minEOCD; i >= 0 && i >= buffer.length - minEOCD - 0xffff; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocdOffset = i; break; }
  }
  if (eocdOffset === -1) throw new Error('Invalid ZIP file: end of central directory not found.');
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let offset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = [];
  for (let i = 0; i < entryCount; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid ZIP file: corrupt central directory.');
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    entries.push({ name, method, compressedSize, localHeaderOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
function readZipEntryData(buffer, entry) {
  if (buffer.readUInt32LE(entry.localHeaderOffset) !== 0x04034b50) throw new Error('Invalid ZIP file: corrupt local header.');
  const nameLength = buffer.readUInt16LE(entry.localHeaderOffset + 26);
  const extraLength = buffer.readUInt16LE(entry.localHeaderOffset + 28);
  const dataStart = entry.localHeaderOffset + 30 + nameLength + extraLength;
  const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) return compressed;
  if (entry.method === 8) return zlib.inflateRawSync(compressed);
  throw new Error(`Unsupported ZIP compression method: ${entry.method}.`);
}
async function extractZip(buffer, destinationRoot) {
  const entries = readZipEntries(buffer);
  if (entries.some(entry => entry.name.startsWith('/') || entry.name.split('/').includes('..'))) throw new Error('Theme.ZIP contains an unsafe path.');
  for (const entry of entries) {
    const target = path.join(destinationRoot, entry.name);
    if (entry.name.endsWith('/')) { await fs.mkdir(target, { recursive: true }); continue; }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, readZipEntryData(buffer, entry));
  }
}
const themesRoot = path.join(__dirname, 'themes');
const prebuiltRoot = path.join(__dirname, 'prebuilt');
const userThemesRoot = path.join(app.getPath('userData'), 'themes');
const runtimeThemesRoot = path.join(app.getPath('temp'), 'nekochat-msstyles');
const themeStatePath = path.join(app.getPath('userData'), 'theme-selection.json');
const displayStatePath = path.join(app.getPath('userData'), 'display-settings.json');
const themeCatalogRoot = 'https://raw.githubusercontent.com/xKaMikax/nekochat_reloaded_themes/main';
const builtInThemes = [
  { id: 'Classic', classic: true, source: path.join(themesRoot, 'classic', 'theme.css') },
  { id: 'Luna', source: path.join(themesRoot, 'luna', 'Luna.theme') },
];
let settingsWindow;
let themeBrowserWindow;
let emojiBrowserWindow;
let emojiBrowserOwner;
let systemDialogWindow;
let profileWindow;
let callWindow;
let mainWindow;
let tray;
let quitting = false;
let callOwner;
let closingCallWindow = false;
const detachedChatWindows = new Map();
const closingDetachedWindows = new Set();
let activeTheme;
let activeDisplay = { language: 'ru', loginUi: 'xp', micDeviceId: '' };
let displayCaptureSource;

function notifyThemeChanged(theme) {
  BrowserWindow.getAllWindows().forEach(win => win.webContents.send('theme:changed', theme));
}
function notifyDisplayChanged(settings) {
  BrowserWindow.getAllWindows().forEach(win => win.webContents.send('display:changed', settings));
}
async function saveDisplaySettings(settings) {
  activeDisplay = { language: settings.language === 'en' ? 'en' : 'ru', loginUi: settings.loginUi === 'classic' ? 'classic' : 'xp', micDeviceId: typeof settings.micDeviceId === 'string' ? settings.micDeviceId : '' };
  await fs.mkdir(path.dirname(displayStatePath), { recursive: true });
  await fs.writeFile(displayStatePath, JSON.stringify(activeDisplay));
  notifyDisplayChanged(activeDisplay);
  return activeDisplay;
}

function openThemeSettings(owner) {
  if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.focus(); return; }
  settingsWindow = new BrowserWindow({
    title: 'Display Properties', width: 520, height: 480, minWidth: 460, minHeight: 400, resizable: true,
    parent: owner, frame: false, transparent: false, backgroundColor: '#ece9d8',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  settingsWindow.on('closed', () => { settingsWindow = null; });
  settingsWindow.loadFile(path.join(__dirname, 'assets', 'html', 'theme_settings_frame.html'));
}

function openThemeBrowser(owner) {
  if (themeBrowserWindow && !themeBrowserWindow.isDestroyed()) { themeBrowserWindow.focus(); return; }
  themeBrowserWindow = new BrowserWindow({
    title: 'NekoChat Theme Browser', width: 720, height: 540, minWidth: 520, minHeight: 360,
    parent: owner, frame: false, transparent: false, backgroundColor: '#ece9d8',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  themeBrowserWindow.on('closed', () => { themeBrowserWindow = null; });
  themeBrowserWindow.loadFile(path.join(__dirname, 'assets', 'html', 'theme_browser.html'));
}

function openEmojiBrowser(owner) {
  emojiBrowserOwner = owner;
  if (emojiBrowserWindow && !emojiBrowserWindow.isDestroyed()) { emojiBrowserWindow.focus(); return; }
  emojiBrowserWindow = new BrowserWindow({
    title: 'NekoChat Emoji', width: 760, height: 620, minWidth: 520, minHeight: 420,
    parent: owner, modal: false, frame: false, transparent: false, backgroundColor: '#ece9d8',
    icon: path.join(__dirname, 'assets', 'images', 'nekochat_icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  emojiBrowserWindow.on('closed', () => { emojiBrowserWindow = null; emojiBrowserOwner = null; });
  emojiBrowserWindow.loadFile(path.join(__dirname, 'assets', 'html', 'emoji_browser.html'));
}

function showSystemDialog(owner, data = {}) {
  if (systemDialogWindow && !systemDialogWindow.isDestroyed()) { systemDialogWindow.webContents.send('system:update', data); systemDialogWindow.focus(); return; }
  systemDialogWindow = new BrowserWindow({
    title: data.title || 'NekoChat', width: 405, height: 205, minWidth: 360, minHeight: 185, resizable: false,
    parent: owner, modal: false, frame: false, transparent: false, backgroundColor: '#ece9d8',
    icon: path.join(__dirname, 'assets', 'images', 'nekochat_icon.png'), webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  systemDialogWindow.once('ready-to-show', () => { systemDialogWindow.webContents.send('system:update', data); systemDialogWindow.show(); });
  systemDialogWindow.on('closed', () => { systemDialogWindow = null; });
  systemDialogWindow.loadFile(path.join(__dirname, 'assets', 'html', 'system_dialog.html'));
}

function openProfileSettings() {
  if (profileWindow && !profileWindow.isDestroyed()) { profileWindow.focus(); return; }
  profileWindow = new BrowserWindow({
    title: 'User Accounts', width: 430, height: 390, minWidth: 360, minHeight: 310, resizable: true,
    frame: false, transparent: false, backgroundColor: '#ece9d8',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  profileWindow.on('closed', () => { profileWindow = null; });
  profileWindow.loadFile(path.join(__dirname, 'assets', 'html', 'profile_settings_frame.html'));
}

function sendCallState(state) {
  if (callWindow && !callWindow.isDestroyed()) callWindow.webContents.send('call:update', state);
}
function openCallWindow(owner, state) {
  callOwner = owner;
  if (callWindow && !callWindow.isDestroyed()) { sendCallState(state); return; }
  callWindow = new BrowserWindow({
    title: 'NekoChat Call', width: 520, height: 430, minWidth: 380, minHeight: 300,
    resizable: true, parent: owner, modal: false, frame: false, transparent: false, backgroundColor: '#ece9d8',
    icon: path.join(__dirname, 'assets', 'images', 'nekochat_icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  callWindow.once('ready-to-show', () => { sendCallState(state); callWindow.show(); });
  callWindow.on('closed', () => {
    const shouldNotify = !closingCallWindow;
    callWindow = null; closingCallWindow = false;
    if (shouldNotify && callOwner && !callOwner.isDestroyed()) callOwner.webContents.send('call:action', { action: 'dismiss' });
    callOwner = null;
  });
  callWindow.loadFile(path.join(__dirname, 'assets', 'html', 'call.html'));
}
function closeCallWindow() {
  if (!callWindow || callWindow.isDestroyed()) return;
  closingCallWindow = true;
  callWindow.close();
}

function openDetachedChat(owner, chat) {
  const kind = chat?.kind === 'room' ? 'room' : chat?.kind === 'dm' ? 'dm' : null;
  const id = Number(chat?.id);
  if (!kind || !Number.isInteger(id) || id < 1) return false;
  const key = `${kind}:${id}`;
  const existing = detachedChatWindows.get(key);
  if (existing && !existing.isDestroyed()) { existing.focus(); return true; }
  const win = new BrowserWindow({
    title: 'NekoChat', icon: path.join(__dirname, 'assets', 'images', 'nekochat_icon.png'),
    width: 620, height: 480, minWidth: 400, minHeight: 260,
    frame: false, transparent: false, resizable: true, show: false, backgroundColor: '#ece9d8',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  detachedChatWindows.set(key, win);
  win.on('close', event => {
    if (closingDetachedWindows.has(win.id) || !mainWindow || mainWindow.isDestroyed()) return;
    event.preventDefault();
    returnDetachedChat(win, { kind, id });
  });
  win.on('closed', () => { closingDetachedWindows.delete(win.id); detachedChatWindows.delete(key); });
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'assets', 'html', 'index.html'), { query: { detached: '1', kind, id: String(id) } });
  return true;
}

function returnDetachedChat(sender, chat) {
  const kind = chat?.kind === 'room' ? 'room' : chat?.kind === 'dm' ? 'dm' : null;
  const id = Number(chat?.id);
  if (!kind || !Number.isInteger(id) || id < 1 || !mainWindow || mainWindow.isDestroyed()) return;
  const key = `${kind}:${id}`;
  if (detachedChatWindows.get(key) !== sender) return;
  const point = chat?.point;
  if (point && !(point.x >= mainWindow.getBounds().x && point.y >= mainWindow.getBounds().y && point.x <= mainWindow.getBounds().x + mainWindow.getBounds().width && point.y <= mainWindow.getBounds().y + mainWindow.getBounds().height)) return;
  mainWindow.show(); mainWindow.focus();
  mainWindow.webContents.send('chat:restore', { kind, id });
  closingDetachedWindows.add(sender.id);
  sender.close();
}

function closeDetachedChats() {
  for (const win of detachedChatWindows.values()) {
    if (!win.isDestroyed()) { closingDetachedWindows.add(win.id); win.close(); }
  }
}

function focusDetachedChat(chat) {
  const kind = chat?.kind === 'room' ? 'room' : chat?.kind === 'dm' ? 'dm' : null;
  const id = Number(chat?.id);
  if (!kind || !Number.isInteger(id) || id < 1) return false;
  const win = detachedChatWindows.get(`${kind}:${id}`);
  if (!win || win.isDestroyed()) return false;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
  return true;
}

const reservedThemeIds = ['Current', 'Luna', 'Embedded', 'Royale'];

async function scanThemes(root, userInstalled = false) {
  const found = [];
  let entries;
  try { entries = await fs.readdir(root, { withFileTypes: true }); } catch { return found; }
  for (const entry of entries) {
    if (!entry.isDirectory() || reservedThemeIds.includes(entry.name)) continue;
    const directory = path.join(root, entry.name);
    const files = await fs.readdir(directory, { withFileTypes: true });
    const source = files.find(file => file.isFile() && file.name.toLowerCase().endsWith('.theme')) || files.find(file => file.isFile() && file.name.toLowerCase().endsWith('.msstyles')) || files.find(file => file.isFile() && file.name.toLowerCase() === 'theme.css');
    if (source) {
      let catalogId;
      try { catalogId = JSON.parse(await fs.readFile(path.join(directory, 'catalog-theme.json'), 'utf8')).id; } catch {}
      found.push({ id: entry.name, source: path.join(directory, source.name), css: source.name.toLowerCase() === 'theme.css', userInstalled, catalogId });
    }
  }
  return found;
}

async function discoverThemes() {
  const found = new Map(builtInThemes.map(theme => [theme.id, theme]));
  for (const theme of await scanThemes(themesRoot)) found.set(theme.id, theme);
  for (const theme of await scanThemes(userThemesRoot, true)) found.set(theme.id, theme);
  return [...found.values()];
}

async function copyDirectory(source, destination) {
  // fs.cp()'s recursive walk relies on fs.opendir, which Electron's asar
  // interception does not patch — it throws ENOENT when the source lives
  // inside app.asar. readdir/mkdir/copyFile are patched, so use those instead.
  await fs.mkdir(destination, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) await copyDirectory(from, to);
    else await fs.copyFile(from, to);
  }
}
async function copyThemeBundle(sourceFile, destination) {
  const sourceRoot = path.dirname(sourceFile);
  const copyRelevantFiles = async directory => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const from = path.join(directory, entry.name);
      if (entry.isDirectory()) { await copyRelevantFiles(from); continue; }
      // Aero themes keep extra visual-style resources next to the .theme.
      // Keep them together so imported Windows 7 themes remain portable.
      if (!/\.(theme|msstyles|dll|mui)$/i.test(entry.name)) continue;
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
    await copyDirectory(source, output);
    const rewriteCss = async directory => {
      const cssPath = path.join(directory, 'theme.css');
      let css = await fs.readFile(cssPath, 'utf8');
      css = css.replace(/url\("[^"]+"\)/g, match => {
        const asset = path.basename(match.slice(5, -2));
        return `url("${pathToFileURL(path.join(directory, asset)).href}")`;
      });
      await fs.writeFile(cssPath, css);
    };
    // Classic has only a colour-scheme stylesheet; imported msstyles themes
    // may also provide a root stylesheet.  Rewrite the latter when present.
    try { await fs.access(path.join(output, 'theme.css')); await rewriteCss(output); } catch {}
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
  if (theme.css) return { ...theme, output: path.dirname(theme.source), css: true, metadata: { theme: id, schemes: [{ id: 'default', name: 'Default' }], defaultScheme: 'default' } };
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
  const directory = prepared.css ? prepared.output : path.join(prepared.output, 'schemes', scheme);
  await fs.access(path.join(directory, 'theme.css'));
  activeTheme = { id, scheme, revision: Date.now(), cssUrl: runtimeCssUrl(directory) };
  await fs.mkdir(path.dirname(themeStatePath), { recursive: true });
  await fs.writeFile(themeStatePath, JSON.stringify({ id, scheme }));
  notifyThemeChanged(activeTheme);
  return activeTheme;
}

function catalogEntries(manifest) {
  const entries = Array.isArray(manifest) ? manifest : Array.isArray(manifest?.themes) ? manifest.themes : Object.entries(manifest || {}).map(([theme_id, value]) => ({ theme_id, ...(value || {}) }));
  return entries.map((entry, index) => {
    const theme_id = String(entry.theme_id || entry.id || `theme-${index + 1}`);
    const directory = String(entry.directory || theme_id).replace(/^\/+|\/+$/g, '');
    const details = entry.Details || entry.details || {};
    return {
      id: theme_id, directory, displayName: entry.DisplayName || entry.displayName || theme_id,
      colorSchemes: entry.ColorSchemes || entry.ColorShemas || entry.colorSchemes || [],
      type: details.Type || details.type || entry.Type || entry.type || 'WindowsThemeFile',
      author: details.Author || details.author || entry.Author || entry.author || 'Unknown',
      version: details.Version || details.version || entry.Version || entry.version || 'Unknown',
      previewUrl: entry.Preview || entry.preview || `${themeCatalogRoot}/${directory}/Preview.png`,
      descriptionUrl: entry.Description || entry.description || `${themeCatalogRoot}/${directory}/Description.md`,
      detailsUrl: entry.DetailsFile || entry.detailsFile || `${themeCatalogRoot}/${directory}/Details.json`,
      zipUrl: entry.ThemeZIP || entry.themeZip || `${themeCatalogRoot}/${directory}/Theme.ZIP`
    };
  });
}
async function fetchCatalog() {
  const response = await fetch(`${themeCatalogRoot}/themes.json`);
  if (!response.ok) throw new Error(response.status === 404 ? 'Theme catalog has not been published yet.' : `Unable to load theme catalog (${response.status}).`);
  return catalogEntries(await response.json());
}
async function fetchCatalogThemeDetails(id) {
  const item = (await fetchCatalog()).find(theme => theme.id === id);
  if (!item) throw new Error('Theme no longer exists in the catalog.');
  let description = '';
  try {
    const response = await fetch(item.descriptionUrl);
    if (response.ok) description = await response.text();
  } catch {}
  return { ...item, description };
}
async function findThemeSource(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) { const found = await findThemeSource(target); if (found) return found; }
    if (entry.isFile() && (/\.(theme|msstyles)$/i.test(entry.name) || entry.name.toLowerCase() === 'theme.css')) return target;
  }
  return null;
}
async function installCatalogTheme(id) {
  const item = (await fetchCatalog()).find(theme => theme.id === id);
  if (!item) throw new Error('Theme no longer exists in the catalog.');
  const response = await fetch(item.zipUrl);
  if (!response.ok) throw new Error(`Unable to download Theme.ZIP (${response.status}).`);
  const zipBuffer = Buffer.from(await response.arrayBuffer());
  const temporary = await fs.mkdtemp(path.join(app.getPath('temp'), 'nekochat-theme-'));
  const destination = path.join(userThemesRoot, `${item.id.replace(/[^a-zA-Z0-9._-]/g, '_')}-${Date.now()}`);
  try {
    await extractZip(zipBuffer, temporary);
    const source = await findThemeSource(temporary);
    if (!source) throw new Error('Theme.ZIP must contain a .theme, .msstyles, or theme.css file.');
    await fs.mkdir(destination, { recursive: true });
    if (path.basename(source).toLowerCase() === 'theme.css') await copyDirectory(path.dirname(source), destination);
    else await copyThemeBundle(source, destination);
    await fs.writeFile(path.join(destination, 'catalog-theme.json'), JSON.stringify({ id: item.id }));
    return { id: path.basename(destination), themes: await listThemes() };
  } catch (error) {
    await fs.rm(destination, { recursive: true, force: true }).catch(() => {});
    throw error;
  } finally { await fs.rm(temporary, { recursive: true, force: true }).catch(() => {}); }
}

async function listThemes() {
  const themes = await discoverThemes();
  const results = await Promise.all(themes.map(async theme => {
    try {
      const prepared = await prepareTheme(theme.id);
      const rawName = prepared.metadata.theme || theme.id;
      const name = String(rawName).replace(/\.(theme|msstyles)$/i, '');
      return { id: theme.id, name, schemes: prepared.metadata.schemes || [], removable: Boolean(theme.userInstalled), catalogId: theme.catalogId || null };
    } catch (error) {
      console.warn(`Ignoring incomplete theme ${theme.id}: ${error.message}`);
      return null;
    }
  }));
  return results.filter(Boolean);
}

async function removeTheme(id) {
  const theme = (await discoverThemes()).find(item => item.id === id);
  if (!theme?.userInstalled) throw new Error('Built-in themes cannot be removed.');
  if (activeTheme?.id === id) await activateTheme('Classic', 'classic');
  const directory = path.resolve(userThemesRoot, id);
  if (!directory.startsWith(`${path.resolve(userThemesRoot)}${path.sep}`)) throw new Error('Invalid theme location.');
  await fs.rm(directory, { recursive: true, force: true });
  return { themes: await listThemes(), activeTheme };
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
    transparent: false,
    resizable: true,
    backgroundColor: '#ece9d8',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  mainWindow = win;
  win.on('close', event => {
    if (quitting) return;
    event.preventDefault();
    win.hide();
  });
  win.on('closed', () => { mainWindow = null; });
  win.loadFile(path.join(__dirname, 'assets', 'html', 'index.html'));
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) { createWindow(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show(); mainWindow.focus();
}
function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'images', 'nekochat_icon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('NekoChat Reloaded');
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Open NekoChat', click: showMainWindow }, { type: 'separator' }, { label: 'Quit', click: () => app.quit() }]));
  tray.on('click', showMainWindow);
}
async function notificationIcon(avatarUrl) {
  if (!avatarUrl) return path.join(__dirname, 'assets', 'images', 'nekochat_icon.png');
  try {
    const response = await fetch(avatarUrl);
    if (!response.ok) throw new Error('Avatar unavailable');
    const image = nativeImage.createFromBuffer(Buffer.from(await response.arrayBuffer()));
    return image.isEmpty() ? path.join(__dirname, 'assets', 'images', 'nekochat_icon.png') : image;
  } catch { return path.join(__dirname, 'assets', 'images', 'nekochat_icon.png'); }
}
async function showMessageNotification({ sender, content, avatarUrl } = {}) {
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title: 'NekoChat', body: `${sender || 'User'}\n${content || ''}`, icon: await notificationIcon(avatarUrl) });
  notification.on('click', showMainWindow);
  notification.show();
}

app.whenReady().then(async () => {
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    // This handler is reached only after display:prepare-capture has successfully
    // enumerated a portal source for the explicit user request.
    if (displayCaptureSource) callback({ video: displayCaptureSource });
  });
  let saved = { id: 'Classic' };
  try { saved = JSON.parse(await fs.readFile(themeStatePath, 'utf8')); } catch {}
  if (String(saved.id).toLowerCase() === 'aero') saved = { id: 'Classic', scheme: 'classic' };
  try { activeDisplay = { ...activeDisplay, ...JSON.parse(await fs.readFile(displayStatePath, 'utf8')) }; } catch {}
  try { await activateTheme(saved.id, saved.scheme); }
  catch { try { await activateTheme('Classic', 'classic'); } catch (error) { console.error('Theme activation failed (built-in assets missing?):', error); } }
  ipcMain.on('window:minimize', e => BrowserWindow.fromWebContents(e.sender).minimize());
  ipcMain.on('window:maximize', e => {
    const win = BrowserWindow.fromWebContents(e.sender);
    win.isMaximized() ? win.unmaximize() : win.maximize();
  });
  ipcMain.on('window:close', e => BrowserWindow.fromWebContents(e.sender).close());
  ipcMain.on('notification:message', (_, data) => { showMessageNotification(data); });
  ipcMain.on('theme:open-settings', e => openThemeSettings(BrowserWindow.fromWebContents(e.sender)));
  ipcMain.on('theme:open-browser', e => openThemeBrowser(BrowserWindow.fromWebContents(e.sender)));
  ipcMain.on('emoji:open-browser', e => openEmojiBrowser(BrowserWindow.fromWebContents(e.sender)));
  ipcMain.on('system:show', (e, data) => showSystemDialog(BrowserWindow.fromWebContents(e.sender), data || {}));
  ipcMain.on('emoji:selected', (event, emoji) => {
    if (BrowserWindow.fromWebContents(event.sender) !== emojiBrowserWindow || typeof emoji !== 'string' || emoji.length > 32) return;
    if (emojiBrowserOwner && !emojiBrowserOwner.isDestroyed()) emojiBrowserOwner.webContents.send('emoji:selected', emoji);
    emojiBrowserWindow?.close();
  });
  ipcMain.on('profile:open-settings', () => openProfileSettings());
  ipcMain.on('call:open', (e, state) => openCallWindow(BrowserWindow.fromWebContents(e.sender), state || {}));
  ipcMain.on('call:update', (_, state) => sendCallState(state || {}));
  ipcMain.on('call:close', () => closeCallWindow());
  ipcMain.on('call:action', (_, action) => { if (callOwner && !callOwner.isDestroyed()) callOwner.webContents.send('call:action', action || {}); });
  ipcMain.handle('chat:detach', (event, chat) => openDetachedChat(BrowserWindow.fromWebContents(event.sender), chat));
  ipcMain.on('chat:return', (event, chat) => returnDetachedChat(BrowserWindow.fromWebContents(event.sender), chat));
  ipcMain.on('chat:close-all', () => closeDetachedChats());
  ipcMain.handle('chat:focus-detached', (_, chat) => focusDetachedChat(chat));
  ipcMain.on('profile:changed', (_, user) => BrowserWindow.getAllWindows().forEach(win => win.webContents.send('profile:changed', user)));
  ipcMain.handle('theme:list', () => listThemes());
  ipcMain.handle('theme:browser-list', () => fetchCatalog());
  ipcMain.handle('theme:browser-details', (_, id) => fetchCatalogThemeDetails(String(id || '')));
  ipcMain.handle('theme:browser-install', (_, id) => installCatalogTheme(String(id || '')));
  ipcMain.handle('theme:remove', (_, id) => removeTheme(String(id || '')));
  ipcMain.handle('theme:current', () => activeTheme);
  ipcMain.handle('display:current', () => activeDisplay);
  ipcMain.handle('display:prepare-capture', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } });
    if (!sources[0]) throw new Error('В системе не найден доступный экран или окно для демонстрации.');
    displayCaptureSource = sources[0]; return true;
  });
  ipcMain.handle('display:apply', (_, settings) => saveDisplaySettings(settings || {}));
  ipcMain.handle('theme:preview', async (_, id, scheme) => {
    const prepared = await prepareTheme(id);
    const activeScheme = scheme || prepared.metadata.defaultScheme;
    const directory = prepared.css ? prepared.output : path.join(prepared.output, 'schemes', activeScheme);
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
  createTray();
  createWindow();
});
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { if (!tray && process.platform !== 'darwin') app.quit(); });
