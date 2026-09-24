const $ = selector => document.querySelector(selector);
const controls = window.windowControls;
const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' })[char]);
let themeMetadata = [];
function refreshSchemes(selected) {
  const theme = themeMetadata.find(item => item.id === $('#theme-list').value);
  const schemes = theme?.schemes || [{ id: 'default', name: 'Default' }];
  $('#colour-scheme').innerHTML = schemes.map(scheme => `<option value="${esc(scheme.id)}">${esc(scheme.name)}</option>`).join('');
  if (selected && schemes.some(scheme => scheme.id === selected)) $('#colour-scheme').value = selected;
}
async function refreshThemes() {
  themeMetadata = await controls.listThemes();
  $('#theme-list').innerHTML = themeMetadata.map(theme => `<option value="${esc(theme.id)}">${esc(theme.name)}</option>`).join('');
  const active = localStorage.getItem('nk_active_theme');
  if (active && [...$('#theme-list').options].some(option => option.value === active)) $('#theme-list').value = active;
  refreshSchemes(localStorage.getItem('nk_active_scheme'));
}
function refreshFrame(theme) { if (theme?.cssUrl) document.querySelector('#frame-theme').href = theme.cssUrl; }
async function applySelection() {
  const result = await controls.applyTheme($('#theme-list').value, $('#colour-scheme').value);
  localStorage.setItem('nk_active_theme', result.id);
  localStorage.setItem('nk_active_scheme', result.scheme || '');
  refreshFrame(result);
}
async function previewSelection() { refreshFrame(await controls.previewTheme($('#theme-list').value, $('#colour-scheme').value)); }
$('#theme-list').onchange = async () => { try { refreshSchemes(); await previewSelection(); } catch (error) { $('#theme-error').textContent = error.message; } };
$('#colour-scheme').onchange = async () => { try { await previewSelection(); } catch (error) { $('#theme-error').textContent = error.message; } };
document.querySelectorAll('.property-tab').forEach(tab => tab.onclick = () => { document.querySelectorAll('.property-tab').forEach(item => item.classList.toggle('active', item === tab)); $('#themes-page').hidden = tab.dataset.page !== 'themes'; $('#appearance-page').hidden = tab.dataset.page !== 'appearance'; });
$('#close').onclick = () => controls.close(); $('#cancel').onclick = () => controls.close(); $('#ok').onclick = () => controls.close();
$('#apply').onclick = async () => { try { $('#theme-error').textContent = ''; await applySelection(); } catch (error) { $('#theme-error').textContent = error.message; } };
$('#theme-import').onclick = async () => { try { $('#theme-error').textContent = 'Importing theme…'; const result = await controls.importTheme(); if (!result) { $('#theme-error').textContent = ''; return; } localStorage.setItem('nk_active_theme', result.id); await refreshThemes(); refreshFrame(result); $('#theme-error').textContent = 'Theme added and applied.'; } catch (error) { $('#theme-error').textContent = error.message; } };
$('#effects').onclick = () => alert('Effects are supplied by the selected Windows XP theme.');
$('#advanced').onclick = () => alert('Advanced colour editing is available when the theme provides multiple colour schemes.');
controls.onThemeChanged(refreshFrame);
refreshThemes().then(() => controls.getActiveTheme()).then(refreshFrame).catch(error => { $('#theme-error').textContent = error.message; });
