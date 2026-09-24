document.querySelector('#minimize').onclick = () => window.windowControls.minimize();
document.querySelector('#maximize').onclick = () => window.windowControls.maximize();
document.querySelector('#close').onclick = () => window.windowControls.close();

const appHost = document.querySelector('#app-host');
const titleElement = document.querySelector('.xp-title');
const iconElement = document.querySelector('.xp-app-icon');
let currentDisplaySettings;

const setWindowMeta = ({ title, icon }) => {
  if (title && title.trim()) {
    document.title = title.trim();
    titleElement.textContent = title.trim();
  }
  if (icon) {
    iconElement.style.backgroundImage = `url("${icon}")`;
    iconElement.classList.add('has-icon');
  }
  window.windowControls.setWindowMeta(title, icon);
};

appHost.addEventListener('load', () => {
  const appDocument = appHost.contentDocument;
  if (!appDocument) return;
  const icon = appDocument.querySelector('link[rel~="icon"]')?.href;
  setWindowMeta({ title: appDocument.title, icon });
  const titleNode = appDocument.querySelector('title') || appDocument.head;
  if (titleNode) {
    new MutationObserver(() => setWindowMeta({ title: appDocument.title })).observe(
      titleNode,
      { childList: true, subtree: true, characterData: true },
    );
  }
  if (currentDisplaySettings) appHost.contentWindow?.postMessage({ type: 'xp-display-settings', settings: currentDisplaySettings }, '*');
});

window.addEventListener('message', event => {
  if (event.source === appHost.contentWindow && event.data?.type === 'xp-window-meta') {
    setWindowMeta(event.data);
  }
  if (event.source === appHost.contentWindow && event.data?.type === 'xp-window-theme') {
    document.querySelector('#frame-style').href = `assets/css/style.css?theme=${event.data.revision || Date.now()}`;
  }
});

function applyFrameTheme(theme) {
  if (!theme?.cssUrl) return;
  document.querySelector('#frame-theme').href = theme.cssUrl;
  appHost.contentWindow?.postMessage({ type: 'xp-theme-refresh', ...theme }, '*');
}
function applyDisplaySettings(settings) {
  currentDisplaySettings = settings;
  appHost.contentWindow?.postMessage({ type: 'xp-display-settings', settings }, '*');
}

window.windowControls.onThemeChanged(applyFrameTheme);
window.windowControls.onDisplayChanged(applyDisplaySettings);
window.windowControls.getActiveTheme().then(applyFrameTheme);
window.windowControls.getDisplaySettings().then(applyDisplaySettings);

// Load the user's document as a real local page. Its own CSS, JS, images and
// relative paths keep working, so this file may be replaced with any full HTML app.
appHost.src = 'main_windows.html';

document.querySelectorAll('.resize-handle').forEach(handle => {
  handle.addEventListener('pointerdown', event => {
    const direction = handle.dataset.direction;
    let lastX = event.screenX;
    let lastY = event.screenY;
    handle.setPointerCapture(event.pointerId);

    const resize = move => {
      window.windowControls.resize(direction, move.screenX - lastX, move.screenY - lastY);
      lastX = move.screenX;
      lastY = move.screenY;
    };
    const stop = () => {
      window.removeEventListener('pointermove', resize);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    window.addEventListener('pointermove', resize);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  });
});
