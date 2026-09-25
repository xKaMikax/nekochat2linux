const controls = window.windowControls;
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
let activeTheme;

function applyFrame(theme) { if (theme?.cssUrl) $('#frame-theme').href = theme.cssUrl; }
function switchTab(tab) {
  const installed = tab === 'installed';
  $('#installed-tab').classList.toggle('active', installed); $('#discovery-tab').classList.toggle('active', !installed);
  $('#installed-panel').hidden = !installed; $('#discovery-panel').hidden = installed;
}
function themeCard(theme, actionLabel, action) {
  const schemes = (theme.schemes || theme.colorSchemes || []).map(item => typeof item === 'string' ? item : item.name || item.id).filter(Boolean).join(', ') || 'Default';
  const preview = theme.previewUrl ? `<img class="theme-preview" src="${esc(theme.previewUrl)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'theme-preview placeholder',textContent:'Theme'}))">` : '<span class="theme-preview placeholder">Theme</span>';
  return `<article class="theme-card${theme.id === activeTheme?.id ? ' active' : ''}">${preview}<div class="theme-info"><h2>${esc(theme.name || theme.displayName || theme.id)}</h2><p>${esc(theme.type || 'Installed')}</p><p>${esc(schemes)}</p><button type="button" data-theme="${esc(theme.id)}">${esc(actionLabel)}</button></div></article>`;
}
async function showInstalled() {
  const list = $('#installed-list'); list.innerHTML = '<p class="browser-status">Загрузка установленных тем…</p>';
  try {
    activeTheme = await controls.getActiveTheme();
    const themes = await controls.listThemes();
    list.innerHTML = themes.length ? themes.map(theme => themeCard(theme, theme.id === activeTheme?.id ? 'Используется' : 'Применить', async button => {
      button.disabled = true; button.textContent = 'Применение…';
      try { activeTheme = await controls.applyTheme(theme.id); applyFrame(activeTheme); await showInstalled(); }
      catch (error) { button.disabled = false; button.textContent = error.message; }
    })).join('') : '<p class="empty-list">Тем пока нет.</p>';
    list.querySelectorAll('button[data-theme]').forEach(button => { const theme = themes.find(item => item.id === button.dataset.theme); if (theme?.id === activeTheme?.id) button.disabled = true; else button.onclick = () => { button.disabled = true; button.textContent = 'Применение…'; controls.applyTheme(theme.id).then(result => { activeTheme = result; applyFrame(result); return showInstalled(); }).catch(error => { button.disabled = false; button.textContent = error.message; }); }; });
  } catch (error) { list.innerHTML = `<p class="browser-status error">${esc(error.message)}</p>`; }
}
async function showDiscovery() {
  const status = $('#discovery-status'), list = $('#discovery-list'); list.innerHTML = '';
  try {
    const themes = (await controls.listCatalogThemes()).filter(theme => !['luna','classic'].includes(String(theme.id).toLowerCase()));
    status.textContent = themes.length ? `Найдено тем: ${themes.length}` : 'В каталоге пока нет доступных тем.'; status.classList.remove('error');
    list.innerHTML = themes.map(theme => themeCard(theme, 'Скачать и установить')).join('');
    list.querySelectorAll('button[data-theme]').forEach(button => button.onclick = async () => {
      button.disabled = true; button.textContent = 'Скачивание…';
      try { await controls.installCatalogTheme(button.dataset.theme); button.textContent = 'Установлено'; await showInstalled(); }
      catch (error) { button.disabled = false; button.textContent = error.message; }
    });
  } catch (error) { status.textContent = error.message; status.classList.add('error'); }
}
$('#installed-tab').onclick = () => switchTab('installed');
$('#discovery-tab').onclick = () => { switchTab('discovery'); showDiscovery(); };
$('#close').onclick = () => controls.close();
controls.onThemeChanged(theme => { activeTheme = theme; applyFrame(theme); showInstalled(); });
Promise.all([controls.getActiveTheme(), controls.getDisplaySettings()]).then(([theme, display]) => { activeTheme = theme; applyFrame(theme); document.documentElement.lang = display?.language || 'ru'; return showInstalled(); });
