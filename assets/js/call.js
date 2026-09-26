const $ = selector => document.querySelector(selector);
const controls = window.windowControls;
const words = {
  ru: { window: 'NekoChat Reloaded — звонок', call: 'Звонок', connecting: 'Подключение…', you: 'Вы', user: 'Пользователь', connection: 'Подключение', screen: 'Демонстрация экрана', yourScreen: 'Ваш экран', remoteScreen: 'Экран собеседника', accept: 'Принять', decline: 'Отклонить', share: 'Демонстрация', stopShare: 'Остановить демо', mute: 'Заглушить', unmute: 'Включить звук', hangup: 'Завершить', close: 'Закрыть', connectionMenu: 'Соединение', transportWs: 'WebSocket', transportSse: 'SSE / HTTP2' },
  en: { window: 'NekoChat Reloaded — Call', call: 'Call', connecting: 'Connecting…', you: 'You', user: 'User', connection: 'Connecting', screen: 'Screen sharing', yourScreen: 'Your screen', remoteScreen: "Caller’s screen", accept: 'Accept', decline: 'Decline', share: 'Share screen', stopShare: 'Stop sharing', mute: 'Mute', unmute: 'Unmute', hangup: 'End call', close: 'Close', connectionMenu: 'Connection', transportWs: 'WebSocket', transportSse: 'SSE / HTTP2' }
};
let language = 'ru'; let currentState = {};
const t = key => words[language][key];
function applyText() { document.documentElement.lang = language; document.title = t('window'); $('.xp-title').textContent = t('window'); $('#close').setAttribute('aria-label', t('close')); $('#call-connection').setAttribute('aria-label', t('connection')); $('.screen-empty').textContent = t('screen'); $('#accept').textContent = t('accept'); $('#decline').textContent = t('decline'); $('#hangup').textContent = t('hangup'); $('#transport-menu-button').textContent = t('connectionMenu'); render(currentState); }
function render(state = {}) {
  currentState = state; $('#call-title').textContent = state.title || t('call'); $('#call-status').textContent = state.status || t('connecting');
  const selfAvatar = state.self?.avatar || state.selfAvatar || '☺'; const remoteAvatar = state.remote?.avatar || state.avatar || '☎';
  ['#self-avatar', '#screen-self-avatar'].forEach(selector => { const node = $(selector); node.innerHTML = selfAvatar; node.style.borderColor = state.self?.speaking ? '#62b77c' : state.self?.frame || '#5f93d2'; }); ['#remote-avatar', '#screen-remote-avatar'].forEach(selector => { const node = $(selector); node.innerHTML = remoteAvatar; node.style.borderColor = state.remote?.speaking ? '#62b77c' : state.remote?.frame || '#5f93d2'; });
  ['#self-name', '#screen-self-name'].forEach(selector => { $(selector).textContent = state.self?.name || state.selfName || t('you'); }); ['#remote-name', '#screen-remote-name'].forEach(selector => { $(selector).textContent = state.remote?.name || state.personName || state.title?.replace(/^.*?:\s*/, '') || t('user'); });
  $('#accept').hidden = !state.incoming; $('#decline').hidden = !state.incoming; $('#hangup').hidden = Boolean(state.incoming); $('#mute').hidden = Boolean(state.incoming); $('#share').hidden = Boolean(state.incoming) || !state.direct;
  $('#mute').textContent = state.muted ? t('unmute') : t('mute'); $('#share').textContent = state.sharing === 'self' ? t('stopShare') : t('share'); $('#call-connection').hidden = Boolean(state.connected);
  const screen = state.sharing === 'self' || state.sharing === 'remote'; $('#call-stage').classList.toggle('sharing', screen); $('#screen-stage').hidden = !screen; $('#screen-preview').hidden = !state.screenPreview; $('#screen-preview').src = state.screenPreview || ''; $('#screen-preview').alt = state.sharing === 'self' ? t('yourScreen') : t('remoteScreen');
  const transport = state.transport === 'sse' ? 'sse' : 'ws'; document.querySelectorAll('[data-transport]').forEach(item => item.setAttribute('aria-checked', String(item.dataset.transport === transport))); $('#call-transport').textContent = transport === 'sse' ? t('transportSse') : t('transportWs');
  const note = $('#call-note'); if (note) note.hidden = state.audioAvailable !== false;
}
function action(name) { controls.callAction({ action: name }); }
$('#accept').onclick = () => action('accept'); $('#decline').onclick = () => action('decline'); $('#mute').onclick = () => action('mute'); $('#share').onclick = () => action('share'); $('#hangup').onclick = () => action('hangup'); $('#close').onclick = () => { action('dismiss'); controls.close(); };
function setTransportMenu(open) { $('#transport-menu').hidden = !open; $('#transport-menu-button').setAttribute('aria-expanded', String(open)); if (open) $('#transport-menu [aria-checked="true"]')?.focus(); }
$('#transport-menu-button').onclick = () => setTransportMenu($('#transport-menu').hidden);
$('#transport-menu').onclick = event => { const item = event.target.closest('[data-transport]'); if (!item) return; setTransportMenu(false); controls.callAction({ action: 'transport', transport: item.dataset.transport }); };
document.addEventListener('click', event => { if (!event.target.closest('.call-menu')) setTransportMenu(false); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') setTransportMenu(false); });
controls.onCallUpdate(render); controls.onDisplayChanged(display => { language = display?.language === 'en' ? 'en' : 'ru'; applyText(); }); controls.getDisplaySettings().then(display => { language = display?.language === 'en' ? 'en' : 'ru'; applyText(); }); controls.getActiveTheme().then(theme => { if (theme?.cssUrl) $('#frame-theme').href = theme.cssUrl; }); controls.onThemeChanged(theme => { if (theme?.cssUrl) $('#frame-theme').href = theme.cssUrl; });
