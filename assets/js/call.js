const $ = selector => document.querySelector(selector);
const controls = window.windowControls;
function render(state = {}) {
  $('#call-title').textContent = state.title || 'Звонок';
  $('#call-status').textContent = state.status || 'Подключение…';
  const selfAvatar = state.self?.avatar || state.selfAvatar || '☺'; const remoteAvatar = state.remote?.avatar || state.avatar || '☎';
  ['#self-avatar', '#screen-self-avatar'].forEach(selector => { $(selector).innerHTML = selfAvatar; });
  ['#remote-avatar', '#screen-remote-avatar'].forEach(selector => { $(selector).innerHTML = remoteAvatar; });
  ['#self-name', '#screen-self-name'].forEach(selector => { $(selector).textContent = state.self?.name || state.selfName || 'Вы'; });
  ['#remote-name', '#screen-remote-name'].forEach(selector => { $(selector).textContent = state.remote?.name || state.personName || state.title?.replace(/^.*?:\s*/, '') || 'Пользователь'; });
  $('#accept').hidden = !state.incoming;
  $('#decline').hidden = !state.incoming;
  $('#hangup').hidden = Boolean(state.incoming);
  $('#mute').hidden = Boolean(state.incoming);
  $('#share').hidden = Boolean(state.incoming) || !state.direct;
  $('#mute').textContent = state.muted ? 'Включить звук' : 'Заглушить';
  $('#share').textContent = state.sharing === 'self' ? 'Остановить демо' : 'Демонстрация';
  $('#call-connection').hidden = Boolean(state.connected);
  const screen = state.sharing === 'self' || state.sharing === 'remote';
  $('#call-stage').classList.toggle('sharing', screen); $('#screen-stage').hidden = !screen;
  $('#screen-preview').hidden = !state.screenPreview; $('#screen-preview').src = state.screenPreview || '';
  $('#screen-preview').alt = state.sharing === 'self' ? 'Ваш экран' : 'Экран собеседника';
  const note = $('#call-note'); if (note) note.hidden = state.audioAvailable !== false;
}
function action(name) { controls.callAction({ action: name }); }
$('#accept').onclick = () => action('accept');
$('#decline').onclick = () => action('decline');
$('#mute').onclick = () => action('mute');
$('#share').onclick = () => action('share');
$('#hangup').onclick = () => action('hangup');
$('#close').onclick = () => { action('dismiss'); controls.close(); };
controls.onCallUpdate(render);
controls.getActiveTheme().then(theme => { if (theme?.cssUrl) $('#frame-theme').href = theme.cssUrl; });
controls.onThemeChanged(theme => { if (theme?.cssUrl) $('#frame-theme').href = theme.cssUrl; });
