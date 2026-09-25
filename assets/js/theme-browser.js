const controls = window.windowControls;
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
const words = {
  ru: { title:'Каталог тем NekoChat', installed:'Установленные', discovery:'Каталог', installedIntro:'Темы, установленные на этом компьютере. Luna и Classic встроены в клиент.', discoveryIntro:'Темы из каталога NekoChat Reloaded Themes. Их можно скачать и установить.', loadingInstalled:'Загрузка установленных тем…', loadingCatalog:'Загрузка каталога…', noThemes:'Установленных тем пока нет.', noCatalog:'В каталоге пока нет доступных тем.', found:'Найдено тем: ', apply:'Применить', using:'Используется', applying:'Применение…', download:'Скачать и установить', downloading:'Скачивание…', installedDone:'Установлено', defaultScheme:'Стандартная', installedType:'Установлена' },
  en: { title:'NekoChat Theme Browser', installed:'Installed', discovery:'Discovery', installedIntro:'Themes installed on this computer. Luna and Classic are built into the client.', discoveryIntro:'Themes from the NekoChat Reloaded Themes catalog. Download and install them here.', loadingInstalled:'Loading installed themes…', loadingCatalog:'Loading catalog…', noThemes:'No installed themes yet.', noCatalog:'There are no available themes in the catalog yet.', found:'Themes found: ', apply:'Apply', using:'In use', applying:'Applying…', download:'Download and install', downloading:'Downloading…', installedDone:'Installed', defaultScheme:'Default', installedType:'Installed' }
};
let language = 'ru'; let activeTheme;
let selectedCatalogTheme;
const t = key => words[language][key];
function applyFrame(theme) { if (theme?.cssUrl) $('#frame-theme').href = theme.cssUrl; }
function applyText() { document.documentElement.lang = language; document.title = t('title'); $('.xp-title').textContent = t('title'); $('#installed-tab').textContent = t('installed'); $('#discovery-tab').textContent = t('discovery'); $('[data-panel="installed"]').textContent = t('installedIntro'); $('[data-panel="discovery"]').textContent = t('discoveryIntro'); }
function switchTab(tab) { const installed = tab === 'installed'; $('#installed-tab').classList.toggle('active', installed); $('#discovery-tab').classList.toggle('active', !installed); $('#installed-panel').hidden = !installed; $('#discovery-panel').hidden = installed; }
function themeCard(theme, label) { const schemes = (theme.schemes || theme.colorSchemes || []).map(item => typeof item === 'string' ? item : item.name || item.id).filter(Boolean).join(', ') || t('defaultScheme'); const preview = theme.previewUrl ? `<img class="theme-preview" src="${esc(theme.previewUrl)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'theme-preview placeholder',textContent:'Theme'}))">` : '<span class="theme-preview placeholder">Theme</span>'; return `<article class="theme-card${theme.id === activeTheme?.id ? ' active' : ''}">${preview}<div class="theme-info"><h2>${esc(theme.name || theme.displayName || theme.id)}</h2><p>${esc(theme.type || t('installedType'))}</p><p>${esc(schemes)}</p><button type="button" data-theme="${esc(theme.id)}">${esc(label)}</button></div></article>`; }
async function showInstalled() { const list = $('#installed-list'); list.innerHTML = `<p class="browser-status">${t('loadingInstalled')}</p>`; try { activeTheme = await controls.getActiveTheme(); const themes = await controls.listThemes(); list.innerHTML = themes.length ? themes.map(theme => themeCard(theme, theme.id === activeTheme?.id ? t('using') : t('apply'))).join('') : `<p class="empty-list">${t('noThemes')}</p>`; list.querySelectorAll('button[data-theme]').forEach(button => { const theme = themes.find(item => item.id === button.dataset.theme); if (theme?.id === activeTheme?.id) { button.disabled = true; return; } button.onclick = async () => { button.disabled = true; button.textContent = t('applying'); try { activeTheme = await controls.applyTheme(theme.id); applyFrame(activeTheme); await showInstalled(); } catch (error) { button.disabled = false; button.textContent = error.message; } }; }); } catch (error) { list.innerHTML = `<p class="browser-status error">${esc(error.message)}</p>`; } }
async function showDiscovery() { const status = $('#discovery-status'), list = $('#discovery-list'); status.textContent = t('loadingCatalog'); status.classList.remove('error'); list.innerHTML = ''; try { const themes = (await controls.listCatalogThemes()).filter(theme => !['luna','classic'].includes(String(theme.id).toLowerCase())); status.textContent = themes.length ? `${t('found')}${themes.length}` : t('noCatalog'); list.innerHTML = themes.map(theme => themeCard(theme, t('download'))).join(''); list.querySelectorAll('button[data-theme]').forEach(button => button.onclick = async () => { button.disabled = true; button.textContent = t('downloading'); try { await controls.installCatalogTheme(button.dataset.theme); button.textContent = t('installedDone'); await showInstalled(); } catch (error) { button.disabled = false; button.textContent = error.message; } }); } catch (error) { status.textContent = error.message; status.classList.add('error'); } }
$('#installed-tab').onclick = () => switchTab('installed'); $('#discovery-tab').onclick = () => { switchTab('discovery'); showDiscovery(); }; $('#close').onclick = () => controls.close(); controls.onThemeChanged(theme => { activeTheme = theme; applyFrame(theme); showInstalled(); }); controls.onDisplayChanged(display => { language = display?.language === 'en' ? 'en' : 'ru'; applyText(); showInstalled(); if (!$('#discovery-panel').hidden) showDiscovery(); }); Promise.all([controls.getActiveTheme(), controls.getDisplaySettings()]).then(([theme, display]) => { activeTheme = theme; language = display?.language === 'en' ? 'en' : 'ru'; applyFrame(theme); applyText(); return showInstalled(); });

function plainDescription(value) { return String(value || '').replace(/^#+\s*/gm, '').replace(/[*`_]/g, '').trim(); }
async function openCatalogDetails(id) {
  const details = await controls.getCatalogThemeDetails(id);
  selectedCatalogTheme = details;
  $('#detail-name').textContent = details.displayName || details.id;
  $('#detail-meta').textContent = `${details.type} • ${details.author} • ${details.version}`;
  $('#detail-preview').src = details.previewUrl; $('#detail-preview').alt = details.displayName || details.id;
  $('#detail-description').textContent = plainDescription(details.description) || (language === 'ru' ? 'Описание для этой темы пока не добавлено.' : 'No description has been added for this theme yet.');
  $('#detail-install').textContent = t('download'); $('#theme-details').hidden = false;
  $('#theme-details').scrollIntoView({ block: 'nearest' });
}
$('#discovery-list').addEventListener('click', event => {
  if (event.target.closest('button')) return;
  const card = event.target.closest('.theme-card'); const id = card?.querySelector('[data-theme]')?.dataset.theme;
  if (id) openCatalogDetails(id).catch(error => { $('#discovery-status').textContent = error.message; $('#discovery-status').classList.add('error'); });
});
$('#detail-back').onclick = () => { $('#theme-details').hidden = true; };
$('#detail-install').onclick = async () => {
  if (!selectedCatalogTheme) return;
  const button = $('#detail-install'); button.disabled = true; button.textContent = t('downloading');
  try { await controls.installCatalogTheme(selectedCatalogTheme.id); button.textContent = t('installedDone'); await showInstalled(); }
  catch (error) { button.disabled = false; button.textContent = error.message; }
};
