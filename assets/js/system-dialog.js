const controls = window.windowControls; const $ = selector => document.querySelector(selector);
function applyTheme(theme) { if (theme?.cssUrl) $('#frame-theme').href = theme.cssUrl; }
function render(data = {}) { const type = ['error','warning','info'].includes(data.type) ? data.type : 'error'; document.title = data.title || 'NekoChat'; $('.xp-title').textContent = document.title; $('#message').textContent = data.message || 'Неизвестная ошибка.'; $('#icon').className = type; }
$('#close').onclick = () => controls.close(); $('#ok').onclick = () => controls.close(); controls.onSystemDialog(render); controls.onThemeChanged(applyTheme); controls.getActiveTheme().then(applyTheme);
