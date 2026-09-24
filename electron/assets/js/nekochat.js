const DEFAULT_API = 'https://nekochat.komdu.is-cool.dev';
let API = localStorage.getItem('nk_server_url') || DEFAULT_API;
const xpLogonBackgrounds = [
  ['xp_1024x1280.jpg', 1024, 1280], ['xp_1024x768.jpg', 1024, 768], ['xp_1280x1024.jpg', 1280, 1024],
  ['xp_1280x768.jpg', 1280, 768], ['xp_1280x960.jpg', 1280, 960], ['xp_1360x768.jpg', 1360, 768],
  ['xp_1440x900.jpg', 1440, 900], ['xp_1920x1200.jpg', 1920, 1200], ['xp_768x1280.jpg', 768, 1280],
  ['xp_768x1360.jpg', 768, 1360], ['xp_900x1440.jpg', 900, 1440], ['xp_960x1280.jpg', 960, 1280],
];
let token = localStorage.getItem('nk_token');
let me; let rooms = []; let users = []; let activeTab = 'rooms'; let current;
const $ = selector => document.querySelector(selector);
const desktopControls = window.windowControls || window.parent?.windowControls;
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]);
const translations = {
  ru: { loginHint: 'Чтобы начать, войдите в учётную запись', loginTitle: 'Вход в NekoChat', liveMessages: 'Сообщения реального времени', username: 'Имя пользователя', password: 'Пароль', displayName: 'Отображаемое имя', createAccount: 'Создать учётную запись', backToLogin: 'Вернуться ко входу', turnOff: '⏻ Выключить компьютер', loginFooter: 'После входа можно общаться в комнатах и личных диалогах.', rooms: 'Комнаты', direct: 'Личные', theme: 'Тема', chooseChat: 'Выберите комнату или диалог.', send: 'Отправить ›', search: 'Поиск...', signIn: 'Войти', register: 'Создать учётную запись', ok: 'ОК', cancel: 'Отмена', options: 'Параметры >>', serverUrl: 'URL сервера', editProfile: 'Изменить профиль', logout: 'Выйти' },
  en: { loginHint: 'To begin, sign in to your account', loginTitle: 'Sign in to NekoChat', liveMessages: 'Real-time messages', username: 'Username', password: 'Password', displayName: 'Display name', createAccount: 'Create an account', backToLogin: 'Back to sign in', turnOff: '⏻ Turn off computer', loginFooter: 'After signing in, you can chat in rooms and direct messages.', rooms: 'Rooms', direct: 'Direct', theme: 'Theme', chooseChat: 'Choose a room or conversation.', send: 'Send ›', search: 'Search...', signIn: 'Sign in', register: 'Create account', ok: 'OK', cancel: 'Cancel', options: 'Options >>', serverUrl: 'Server URL', editProfile: 'Edit profile', logout: 'Log out' },
};
let displaySettings = { language: 'ru', loginUi: 'xp' };
function applyDisplaySettings(settings) {
  displaySettings = { ...displaySettings, ...settings };
  const language = displaySettings.language === 'en' ? 'en' : 'ru';
  const text = translations[language];
  document.documentElement.lang = language;
  document.documentElement.dataset.loginUi = displaySettings.loginUi === 'classic' ? 'classic' : 'xp';
  document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = text[node.dataset.i18n] || node.textContent; });
  $('#search').placeholder = text.search; $('#message-input').placeholder = language === 'en' ? 'Message...' : 'Сообщение...';
  $('#auth-switch').textContent = registering ? text.backToLogin : text.createAccount;
  $('#auth-submit').setAttribute('aria-label', registering ? text.register : text.signIn);
}
const api = async (path, options = {}) => {
  const response = await fetch(API + path, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const validationError = Array.isArray(data.detail) ? data.detail.map(item => item.msg).filter(Boolean).join('; ') : '';
    throw new Error(typeof data.detail === 'string' ? data.detail : validationError || `Ошибка сервера (${response.status})`);
  }
  return data;
};
const avatar = user => user?.avatar ? `<img src="${API}/avatars/${encodeURIComponent(user.avatar)}" alt="">` : esc((user?.display_name || user?.username || '?')[0].toUpperCase());
const formatTime = value => new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const userFor = id => users.find(user => user.id === id) || (me?.id === id ? me : null);
function fitXpLogonBackground() {
  const ratio = window.innerWidth / window.innerHeight;
  const [file] = xpLogonBackgrounds.reduce((best, candidate) => Math.abs(candidate[1] / candidate[2] - ratio) < Math.abs(best[1] / best[2] - ratio) ? candidate : best);
  $('#auth-screen').style.backgroundImage = `url("assets/images/${file}")`;
}

function setLoggedIn(user) {
  me = user; $('#auth-screen').hidden = true; $('#chat-app').hidden = false;
  $('#me-avatar').innerHTML = avatar(me); $('#me-name').textContent = me.display_name; $('#me-handle').textContent = `@${me.username}`;
  $('#profile-avatar').innerHTML = avatar(me); $('#profile-name').textContent = me.display_name; $('#profile-bio').textContent = me.bio || 'Пока ничего не написано.'; $('#profile-status').textContent = me.status || '● онлайн';
  const banner = $('.profile-banner');
  banner.style.backgroundImage = me.banner ? `url("${API}/avatars/${encodeURIComponent(me.banner)}")` : 'var(--xp-title-fill)';
  banner.style.backgroundColor = me.banner ? '' : (me.profile_color || '');
  banner.classList.toggle('has-user-banner', Boolean(me.banner));
}
async function refresh() { [rooms, users] = await Promise.all([api('/rooms'), api('/users')]); renderList(); }
function renderList() {
  const query = $('#search').value.trim().toLowerCase(); const list = $('#chat-list');
  const items = activeTab === 'rooms' ? rooms.filter(room => room.name.toLowerCase().includes(query)).map(room => ({ id: room.id, title: room.name, sub: `${room.member_count} участник(ов)`, icon: '#', kind: 'room' })) : users.filter(user => user.id !== me.id && `${user.username} ${user.display_name}`.toLowerCase().includes(query)).map(user => ({ id: user.id, title: user.display_name, sub: `@${user.username}`, icon: avatar(user), online: user.is_online === true, kind: 'dm' }));
  list.innerHTML = items.map(item => `<button class="chat-item ${current?.kind === item.kind && current?.data.id === item.id ? 'active' : ''}" data-kind="${item.kind}" data-id="${item.id}"><span class="avatar ${item.kind === 'dm' ? (item.online ? 'is-online' : 'is-offline') : ''}">${item.icon}${item.kind === 'dm' ? `<i class="presence-dot ${item.online ? 'online' : 'offline'}"></i>` : ''}</span><span class="chat-name"><b>${esc(item.title)}</b><small>${esc(item.sub)}</small></span></button>`).join('') || '<p style="padding:12px;color:#777">Ничего не найдено.</p>';
}
function showUserProfile(user) {
  const online = user.is_online === true;
  $('#user-profile-avatar').innerHTML = avatar(user);
  $('#user-profile-name').textContent = user.display_name || user.username;
  $('#user-profile-handle').textContent = `@${user.username}`;
  $('#user-profile-status').textContent = `● ${online ? 'В сети' : 'Не в сети'}${user.status ? ` · ${user.status}` : ''}`;
  $('#user-profile-status').classList.toggle('offline', !online);
  $('#user-profile-bio').textContent = user.bio || 'Пользователь пока ничего не написал.';
  const banner = $('#user-profile-banner');
  banner.style.backgroundImage = user.banner ? `url("${API}/avatars/${encodeURIComponent(user.banner)}")` : 'var(--xp-title-fill)';
  banner.style.backgroundColor = user.banner ? '' : (user.profile_color || '');
  banner.classList.toggle('has-user-banner', Boolean(user.banner));
  $('#user-profile-dialog').showModal();
}
function appendMessage(message, mine) {
  const sender = message.user || message.sender || userFor(message.user_id || message.sender_id) || { display_name: 'Неизвестно' };
  $('#messages').insertAdjacentHTML('beforeend', `<article class="message ${mine ? 'mine' : ''}"><span class="avatar">${avatar(sender)}</span><div class="message-body"><div class="message-meta">${esc(sender.display_name)}<time>${formatTime(message.created_at)}</time></div><p>${esc(message.content)}</p></div></article>`);
  $('#messages').scrollTop = $('#messages').scrollHeight;
}
async function openChat(kind, id) {
  const data = kind === 'room' ? rooms.find(room => room.id === id) : users.find(user => user.id === id); if (!data) return;
  current = { kind, data }; $('#messages').innerHTML = ''; $('#empty-state').hidden = true;
  // Server 0.10 only documents GET history routes: the former /ws transport was removed.
  $('#message-input').disabled = true; $('#composer button').disabled = true;
  $('#message-input').placeholder = 'Отправка сообщений временно недоступна на этом сервере.';
  $('#composer button').title = 'Сервер не публикует маршрут отправки сообщений.';
  const title = kind === 'room' ? `# ${data.name}` : data.display_name; const subtitle = kind === 'room' ? `${data.member_count} участник(ов)` : `@${data.username}`;
  $('#conversation-header').innerHTML = `<span class="avatar">${kind === 'room' ? '#' : avatar(data)}</span><span><h1>${esc(title)}</h1><small>${esc(subtitle)}</small></span>`;
  renderList();
  try { const history = await api(kind === 'room' ? `/rooms/${id}/messages` : `/users/${id}/messages`); if (current?.kind !== kind || current?.data.id !== id) return; history.forEach(message => appendMessage(message, (message.user?.id || message.sender?.id) === me.id)); } catch (error) { $('#messages').innerHTML = `<p>Не удалось загрузить сообщения: ${esc(error.message)}</p>`; }
}
async function boot() { try { setLoggedIn(await api('/api/me')); await refresh(); } catch (error) { token = null; localStorage.removeItem('nk_token'); $('#auth-screen').hidden = false; $('#auth-error').textContent = 'Сессия истекла. Войдите снова.'; } }

let registering = false;
$('#auth-switch').onclick = () => { registering = !registering; $('.login-card').classList.toggle('registering', registering); applyDisplaySettings(displaySettings); };
$('#classic-options').onclick = () => { $('#classic-server-options').hidden = !$('#classic-server-options').hidden; };
$('#classic-cancel').onclick = () => { $('#auth-password').value = ''; $('#auth-error').textContent = ''; };
$('#server-url').value = API;
$('#server-url').onchange = () => {
  try {
    const url = new URL($('#server-url').value.trim() || DEFAULT_API);
    if (!/^https?:$/.test(url.protocol)) throw new Error();
    API = url.href.replace(/\/$/, ''); localStorage.setItem('nk_server_url', API); $('#server-url').value = API;
  } catch { $('#auth-error').textContent = 'Server URL must start with http:// or https://'; }
};
$('#auth-form').addEventListener('submit', async event => { event.preventDefault(); const username = $('#auth-username').value.trim(); const password = $('#auth-password').value; $('#auth-error').textContent = ''; try { const body = registering ? { username, password, display_name: $('#auth-display').value.trim() || username } : { username, password }; const result = await api(registering ? '/auth/register' : '/auth/login', { method: 'POST', body: JSON.stringify(body) }); token = result.access_token; localStorage.setItem('nk_token', token); setLoggedIn(result.user); await refresh(); } catch (error) { $('#auth-error').textContent = error.message; } });
$('#chat-list').addEventListener('click', event => {
  const button = event.target.closest('[data-kind]');
  if (!button) return;
  if (button.dataset.kind === 'dm' && event.target.closest('.avatar')) return showUserProfile(users.find(user => user.id === Number(button.dataset.id)));
  openChat(button.dataset.kind, Number(button.dataset.id));
});
document.querySelectorAll('.tab').forEach(button => button.onclick = () => { activeTab = button.dataset.tab; current = null; $('#empty-state').hidden = false; $('#messages').innerHTML = ''; $('#conversation-header').innerHTML = ''; $('#message-input').disabled = true; $('#composer button').disabled = true; $('#message-input').placeholder = displaySettings.language === 'en' ? 'Message...' : 'Сообщение...'; $('#composer button').title = ''; document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab === button)); renderList(); });
$('#search').oninput = renderList;
$('#composer').addEventListener('submit', event => { event.preventDefault(); });
$('#add-chat').onclick = () => {
  if (activeTab !== 'rooms') return;
  $('#create-room-error').textContent = '';
  $('#room-name').value = '';
  $('#create-room-dialog').showModal();
  requestAnimationFrame(() => $('#room-name').focus());
};
$('#create-room-cancel').onclick = () => $('#create-room-dialog').close();
$('#create-room-form').onsubmit = async event => {
  event.preventDefault();
  const name = $('#room-name').value.trim();
  if (!name) return;
  const submit = $('#create-room-form button[type="submit"]');
  submit.disabled = true; $('#create-room-error').textContent = '';
  try {
    await api('/rooms', { method: 'POST', body: JSON.stringify({ name }) });
    await refresh();
    $('#create-room-dialog').close();
  } catch (error) { $('#create-room-error').textContent = error.message; }
  finally { submit.disabled = false; }
};
$('#profile-button').onclick = () => $('#profile-dialog').showModal(); document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => document.querySelector(`#${button.dataset.close}`).close()); $('#logout').onclick = () => { token = null; localStorage.removeItem('nk_token'); location.reload(); };
async function uploadProfileImage(path, file) {
  if (!file) return;
  const form = new FormData(); form.append('file', file);
  const response = await fetch(API + path, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || 'Не удалось загрузить изображение.');
  me = { ...me, ...data }; setLoggedIn(me); renderList();
}
function openProfileTask(task) {
  const titles = { details: 'Изменить сведения', avatar: 'Сменить рисунок', banner: 'Сменить баннер', colour: 'Изменить цвет профиля' };
  $('#account-tasks').hidden = false; $('#profile-form').hidden = true; $('#profile-back').hidden = true;
  if (!task) return;
  if (task === 'avatar') return $('#edit-avatar-file').click();
  if (task === 'banner') return $('#edit-banner-file').click();
  $('#account-tasks').hidden = true; $('#profile-form').hidden = false; $('#profile-back').hidden = false;
  $('#profile-task-title').textContent = titles[task];
  $('#edit-status').parentElement.hidden = task === 'colour'; $('#edit-bio').parentElement.hidden = task === 'colour'; $('#edit-colour').parentElement.hidden = task !== 'colour';
  $('.editor-upload').hidden = task !== 'details';
}
$('#edit-profile').onclick = () => desktopControls?.openProfileSettings();
document.querySelectorAll('[data-profile-task]').forEach(button => button.onclick = () => openProfileTask(button.dataset.profileTask));
$('#profile-back').onclick = () => openProfileTask(); $('#profile-cancel').onclick = () => $('#profile-editor').close();
desktopControls?.onProfileChanged(user => { if (!user?.id || user.id !== me?.id) return; setLoggedIn(user); renderList(); });
$('#edit-avatar').onclick = () => $('#edit-avatar-file').click(); $('#edit-banner').onclick = () => $('#edit-banner-file').click();
$('#edit-avatar-file').onchange = async event => { try { await uploadProfileImage('/users/me/avatar', event.target.files[0]); } catch (error) { alert(error.message); } event.target.value = ''; };
$('#edit-banner-file').onchange = async event => { try { await uploadProfileImage('/users/me/banner', event.target.files[0]); } catch (error) { alert(error.message); } event.target.value = ''; };
$('#profile-form').onsubmit = async event => { event.preventDefault(); try { me = await api('/users/me/profile', { method: 'PUT', body: JSON.stringify({ status: $('#edit-status').value.trim(), bio: $('#edit-bio').value.trim(), profile_color: $('#edit-colour').value }) }); setLoggedIn(me); renderList(); $('#profile-editor').close(); } catch (error) { alert(error.message); } };
async function renderThemeList(selected) {
  if (!desktopControls) throw new Error('Настройки темы доступны только в Electron-приложении.');
  const themes = await desktopControls.listThemes();
  $('#theme-list').innerHTML = themes.map(theme => `<option value="${esc(theme.id)}">${esc(theme.name)}</option>`).join('');
  if (selected) $('#theme-list').value = selected;
}
function refreshWindowTheme(revision) { parent.postMessage({ type: 'xp-window-theme', revision }, '*'); }
$('#theme-settings').onclick = () => desktopControls?.openThemeSettings();
$('#theme-apply').onclick = async () => { try { $('#theme-error').textContent = ''; const result = await desktopControls.applyTheme($('#theme-list').value); refreshWindowTheme(result.revision); $('#theme-dialog').close(); } catch (error) { $('#theme-error').textContent = error.message; } };
$('#theme-import').onclick = async () => { try { $('#theme-error').textContent = 'Импорт темы…'; const result = await desktopControls.importTheme(); if (!result) { $('#theme-error').textContent = ''; return; } await renderThemeList(); refreshWindowTheme(result.revision); $('#theme-error').textContent = 'Тема добавлена и применена.'; } catch (error) { $('#theme-error').textContent = error.message; } };
fitXpLogonBackground();
window.addEventListener('resize', fitXpLogonBackground);
window.addEventListener('message', event => {
  if (event.data?.type === 'xp-display-settings') applyDisplaySettings(event.data.settings || {});
  if (event.data?.type === 'xp-theme-refresh') { const link = document.querySelector('#nekochat-style'); if (link) link.href = `assets/css/nekochat.css?theme=${event.data.revision}`; const theme = document.querySelector('#nekochat-theme'); if (theme && event.data.cssUrl) theme.href = event.data.cssUrl; }
});
desktopControls?.getActiveTheme().then(theme => {
  const link = document.querySelector('#nekochat-theme');
  if (link && theme?.cssUrl) link.href = theme.cssUrl;
});
desktopControls?.getDisplaySettings().then(applyDisplaySettings);
if (token) boot();
