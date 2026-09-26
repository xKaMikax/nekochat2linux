const DEFAULT_API = 'https://nekochat.komdu.is-cool.dev';
let API = localStorage.getItem('nk_server_url') || DEFAULT_API;
const xpLogonBackgrounds = [
  ['xp_1024x1280.jpg', 1024, 1280], ['xp_1024x768.jpg', 1024, 768], ['xp_1280x1024.jpg', 1280, 1024],
  ['xp_1280x768.jpg', 1280, 768], ['xp_1280x960.jpg', 1280, 960], ['xp_1360x768.jpg', 1360, 768],
  ['xp_1440x900.jpg', 1440, 900], ['xp_1920x1200.jpg', 1920, 1200], ['xp_768x1280.jpg', 768, 1280],
  ['xp_768x1360.jpg', 768, 1360], ['xp_900x1440.jpg', 900, 1440], ['xp_960x1280.jpg', 960, 1280],
];
let token = localStorage.getItem('nk_token');
const SAVED_SESSIONS_KEY = 'nk_saved_sessions';
let me; let rooms = []; let users = []; let activeTab = 'rooms'; let current; let historyKey = '';
let socket; let socketRetry; let socketRetryDelay = 1000;
let activeCall;
let callAudio;
let screenShare;
let remoteScreen;
let ringtone;
const $ = selector => document.querySelector(selector);
const desktopControls = window.windowControls || window.parent?.windowControls;
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]);
const windowQuery = new URLSearchParams(location.search);
const detachedChat = windowQuery.get('detached') === '1' && ['room', 'dm'].includes(windowQuery.get('kind')) && /^\d+$/.test(windowQuery.get('id') || '')
  ? { kind: windowQuery.get('kind'), id: Number(windowQuery.get('id')) }
  : null;
if (detachedChat) document.documentElement.classList.add('detached-chat');
const sounds = Object.freeze({ navigation: 'navigation.wav', notify: 'notify.wav', logon: 'logon.wav', logoff: 'logoff.wav', ringin: 'ringin.wav', ringout: 'ringout.wav', exclamation: 'exclamation.wav', default: 'default.wav', error: 'error.wav', critical: 'critical-stop.wav' });
function playSound(name) { const audio = new Audio(`assets/sounds/${sounds[name]}`); audio.volume = .72; audio.play().catch(() => {}); return audio; }
function showSystemDialog(message, type = 'error', title = 'NekoChat Reloaded') {
  if (desktopControls?.showSystemDialog) { desktopControls.showSystemDialog({ message: String(message || 'Неизвестная ошибка.'), type, title }); return; }
  const dialog = $('#system-dialog'); if (!dialog) return;
  const validType = ['critical', 'error', 'warning', 'info', 'question'].includes(type) ? type : 'error';
  dialog.className = `xp-dialog system-dialog ${validType}`; $('#system-title').textContent = title; $('#system-message').textContent = String(message || 'Неизвестная ошибка.');
  playSound(validType === 'critical' ? 'critical' : validType === 'warning' ? 'exclamation' : validType === 'info' || validType === 'question' ? 'default' : 'error');
  if (!dialog.open) dialog.showModal(); requestAnimationFrame(() => $('#system-ok').focus());
}
window.alert = message => showSystemDialog(message, 'error', t('error'));
function startRingtone(name) { stopRingtone(); ringtone = playSound(name); ringtone.loop = true; }
function stopRingtone() { if (!ringtone) return; ringtone.pause(); ringtone.currentTime = 0; ringtone = null; }
function playServerSound(kind, status = 0) {
  // The API does not decide the severity: derive it locally from the transport result.
  if (kind === 'notification' || kind === 'notice') return playSound('default');
  if (kind === 'warning') return playSound('exclamation');
  if (status >= 400 && status < 500) return playSound('exclamation');
  // These mean that the gateway/service is unavailable, rather than a bad request.
  if ([502, 503, 504].includes(status)) return playSound('critical');
  if (status >= 500 || kind === 'error') return playSound('error');
  return playSound('default');
}
const translations = {
  ru: { loginHint: 'Чтобы начать, выберите учётную запись', loginTitle: 'Вход в NekoChat', liveMessages: 'Сообщения реального времени', username: 'Имя пользователя', password: 'Пароль', displayName: 'Отображаемое имя', createAccount: 'Создать учётную запись', backToLogin: 'Вернуться ко входу', changeServer: 'Сменить URL сервера', loginFooter: 'После входа можно общаться в комнатах и личных диалогах.', rooms: 'Комнаты', direct: 'Личные', theme: 'Тема', chooseChat: 'Выберите комнату или диалог.', send: 'Отправить ›', search: 'Поиск...', emoji: 'Эмодзи', allEmoji: 'Все', emojiSearch: 'Поиск emoji…', emojiFound: 'Найдено', signIn: 'Войти', register: 'Создать учётную запись', ok: 'ОК', cancel: 'Отмена', serverUrl: 'URL сервера', editProfile: 'Изменить профиль', themeBrowser: 'Каталог тем', personalize: 'Персонализация', changeUser: 'Сменить пользователя', logout: 'Выйти из аккаунта', error: 'Ошибка', loginError: 'Ошибка входа', sessionEnded: 'Сеанс завершён', sessionExpired: 'Сохранённая сессия истекла. Войдите снова.', connectionFailed: 'Не удалось подключиться к серверу. Проверьте URL сервера и подключение к сети.', serverError: 'Ошибка сервера ({status})', historyFormat: 'Сервер вернул историю в неизвестном формате.', loadMessages: 'Не удалось загрузить сообщения', socketConnecting: 'Соединение с сервером ещё устанавливается.', callStart: 'Не удалось начать звонок', callAccept: 'Не удалось принять звонок', microphone: 'Не удалось включить микрофон', sendMessage: 'Не удалось отправить сообщение', screenShare: 'Демонстрация экрана', screenAccess: 'Не удалось получить доступ к экрану. Проверьте, что в системе доступен захват экрана, и повторите попытку.', roomAudioUnsupported: 'Аудиозвонки в комнатах API не поддерживает.', screenUnsupported: 'Демонстрация экрана не поддерживается этой версией Electron.', vp8Unsupported: 'VP8 недоступен для демонстрации экрана.', opusUnsupported: 'В этой версии Electron нет поддержки Opus WebCodecs.', opusConfigUnsupported: 'Opus 48 кГц не поддержан этим Chromium.', roomCreate: 'Не удалось создать комнату', themeApply: 'Не удалось применить тему', themeImport: 'Не удалось импортировать тему', imageUpload: 'Не удалось загрузить изображение.', importingTheme: 'Импорт темы…', themeInstalled: 'Тема добавлена и применена.' },
  en: { loginHint: 'To begin, choose an account', loginTitle: 'Sign in to NekoChat', liveMessages: 'Real-time messages', username: 'Username', password: 'Password', displayName: 'Display name', createAccount: 'Create an account', backToLogin: 'Back to sign in', changeServer: 'Change Server URL', loginFooter: 'After signing in, you can chat in rooms and direct messages.', rooms: 'Rooms', direct: 'Direct', theme: 'Theme', chooseChat: 'Choose a room or conversation.', send: 'Send ›', search: 'Search...', emoji: 'Emoji', allEmoji: 'All', emojiSearch: 'Search emoji…', emojiFound: 'Found', signIn: 'Sign in', register: 'Create account', ok: 'OK', cancel: 'Cancel', serverUrl: 'Server URL', editProfile: 'Edit profile', themeBrowser: 'Theme Browser', personalize: 'Personalization', changeUser: 'Change user', logout: 'Log out', error: 'Error', loginError: 'Sign-in error', sessionEnded: 'Session ended', sessionExpired: 'The saved session has expired. Sign in again.', connectionFailed: 'Could not connect to the server. Check the server URL and network connection.', serverError: 'Server error ({status})', historyFormat: 'The server returned message history in an unknown format.', loadMessages: 'Could not load messages', socketConnecting: 'The connection to the server is still being established.', callStart: 'Could not start the call', callAccept: 'Could not accept the call', microphone: 'Could not enable the microphone', sendMessage: 'Could not send the message', screenShare: 'Screen sharing', screenAccess: 'Could not access the screen. Check that screen capture is available and try again.', roomAudioUnsupported: 'The API does not support audio calls in rooms.', screenUnsupported: 'Screen sharing is not supported by this version of Electron.', vp8Unsupported: 'VP8 is unavailable for screen sharing.', opusUnsupported: 'This version of Electron does not support Opus WebCodecs.', opusConfigUnsupported: 'Opus 48 kHz is not supported by this Chromium build.', roomCreate: 'Could not create the room', themeApply: 'Could not apply the theme', themeImport: 'Could not import the theme', imageUpload: 'Could not upload the image.', importingTheme: 'Importing theme…', themeInstalled: 'Theme added and applied.' },
};
function t(key, values = {}) { return String((translations[displaySettings?.language === 'en' ? 'en' : 'ru'] || translations.ru)[key] || key).replace(/\{(\w+)\}/g, (_, name) => values[name] ?? ''); }
let displaySettings = { language: 'ru', loginUi: 'xp' };
function applyDisplaySettings(settings) {
  displaySettings = { ...displaySettings, ...settings };
  const language = displaySettings.language === 'en' ? 'en' : 'ru';
  const text = translations[language];
  document.documentElement.lang = language;
  document.documentElement.dataset.loginUi = displaySettings.loginUi === 'classic' ? 'classic' : 'xp';
  document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = text[node.dataset.i18n] || node.textContent; });
  $('#search').placeholder = text.search; $('#message-input').placeholder = language === 'en' ? 'Message...' : 'Сообщение...';
  $('#emoji-button').setAttribute('aria-label', text.emoji); $('#emoji-button').title = text.emoji;
  $('#auth-switch').textContent = registering ? text.backToLogin : text.createAccount;
  $('#auth-submit').setAttribute('aria-label', registering ? text.register : text.signIn);
}
const api = async (path, options = {}) => {
  let response;
  try {
    response = await fetch(API + path, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) } });
  } catch (error) { throw new Error(t('connectionFailed')); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const validationError = Array.isArray(data.detail) ? data.detail.map(item => item.msg).filter(Boolean).join('; ') : '';
    throw new Error(typeof data.detail === 'string' ? data.detail : validationError || t('serverError', { status: response.status }));
  }
  return data;
};
function savedSessions() { try { const value = JSON.parse(localStorage.getItem(SAVED_SESSIONS_KEY) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; } }
function writeSavedSessions(items) { localStorage.setItem(SAVED_SESSIONS_KEY, JSON.stringify(items.slice(0, 12))); }
function rememberSession(user) {
  if (!token || !user?.id) return;
  const key = `${API}|${user.id}`;
  writeSavedSessions([{ key, server: API, token, user }, ...savedSessions().filter(item => item?.key !== key)]);
}
function renderSavedUsers() {
  const sessions = savedSessions(); const list = $('#saved-users');
  list.hidden = false;
  $('#auth-screen').classList.remove('account-selected');
  list.innerHTML = sessions.map((session, index) => {
    const user = session.user || {}; const image = user.avatar ? `<img src="${esc(session.server)}/avatars/${encodeURIComponent(user.avatar)}" alt="">` : esc((user.display_name || user.username || '?')[0].toUpperCase());
    return `<button class="saved-user" type="button" data-saved-session="${index}"><span class="xp-user-avatar">${image}</span><span><b>${esc(user.display_name || user.username)}</b><small>@${esc(user.username || '')}</small></span></button>`;
  }).join('');
  $('#show-login-form').hidden = sessions.length === 0;
  $('#auth-form').hidden = sessions.length > 0;
  $('#back-to-users').hidden = true;
}
function showAuthScreen() { $('#chat-app').hidden = true; $('#auth-screen').hidden = false; $('#welcome-screen').hidden = true; renderSavedUsers(); }
function showLoginForm() { $('#auth-screen').classList.remove('account-selected'); $('#auth-form').hidden = false; $('#saved-users').hidden = true; $('#show-login-form').hidden = true; $('#back-to-users').hidden = savedSessions().length === 0; $('#auth-error').textContent = ''; $('#login-selected-avatar').innerHTML = '<img src="assets/images/nekochat_icon.png" alt="NekoChat">'; $('#login-selected-name').textContent = displaySettings.language === 'en' ? 'Sign in to NekoChat' : 'Вход в NekoChat'; $('#login-selected-hint').textContent = displaySettings.language === 'en' ? 'Enter your account details' : 'Введите данные учётной записи'; }
function showWelcome() { $('#auth-screen').hidden = false; $('#welcome-screen').hidden = false; }
async function useSavedSession(index) {
  const session = savedSessions()[index]; if (!session?.token || !session?.server) return;
  API = session.server; token = session.token; localStorage.setItem('nk_server_url', API); localStorage.setItem('nk_token', token); $('#server-url').value = API; showWelcome();
  try { const user = await api('/api/me'); rememberSession(user); setLoggedIn(user, true); await refresh(); }
  catch (error) { writeSavedSessions(savedSessions().filter(item => item?.key !== session.key)); token = null; localStorage.removeItem('nk_token'); showAuthScreen(); showLoginForm(); $('#auth-username').value = session.user?.username || ''; showSystemDialog(t('sessionExpired'), 'warning', t('sessionEnded')); }
}
const avatar = user => user?.avatar ? `<img src="${API}/avatars/${encodeURIComponent(user.avatar)}" alt="">` : esc((user?.display_name || user?.username || '?')[0].toUpperCase());
const formatTime = value => new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const userFor = id => users.find(user => user.id === id) || (me?.id === id ? me : null);
function fitXpLogonBackground() {
  const ratio = window.innerWidth / window.innerHeight;
  const [file] = xpLogonBackgrounds.reduce((best, candidate) => Math.abs(candidate[1] / candidate[2] - ratio) < Math.abs(best[1] / best[2] - ratio) ? candidate : best);
  $('#auth-screen').style.backgroundImage = `url("assets/images/${file}")`;
}

function setLoggedIn(user, announceLogin = false) {
  me = user; rememberSession(user); $('#welcome-screen').hidden = true; $('#auth-screen').hidden = true; $('#chat-app').hidden = false;
  $('#me-avatar').innerHTML = avatar(me); $('#me-name').textContent = me.display_name; $('#me-handle').textContent = `@${me.username}`;
  $('#profile-avatar').innerHTML = avatar(me); $('#profile-name').textContent = me.display_name; $('#profile-bio').textContent = me.bio || 'Пока ничего не написано.'; $('#profile-status').textContent = me.status || '● онлайн';
  const banner = $('.profile-banner');
  banner.style.backgroundImage = me.banner ? `url("${API}/avatars/${encodeURIComponent(me.banner)}")` : 'var(--xp-title-fill)';
  banner.style.backgroundColor = me.banner ? '' : (me.profile_color || '');
  banner.classList.toggle('has-user-banner', Boolean(me.banner));
  connectSocket();
  if (announceLogin) playSound('logon');
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
function messageKey(message) { return `${message.id ?? ''}:${message.created_at ?? ''}:${message.content ?? ''}`; }
function appendMessage(message, mine, key = messageKey(message), pending = false) {
  const sender = message.user || message.sender || userFor(message.user_id || message.sender_id) || { display_name: 'Неизвестно' };
  const profileId = sender.id ? ` data-profile-id="${sender.id}"` : '';
  $('#messages').insertAdjacentHTML('beforeend', `<article class="message ${mine ? 'mine' : ''}" data-key="${esc(key)}" data-content="${esc(message.content)}"${pending ? ' data-pending="true"' : ''}><span class="avatar profile-trigger"${profileId}>${avatar(sender)}</span><div class="message-body"><div class="message-meta profile-trigger"${profileId}>${esc(sender.display_name)}<time>${formatTime(message.created_at)}</time></div><p>${esc(message.content)}</p></div></article>`);
  $('#messages').scrollTop = $('#messages').scrollHeight;
}
async function openChat(kind, id, { force = false } = {}) {
  const data = kind === 'room' ? rooms.find(room => room.id === id) : users.find(user => user.id === id); if (!data) return;
  if (!force && !detachedChat && await desktopControls?.focusDetachedChat?.({ kind, id })) return;
  current = { kind, data }; $('#messages').innerHTML = ''; $('#empty-state').hidden = true;
  historyKey = '';
  $('#message-input').disabled = false; document.querySelectorAll('#composer button').forEach(button => { button.disabled = false; });
  $('#message-input').placeholder = displaySettings.language === 'en' ? 'Message...' : 'Сообщение...';
  $('#composer button').title = '';
  const title = kind === 'room' ? `# ${data.name}` : data.display_name; const subtitle = kind === 'room' ? `${data.member_count} участник(ов)` : `@${data.username}`;
  const profileId = kind === 'dm' ? ` data-profile-id="${data.id}"` : '';
  $('#conversation-header').innerHTML = `<span class="avatar ${kind === 'dm' ? 'profile-trigger' : ''}"${profileId}>${kind === 'room' ? '#' : avatar(data)}</span><span class="${kind === 'dm' ? 'profile-trigger' : ''}"${profileId}><h1>${esc(title)}</h1><small>${esc(subtitle)}</small></span><span class="header-actions"><button class="call-button" id="start-call" type="button" aria-label="Позвонить" title="Позвонить"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.62 10.79a15.46 15.46 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.02-.24c1.12.37 2.32.57 3.57.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.61 21 3 13.39 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.24 1.02z"/></svg></button></span>`;
  renderList();
  await refreshCurrentHistory();
}
async function refreshCurrentHistory() {
  if (!current) return;
  const selected = current;
  try {
    const response = await api(selected.kind === 'room' ? `/rooms/${selected.data.id}/messages` : `/users/${selected.data.id}/messages`);
    const history = Array.isArray(response) ? response : (response.messages || response.items || []);
    if (!Array.isArray(history)) throw new Error(t('historyFormat'));
    if (current !== selected) return;
    const key = history.map(message => `${message.id}:${message.created_at}:${message.content}`).join('|');
    if (key === historyKey) return;
    historyKey = key; $('#messages').innerHTML = '';
    history.forEach(message => appendMessage(message, (message.user?.id || message.sender?.id) === me.id));
  } catch (error) {
    $('#messages').innerHTML = '';
    const warning = /not a member|forbidden|access denied/i.test(String(error.message));
    showSystemDialog(error.message, warning ? 'warning' : 'error', t('loadMessages'));
  }
}
function websocketUrl() {
  const url = new URL(API);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/$/, '')}/ws`.replace(/^\/\//, '/');
  url.search = ''; url.searchParams.set('token', token);
  return url.href;
}
function socketMessage(payload) {
  const type = payload?.type;
  if (type === 'status') {
    const user = users.find(item => item.id === (payload.user_id ?? payload.user?.id));
    if (user) { user.is_online = payload.is_online ?? payload.online ?? true; renderList(); }
    return;
  }
  if (type === 'error' || type === 'warning' || type === 'notification' || type === 'notice') {
    playServerSound(type);
    return;
  }
  if (type === 'call' || type === 'call_answer' || type === 'call_hangup') { handleCallSignal(payload); return; }
  if (type === 'screen_start' || type === 'screen_stop' || type === 'screen_frame') { handleScreenSignal(payload); return; }
  if (type === 'call_audio') { receiveCallAudio(payload); return; }
  if (type !== 'room_message' && type !== 'direct_message') return;
  const message = payload.message || payload;
  const roomId = payload.room_id ?? message.room_id;
  const otherId = payload.to_id ?? payload.user_id ?? message.to_id ?? message.user_id;
  const matchingRoom = current?.kind === 'room' && Number(roomId) === Number(current.data.id);
  const matchingDirect = current?.kind === 'dm' && [message.user_id, message.sender_id, message.to_id, payload.from_id, payload.to_id].some(id => Number(id) === Number(current.data.id));
  const mine = Number(message.user?.id || message.sender?.id || message.user_id || message.sender_id) === Number(me?.id);
  const sender = message.user || message.sender || userFor(message.user_id || message.sender_id || payload.from_id) || { display_name: 'Пользователь' };
  // An open conversation is already the notification: do not interrupt the user
  // with a desktop toast for messages they can see immediately.
  if (!mine && !matchingRoom && !matchingDirect) {
    desktopControls?.notifyMessage?.({ sender: sender.display_name || sender.username || 'Пользователь', content: String(message.content || ''), avatarUrl: sender.avatar ? `${API}/avatars/${encodeURIComponent(sender.avatar)}` : '' });
  }
  if (!matchingRoom && !matchingDirect) { if (!mine) playSound('notify'); return; }
  const key = messageKey(message);
  if ([...document.querySelectorAll('#messages article')].some(node => node.dataset.key === key)) return;
  if (mine) {
    const pending = [...document.querySelectorAll('#messages article[data-pending="true"]')].find(node => node.dataset.content === String(message.content));
    if (pending) { pending.dataset.key = key; delete pending.dataset.pending; return; }
  }
  appendMessage(message, mine);
  $('#messages article:last-child').dataset.key = key;
}
function connectSocket() {
  if (!token || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
  clearTimeout(socketRetry);
  try { socket = new WebSocket(websocketUrl()); } catch { return; }
  socket.onopen = () => { socketRetryDelay = 1000; socket.send(JSON.stringify({ type: 'ping' })); };
  socket.onmessage = event => { try { socketMessage(JSON.parse(event.data)); } catch {} };
  socket.onclose = () => {
    socket = null;
    if (token) { socketRetry = setTimeout(connectSocket, socketRetryDelay); socketRetryDelay = Math.min(socketRetryDelay * 2, 15000); }
  };
  socket.onerror = () => socket?.close();
}
function disconnectSocket() { clearTimeout(socketRetry); socketRetryDelay = 1000; socket?.close(); socket = null; }
function sendSocketMessage(payload) {
  if (socket?.readyState !== WebSocket.OPEN) { connectSocket(); throw new Error(t('socketConnecting')); }
  socket.send(JSON.stringify(payload));
}
function callId() { return globalThis.crypto?.randomUUID?.() || `call-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function callTarget(source = current) { return source?.kind === 'room' ? { room_id: source.data.id } : { to_id: source?.data.id }; }
function callPerson(target = current) { return target?.kind === 'room' ? { display_name: `# ${target.data.name}` } : target?.data || { display_name: 'пользователь' }; }
function bytesToBase64(bytes) { let text = ''; for (let start = 0; start < bytes.length; start += 0x8000) text += String.fromCharCode(...bytes.subarray(start, start + 0x8000)); return btoa(text); }
function base64ToBytes(value) { const text = atob(value); return Uint8Array.from(text, char => char.charCodeAt(0)); }
function stopCallAudio() {
  if (!callAudio) return;
  callAudio.processor?.disconnect(); callAudio.source?.disconnect(); callAudio.silence?.disconnect();
  callAudio.stream?.getTracks().forEach(track => track.stop());
  try { callAudio.encoder?.close(); } catch {} try { callAudio.decoder?.close(); } catch {}
  callAudio.context?.close(); callAudio = null;
}
function playDecodedAudio(audioData) {
  if (!callAudio?.context) { audioData.close(); return; }
  const frames = audioData.numberOfFrames;
  const buffer = callAudio.context.createBuffer(audioData.numberOfChannels, frames, audioData.sampleRate);
  for (let channel = 0; channel < audioData.numberOfChannels; channel += 1) audioData.copyTo(buffer.getChannelData(channel), { planeIndex: channel });
  audioData.close();
  const source = callAudio.context.createBufferSource(); source.buffer = buffer; source.connect(callAudio.context.destination);
  callAudio.playAt = Math.max(callAudio.playAt || 0, callAudio.context.currentTime + .04);
  source.start(callAudio.playAt); callAudio.playAt += buffer.duration;
}
async function startCallAudio() {
  if (!activeCall?.target?.to_id || callAudio) return;
  if (!globalThis.AudioEncoder || !globalThis.AudioDecoder || !navigator.mediaDevices?.getUserMedia) throw new Error(t('opusUnsupported'));
  const opus = { codec: 'opus', sampleRate: 48000, numberOfChannels: 1, bitrate: 32000 };
  const support = await AudioEncoder.isConfigSupported(opus);
  if (!support.supported) throw new Error(t('opusConfigUnsupported'));
  const context = new AudioContext({ sampleRate: 48000 }); await context.resume();
  const state = { context, sequence: 0, frameIndex: 0, pending: new Float32Array(0), playAt: context.currentTime };
  state.decoder = new AudioDecoder({ output: playDecodedAudio, error: error => console.warn('Opus decode failed:', error) });
  state.decoder.configure(opus);
  state.encoder = new AudioEncoder({ output: chunk => {
    if (!activeCall || activeCall !== state.call || chunk.byteLength === 0) return;
    const bytes = new Uint8Array(chunk.byteLength); chunk.copyTo(bytes);
    try { sendSocketMessage({ type: 'call_audio', to_id: activeCall.target.to_id, call_id: activeCall.callId, seq: state.sequence++, audio: bytesToBase64(bytes) }); } catch {}
  }, error: error => console.warn('Opus encode failed:', error) });
  state.encoder.configure(opus); state.call = activeCall;
  const micDeviceId = (await desktopControls?.getDisplaySettings?.())?.micDeviceId;
  state.stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: micDeviceId ? { exact: micDeviceId } : undefined, channelCount: 1, sampleRate: 48000, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
  state.stream.getAudioTracks().forEach(track => { track.enabled = !activeCall?.muted; });
  state.source = context.createMediaStreamSource(state.stream); state.processor = context.createScriptProcessor(4096, 1, 1); state.silence = context.createGain(); state.silence.gain.value = 0;
  state.processor.onaudioprocess = event => {
    const input = event.inputBuffer.getChannelData(0); const joined = new Float32Array(state.pending.length + input.length); joined.set(state.pending); joined.set(input, state.pending.length);
    let offset = 0;
    while (joined.length - offset >= 960) {
      const frame = joined.slice(offset, offset + 960); offset += 960;
      const data = new AudioData({ format: 'f32', sampleRate: 48000, numberOfFrames: 960, numberOfChannels: 1, timestamp: state.frameIndex++ * 20000, data: frame });
      state.encoder.encode(data); data.close();
    }
    state.pending = joined.slice(offset);
  };
  state.source.connect(state.processor); state.processor.connect(state.silence); state.silence.connect(context.destination); callAudio = state;
}
function receiveCallAudio(payload) {
  if (!callAudio || !activeCall || payload.call_id !== activeCall.callId || !payload.audio) return;
  try { callAudio.decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: Number(payload.seq || 0) * 20000, data: base64ToBytes(payload.audio) })); } catch (error) { console.warn('Invalid Opus frame:', error); }
}
function updateScreenPreview(frame, state) {
  if (!activeCall || Date.now() - (state.lastPreview || 0) < 160) return;
  state.lastPreview = Date.now();
  const width = Math.max(1, Math.min(frame.displayWidth || frame.codedWidth, 960));
  const height = Math.max(1, Math.round(width * (frame.displayHeight || frame.codedHeight) / (frame.displayWidth || frame.codedWidth)));
  state.canvas ||= document.createElement('canvas'); state.canvas.width = width; state.canvas.height = height;
  state.canvas.getContext('2d').drawImage(frame, 0, 0, width, height);
  activeCall.screenPreview = state.canvas.toDataURL('image/jpeg', .7); updateCallWindow();
}
function stopScreenShare(notify = true) {
  if (!screenShare) return;
  screenShare.reader?.cancel().catch(() => {}); screenShare.stream?.getTracks().forEach(track => track.stop()); try { screenShare.encoder?.close(); } catch {}
  if (notify && activeCall?.target?.to_id) { try { sendSocketMessage({ type: 'screen_stop', to_id: activeCall.target.to_id, call_id: activeCall.callId }); } catch {} }
  screenShare = null; if (activeCall) { activeCall.sharing = null; activeCall.screenPreview = ''; updateCallWindow(); }
}
function stopRemoteScreen() { try { remoteScreen?.decoder?.close(); } catch {} remoteScreen = null; }
async function toggleScreenShare() {
  if (!activeCall?.target?.to_id || activeCall.incoming || activeCall.status !== 'Разговор по Opus') return;
  if (screenShare) return stopScreenShare();
  if (!globalThis.VideoEncoder || !globalThis.MediaStreamTrackProcessor || !navigator.mediaDevices?.getDisplayMedia) throw new Error(t('screenUnsupported'));
  await desktopControls?.prepareDisplayCapture?.();
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 12, max: 15 } }, audio: false });
  const track = stream.getVideoTracks()[0]; const settings = track.getSettings(); const width = settings.width || 1280; const height = settings.height || 720;
  const config = { codec: 'vp8', width, height, bitrate: 1_500_000, framerate: 12 };
  if (!(await VideoEncoder.isConfigSupported(config)).supported) { stream.getTracks().forEach(item => item.stop()); throw new Error(t('vp8Unsupported')); }
  const state = { stream, sequence: 0, lastPreview: 0 }; screenShare = state;
  state.encoder = new VideoEncoder({ output: chunk => { if (screenShare !== state || !activeCall) return; const bytes = new Uint8Array(chunk.byteLength); chunk.copyTo(bytes); try { sendSocketMessage({ type: 'screen_frame', to_id: activeCall.target.to_id, call_id: activeCall.callId, seq: state.sequence++, key: chunk.type === 'key', data: bytesToBase64(bytes) }); } catch {} }, error: error => console.warn('VP8 encode failed:', error) });
  state.encoder.configure(config); state.reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
  activeCall.sharing = 'self'; activeCall.screenPreview = ''; updateCallWindow();
  sendSocketMessage({ type: 'screen_start', to_id: activeCall.target.to_id, call_id: activeCall.callId, codec: 'vp8', width, height });
  track.onended = () => { if (screenShare === state) stopScreenShare(); };
  (async () => { while (screenShare === state) { const { value: frame, done } = await state.reader.read(); if (done || !frame) break; updateScreenPreview(frame, state); state.encoder.encode(frame, { keyFrame: state.sequence % 72 === 0 }); frame.close(); } })().catch(error => console.warn('Screen capture failed:', error));
}
function handleScreenSignal(payload) {
  if (!activeCall || activeCall.callId !== payload.call_id || !activeCall.target.to_id) return;
  const senderId = Number(payload.from_id ?? payload.sender_id ?? payload.user_id); if (senderId && senderId === Number(me?.id)) return;
  if (payload.type === 'screen_start') {
    stopRemoteScreen(); const state = { lastPreview: 0 };
    try {
      state.decoder = new VideoDecoder({ output: frame => { if (remoteScreen === state) updateScreenPreview(frame, state); frame.close(); }, error: error => console.warn('VP8 decode failed:', error) });
      state.decoder.configure({ codec: payload.codec || 'vp8', codedWidth: Number(payload.width) || 1280, codedHeight: Number(payload.height) || 720 }); remoteScreen = state;
      activeCall.sharing = 'remote'; activeCall.screenPreview = ''; updateCallWindow();
    } catch (error) { console.warn('Screen share unavailable:', error); }
    return;
  }
  if (payload.type === 'screen_stop') { stopRemoteScreen(); if (activeCall.sharing === 'remote') { activeCall.sharing = null; activeCall.screenPreview = ''; updateCallWindow(); } return; }
  if (!remoteScreen?.decoder || !payload.data) return;
  try { remoteScreen.decoder.decode(new EncodedVideoChunk({ type: payload.key ? 'key' : 'delta', timestamp: Number(payload.seq || 0) * 83333, data: base64ToBytes(payload.data) })); } catch (error) { console.warn('Invalid VP8 frame:', error); }
}
function updateCallWindow() {
  if (!activeCall) return;
  const person = activeCall.person || { display_name: 'пользователь' };
  desktopControls?.openCallWindow({
    title: activeCall.incoming ? `Входящий звонок: ${person.display_name}` : `Звонок: ${person.display_name}`,
    status: activeCall.status || 'Подключение…', avatar: activeCall.kind === 'room' ? '#' : avatar(person),
    incoming: Boolean(activeCall.incoming), audioAvailable: false, muted: Boolean(activeCall.muted), direct: Boolean(activeCall.target.to_id), connected: activeCall.status === 'Разговор по Opus', self: { avatar: avatar(me || {}), name: me?.display_name || me?.username || 'Вы' }, remote: { avatar: activeCall.kind === 'room' ? '#' : avatar(person), name: person.display_name || person.username || 'Пользователь' }, sharing: activeCall.sharing, screenPreview: activeCall.screenPreview || '',
  });
}
function endCall(reason, notify = true) {
  if (activeCall && notify) {
    try { sendSocketMessage({ type: 'call_hangup', call_id: activeCall.callId, ...activeCall.target, ...(reason ? { reason } : {}) }); } catch {}
  }
  stopRingtone();
  stopScreenShare(false);
  stopRemoteScreen();
  stopCallAudio();
  activeCall = null;
  desktopControls?.closeCallWindow();
}
function startCall() {
  if (!current || activeCall) return;
  const target = callTarget();
  if (!target.to_id && !target.room_id) return;
  activeCall = { callId: callId(), target, kind: current.kind, person: callPerson(), incoming: false, status: 'Ожидание ответа…' };
  updateCallWindow();
  startRingtone('ringout');
  try { sendSocketMessage({ type: 'call', call_id: activeCall.callId, ...target }); }
  catch (error) { stopRingtone(); activeCall = null; desktopControls?.closeCallWindow(); showSystemDialog(error.message, 'error', t('callStart')); }
}
function handleCallSignal(payload) {
  const senderId = Number(payload.from_id ?? payload.sender_id ?? payload.user_id ?? payload.user?.id);
  const isOwnEcho = activeCall?.callId === payload.call_id && !senderId || senderId === Number(me?.id);
  if (payload.type === 'call') {
    if (isOwnEcho) return;
    const target = payload.room_id != null ? { room_id: payload.room_id } : senderId ? { to_id: senderId } : null;
    if (!target) return;
    if (activeCall) { try { sendSocketMessage({ type: 'call_hangup', call_id: payload.call_id, ...target, reason: 'busy' }); } catch {} return; }
    activeCall = { callId: payload.call_id, target, kind: payload.room_id != null ? 'room' : 'dm', person: payload.room_id != null ? { display_name: `# ${rooms.find(room => Number(room.id) === Number(payload.room_id))?.name || 'Комната'}` } : userFor(senderId) || { display_name: 'Пользователь' }, incoming: true, status: 'Вам звонят' };
    startRingtone('ringin');
    updateCallWindow(); return;
  }
  if (!activeCall || activeCall.callId !== payload.call_id) return;
  if (payload.type === 'call_answer') {
    stopRingtone();
    activeCall.incoming = false; activeCall.status = 'Подключение микрофона…'; updateCallWindow();
    startCallAudio().then(() => { if (activeCall?.callId === payload.call_id) { activeCall.status = 'Разговор по Opus'; updateCallWindow(); } }).catch(error => endCall('mic') || showSystemDialog(error.message, 'error', t('microphone')));
  }
  if (payload.type === 'call_hangup') { stopRingtone(); stopCallAudio(); stopScreenShare(false); stopRemoteScreen(); activeCall = null; desktopControls?.closeCallWindow(); }
}
async function boot() {
  try {
    setLoggedIn(await api('/api/me'));
    await refresh();
    if (detachedChat) await openChat(detachedChat.kind, detachedChat.id);
  } catch (error) { token = null; localStorage.removeItem('nk_token'); showAuthScreen(); $('#auth-error').textContent = t('sessionExpired'); }
}

let registering = false;
$('#auth-switch').onclick = () => { registering = !registering; $('.login-card').classList.toggle('registering', registering); applyDisplaySettings(displaySettings); };
$('#classic-cancel').onclick = () => { $('#auth-password').value = ''; $('#auth-error').textContent = ''; };
$('#show-login-form').onclick = showLoginForm;
$('#back-to-users').onclick = renderSavedUsers;
$('#saved-users').onclick = event => { const button = event.target.closest('[data-saved-session]'); if (button) useSavedSession(Number(button.dataset.savedSession)); };
$('#server-url').value = API;
$('#change-server').onclick = () => { $('#server-switch').hidden = !$('#server-switch').hidden; $('#server-url').focus(); };
$('#server-url').onchange = () => {
  try {
    const url = new URL($('#server-url').value.trim() || DEFAULT_API);
    if (!/^https?:$/.test(url.protocol)) throw new Error();
    API = url.href.replace(/\/$/, ''); localStorage.setItem('nk_server_url', API); $('#server-url').value = API; renderSavedUsers();
  } catch { $('#auth-error').textContent = displaySettings.language === 'en' ? 'Server URL must start with http:// or https://' : 'URL сервера должен начинаться с http:// или https://'; }
};
$('#auth-form').addEventListener('submit', async event => { event.preventDefault(); const username = $('#auth-username').value.trim(); const password = $('#auth-password').value; $('#auth-error').textContent = ''; showWelcome(); try { const body = registering ? { username, password, display_name: $('#auth-display').value.trim() || username } : { username, password }; const result = await api(registering ? '/auth/register' : '/auth/login', { method: 'POST', body: JSON.stringify(body) }); token = result.access_token; localStorage.setItem('nk_token', token); rememberSession(result.user); setLoggedIn(result.user, true); await refresh(); } catch (error) { $('#welcome-screen').hidden = true; showSystemDialog(error.message, 'critical', t('loginError')); } });
$('#chat-list').addEventListener('click', event => {
  const button = event.target.closest('[data-kind]');
  if (!button) return;
  if (button.dataset.kind === 'dm' && event.target.closest('.avatar')) return showUserProfile(users.find(user => user.id === Number(button.dataset.id)));
  openChat(button.dataset.kind, Number(button.dataset.id));
});
function openProfileFromTrigger(event) {
  const trigger = event.target.closest('[data-profile-id]');
  const user = trigger && userFor(Number(trigger.dataset.profileId));
  if (user) showUserProfile(user);
}
$('#conversation-header').addEventListener('click', openProfileFromTrigger);
$('#conversation-header').addEventListener('click', event => { if (event.target.closest('#start-call')) startCall(); });
$('#conversation-header').addEventListener('pointerdown', event => {
  if (!current || event.button !== 0 || event.target.closest('button, .profile-trigger')) return;
  const start = { x: event.screenX, y: event.screenY };
  const header = event.currentTarget;
  header.setPointerCapture(event.pointerId);
  header.classList.add('detaching');
  const finish = move => {
    header.classList.remove('detaching');
    if (Math.hypot(move.screenX - start.x, move.screenY - start.y) < 24) return;
    const chat = { kind: current.kind, id: current.data.id };
    if (detachedChat) desktopControls?.returnChat?.({ ...chat, point: { x: move.screenX, y: move.screenY } });
    else {
      const detach = desktopControls?.detachChat;
      if (!detach) return;
      detach(chat).then(opened => {
        if (!opened || !current || current.kind !== chat.kind || Number(current.data.id) !== Number(chat.id)) return;
        current = null; historyKey = ''; $('#empty-state').hidden = false; $('#messages').innerHTML = ''; $('#conversation-header').innerHTML = '';
        $('#message-input').disabled = true; document.querySelectorAll('#composer button').forEach(button => { button.disabled = true; });
      });
    }
  };
  header.addEventListener('pointerup', finish, { once: true });
  header.addEventListener('pointercancel', () => header.classList.remove('detaching'), { once: true });
});
desktopControls?.onChatRestore?.(chat => openChat(chat.kind, Number(chat.id), { force: true }));
$('#messages').addEventListener('click', openProfileFromTrigger);
document.querySelectorAll('.tab').forEach(button => button.onclick = () => { activeTab = button.dataset.tab; current = null; historyKey = ''; $('#empty-state').hidden = false; $('#messages').innerHTML = ''; $('#conversation-header').innerHTML = ''; $('#message-input').disabled = true; document.querySelectorAll('#composer button').forEach(button => { button.disabled = true; }); $('#message-input').placeholder = displaySettings.language === 'en' ? 'Message...' : 'Сообщение...'; $('#send-message').title = ''; document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab === button)); renderList(); });
$('#system-ok').onclick = () => $('#system-dialog').close(); $('#system-close').onclick = () => $('#system-dialog').close();
$('#search').oninput = renderList;
$('#composer').addEventListener('submit', async event => {
  event.preventDefault();
  const content = $('#message-input').value.trim();
  if (!content || !current) return;
  const submit = $('#send-message'); submit.disabled = true;
  try {
    sendSocketMessage(current.kind === 'room'
      ? { type: 'room_message', room_id: current.data.id, content }
      : { type: 'direct_message', to_id: current.data.id, content });
    appendMessage({ id: `local-${Date.now()}`, content, created_at: new Date().toISOString(), user: me }, true, `local:${Date.now()}:${content}`, true);
    $('#message-input').value = '';
  } catch (error) { showSystemDialog(error.message, 'error', t('sendMessage')); }
  finally { submit.disabled = false; }
});
$('#emoji-button').onclick = () => desktopControls?.openEmojiBrowser?.();
desktopControls?.onEmojiSelected?.(emoji => {
  if (typeof emoji !== 'string') return;
  const input = $('#message-input');
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  input.setRangeText(emoji, start, end, 'end');
  input.focus();
});
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
  } catch (error) { $('#create-room-error').textContent = ''; showSystemDialog(error.message, 'error', t('roomCreate')); }
  finally { submit.disabled = false; }
};
$('#profile-button').onclick = () => $('#profile-dialog').showModal(); document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => document.querySelector(`#${button.dataset.close}`).close());
function leaveAccount(forgetSession) { stopRingtone(); playSound('logoff'); desktopControls?.closeDetachedChats?.(); disconnectSocket(); if (forgetSession) writeSavedSessions(savedSessions().filter(item => item?.key !== `${API}|${me?.id}`)); token = null; localStorage.removeItem('nk_token'); $('#profile-dialog').close(); showAuthScreen(); }
$('#change-user').onclick = () => leaveAccount(false);
$('#logout').onclick = () => leaveAccount(true);
function acceptCall() {
  if (!activeCall?.incoming) return;
  try {
    if (!activeCall.target.to_id) throw new Error(t('roomAudioUnsupported'));
    stopRingtone();
    sendSocketMessage({ type: 'call_answer', call_id: activeCall.callId, ...activeCall.target }); activeCall.incoming = false; activeCall.status = 'Подключение микрофона…'; updateCallWindow();
    const id = activeCall.callId;
    startCallAudio().then(() => { if (activeCall?.callId === id) { activeCall.status = 'Разговор по Opus'; updateCallWindow(); } }).catch(error => endCall('mic') || showSystemDialog(error.message, 'error', t('microphone')));
  }
  catch (error) { showSystemDialog(error.message, 'error', t('callAccept')); }
}
desktopControls?.onCallAction?.(({ action } = {}) => {
  if (action === 'accept') acceptCall();
  else if (action === 'decline') endCall('declined');
  else if (action === 'mute') {
    if (!activeCall) return;
    activeCall.muted = !activeCall.muted;
    callAudio?.stream?.getAudioTracks().forEach(track => { track.enabled = !activeCall.muted; });
    updateCallWindow();
  }
  else if (action === 'share') toggleScreenShare().catch(error => showSystemDialog(error.name === 'NotSupportedError' ? t('screenAccess') : error.message, 'warning', t('screenShare')));
  else if (action === 'hangup' || action === 'dismiss') endCall(activeCall?.incoming ? 'declined' : undefined);
});
document.addEventListener('click', event => { if (event.target.closest('button, .avatar, .profile-trigger')) playSound('navigation'); });
async function uploadProfileImage(path, file) {
  if (!file) return;
  const form = new FormData(); form.append('file', file);
  const response = await fetch(API + path, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || t('imageUpload'));
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
$('#theme-browser-profile').onclick = () => { $('#profile-dialog').close(); desktopControls?.openThemeBrowser(); };
$('#personalize').onclick = () => { $('#profile-dialog').close(); desktopControls?.openThemeSettings(); };
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
const themeSettingsButton = $('#theme-settings'); if (themeSettingsButton) themeSettingsButton.onclick = () => desktopControls?.openThemeSettings();
$('#theme-apply').onclick = async () => { try { $('#theme-error').textContent = ''; const result = await desktopControls.applyTheme($('#theme-list').value); refreshWindowTheme(result.revision); $('#theme-dialog').close(); } catch (error) { $('#theme-error').textContent = ''; showSystemDialog(error.message, 'error', t('themeApply')); } };
$('#theme-import').onclick = async () => { try { $('#theme-error').textContent = t('importingTheme'); const result = await desktopControls.importTheme(); if (!result) { $('#theme-error').textContent = ''; return; } await renderThemeList(); refreshWindowTheme(result.revision); $('#theme-error').textContent = t('themeInstalled'); } catch (error) { $('#theme-error').textContent = ''; showSystemDialog(error.message, 'error', t('themeImport')); } };
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
if (token) boot(); else showAuthScreen();
