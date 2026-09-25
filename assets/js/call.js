const $ = selector => document.querySelector(selector);
const controls = window.windowControls;
function render(state = {}) {
  $('#call-title').textContent = state.title || 'Звонок';
  $('#call-status').textContent = state.status || 'Подключение…';
  $('#call-avatar').innerHTML = state.avatar || '☎';
  $('#accept').hidden = !state.incoming;
  $('#decline').hidden = !state.incoming;
  $('#hangup').hidden = Boolean(state.incoming);
  $('#mute').hidden = Boolean(state.incoming);
  $('#mute').textContent = state.muted ? 'Включить звук' : 'Заглушить';
  const note = $('#call-note'); if (note) note.hidden = state.audioAvailable !== false;
}
function action(name) { controls.callAction({ action: name }); }
$('#accept').onclick = () => action('accept');
$('#decline').onclick = () => action('decline');
$('#mute').onclick = () => action('mute');
$('#hangup').onclick = () => action('hangup');
$('#close').onclick = () => { action('dismiss'); controls.close(); };
controls.onCallUpdate(render);
controls.getActiveTheme().then(theme => { if (theme?.cssUrl) $('#frame-theme').href = theme.cssUrl; });
controls.onThemeChanged(theme => { if (theme?.cssUrl) $('#frame-theme').href = theme.cssUrl; });
