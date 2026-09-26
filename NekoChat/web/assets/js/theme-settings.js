const $ = selector => document.querySelector(selector);
const controls = window.windowControls;
const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' })[char]);
let themeMetadata = [];
let previewTheme;
function refreshSchemes(selected) {
  const theme = themeMetadata.find(item => item.id === $('#theme-list').value);
  const schemes = theme?.schemes || [{ id: 'default', name: 'Default' }];
  $('#colour-scheme').innerHTML = schemes.map(scheme => `<option value="${esc(scheme.id)}">${esc(scheme.name)}</option>`).join('');
  if (selected && schemes.some(scheme => scheme.id === selected)) $('#colour-scheme').value = selected;
  $('#windows-style').innerHTML = `<option>${esc(theme?.name || 'Windows style')}</option>`;
}
async function refreshThemes() {
  themeMetadata = await controls.listThemes();
  $('#theme-list').innerHTML = themeMetadata.map(theme => `<option value="${esc(theme.id)}">${esc(theme.name)}</option>`).join('');
  const active = localStorage.getItem('nk_active_theme');
  if (active && [...$('#theme-list').options].some(option => option.value === active)) $('#theme-list').value = active;
  refreshSchemes(localStorage.getItem('nk_active_scheme'));
}
async function refreshMicDevices(selected) {
  try {
    let devices = await navigator.mediaDevices.enumerateDevices();
    if (devices.some(device => device.kind === 'audioinput' && !device.label)) {
      try { (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach(track => track.stop()); devices = await navigator.mediaDevices.enumerateDevices(); } catch {}
    }
    const mics = devices.filter(device => device.kind === 'audioinput');
    $('#mic-device').innerHTML = '<option value="">Default</option>' + mics.map((device, index) => `<option value="${esc(device.deviceId)}">${esc(device.label || `Microphone ${index + 1}`)}</option>`).join('');
    if (selected && mics.some(device => device.deviceId === selected)) $('#mic-device').value = selected;
  } catch (error) { $('#mic-device').innerHTML = '<option value="">Default</option>'; }
}
function refreshFrame(theme) { if (theme?.cssUrl) document.querySelector('#frame-theme').href = theme.cssUrl; }
function refreshPreview(theme) { previewTheme = theme; document.querySelectorAll('iframe[src="assets/html/theme_preview.html"]').forEach(frame => frame.contentWindow?.postMessage({ type: 'theme-preview', theme }, '*')); }
document.querySelectorAll('iframe[src="assets/html/theme_preview.html"]').forEach(frame => frame.addEventListener('load', () => { if (previewTheme) frame.contentWindow.postMessage({ type: 'theme-preview', theme: previewTheme }, '*'); }));
async function applySelection() {
  const result = await controls.applyTheme($('#theme-list').value, $('#colour-scheme').value);
  await controls.applyDisplaySettings({ language: $('#display-language').value, loginUi: $('#login-ui').value, micDeviceId: $('#mic-device').value });
  localStorage.setItem('nk_active_theme', result.id);
  localStorage.setItem('nk_active_scheme', result.scheme || '');
  refreshFrame(result);
}
async function previewSelection() { refreshPreview(await controls.previewTheme($('#theme-list').value, $('#colour-scheme').value)); }
$('#theme-list').onchange = async () => { try { refreshSchemes(); await previewSelection(); } catch (error) { $('#theme-error').textContent = error.message; } };
$('#colour-scheme').onchange = async () => { try { await previewSelection(); } catch (error) { $('#theme-error').textContent = error.message; } };
document.querySelectorAll('.property-tab').forEach(tab => tab.onclick = () => { document.querySelectorAll('.property-tab').forEach(item => item.classList.toggle('active', item === tab)); $('#themes-page').hidden = tab.dataset.page !== 'themes'; $('#appearance-page').hidden = tab.dataset.page !== 'appearance'; $('#display-page').hidden = tab.dataset.page !== 'display'; });
$('#close').onclick = () => controls.close(); $('#cancel').onclick = () => controls.close(); $('#ok').onclick = () => controls.close();
$('#apply').onclick = async () => { try { $('#theme-error').textContent = ''; await applySelection(); } catch (error) { $('#theme-error').textContent = error.message; } };
$('#theme-import').onclick = async () => { try { $('#theme-error').textContent = 'Importing theme…'; const result = await controls.importTheme(); if (!result) { $('#theme-error').textContent = ''; return; } themeMetadata = result.themes; $('#theme-list').innerHTML = themeMetadata.map(theme => `<option value="${esc(theme.id)}">${esc(theme.name)}</option>`).join(''); $('#theme-list').value = result.id; refreshSchemes(result.scheme); await previewSelection(); $('#theme-error').textContent = 'Theme added. Click Apply to use it.'; } catch (error) { $('#theme-error').textContent = error.message; } };
$('#effects').onclick = () => alert('Effects are supplied by the selected Windows XP theme.');
$('#advanced').onclick = () => alert('Advanced colour editing is available when the theme provides multiple colour schemes.');
controls.onThemeChanged(theme => { refreshFrame(theme); refreshPreview(theme); });
Promise.all([refreshThemes(), controls.getActiveTheme(), controls.getDisplaySettings()]).then(([, theme, settings]) => { $('#display-language').value = settings.language || 'ru'; $('#login-ui').value = settings.loginUi || 'xp'; refreshMicDevices(settings.micDeviceId); refreshFrame(theme); refreshPreview(theme); }).catch(error => { $('#theme-error').textContent = error.message; });
