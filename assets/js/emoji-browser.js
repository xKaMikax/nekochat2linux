const controls = window.windowControls;
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
const words = {
  ru: { title: 'Эмодзи NekoChat', search: 'Поиск emoji…', all: 'Все', found: 'Найдено', groups: 'Категории emoji', skinTone: 'Тон кожи:' },
  en: { title: 'NekoChat Emoji', search: 'Search emoji…', all: 'All', found: 'Found', groups: 'Emoji categories', skinTone: 'Skin tone:' }
};
const groupNames = {
  'Smileys & Emotion': ['Смайлы и эмоции', 'Smileys & Emotion'], 'People & Body': ['Люди и тело', 'People & Body'],
  'Animals & Nature': ['Животные и природа', 'Animals & Nature'], 'Food & Drink': ['Еда и напитки', 'Food & Drink'],
  'Travel & Places': ['Путешествия и места', 'Travel & Places'], Activities: ['Активность', 'Activities'],
  Objects: ['Объекты', 'Objects'], Symbols: ['Символы', 'Symbols'], Flags: ['Флаги', 'Flags']
};
const groupIcons = { 'Smileys & Emotion':'☺', 'People & Body':'☝', 'Animals & Nature':'♞', 'Food & Drink':'☕', 'Travel & Places':'⌂', Activities:'★', Objects:'⌘', Symbols:'♥', Flags:'⚑' };
const emojiItems = Array.isArray(window.NekoChatEmoji) ? window.NekoChatEmoji : [];
let language = 'ru'; let selectedGroup = 'all'; let selectedSkinTone = '';
const t = key => words[language][key];
const groupLabel = group => groupNames[group]?.[language === 'en' ? 1 : 0] || group;
function applyFrame(theme) { if (theme?.cssUrl) $('#frame-theme').href = theme.cssUrl; }
function render() {
  const query = $('#emoji-search').value.trim().toLocaleLowerCase();
  const groups = [...new Set(emojiItems.map(item => item.g).filter(group => groupNames[group]))];
  const items = emojiItems.filter(item => (selectedGroup === 'all' || item.g === selectedGroup) && !/skin tone/.test(item.n) && (!query || item.n.toLocaleLowerCase().includes(query)));
  const currentName = selectedGroup === 'all' ? t('all') : groupLabel(selectedGroup); $('#emoji-group-title').textContent = `${currentName} emoji`;
  $('#emoji-groups').innerHTML = `<button type="button" class="${selectedGroup === 'all' ? 'active' : ''}" data-group="all" title="${esc(t('all'))}" aria-label="${esc(t('all'))}"><b>☺</b></button>${groups.map(group => `<button type="button" class="${selectedGroup === group ? 'active' : ''}" data-group="${esc(group)}" title="${esc(groupLabel(group))}" aria-label="${esc(groupLabel(group))}"><b>${groupIcons[group]}</b></button>`).join('')}`;
  $('#emoji-count').textContent = `${t('found')}: ${items.length}`;
  $('#emoji-grid').innerHTML = items.map(item => `<button type="button" data-emoji="${esc(item.e)}" title="${esc(item.n)}" aria-label="${esc(item.n)}">${esc(item.e)}</button>`).join('');
}
function applyText() { document.documentElement.lang = language; document.title = t('title'); $('.xp-title').textContent = t('title'); $('#emoji-search').placeholder = t('search'); $('#emoji-groups').setAttribute('aria-label', t('groups')); $('#skin-tone-label').textContent = t('skinTone'); render(); }
$('#close').onclick = () => controls.close();
$('#emoji-search').oninput = render;
$('#emoji-groups').onclick = event => { const group = event.target.closest('[data-group]')?.dataset.group; if (group) { selectedGroup = group; render(); } };
document.querySelector('.skin-tone').onclick = event => { const button = event.target.closest('[data-skin-tone]'); if (!button) return; selectedSkinTone = button.dataset.skinTone; document.querySelectorAll('[data-skin-tone]').forEach(item => item.classList.toggle('active', item === button)); };
$('#emoji-grid').onclick = event => { const button = event.target.closest('[data-emoji]'); if (!button) return; const item = emojiItems.find(entry => entry.e === button.dataset.emoji); const toneName = ({ '🏻':'light', '🏼':'medium-light', '🏽':'medium', '🏾':'medium-dark', '🏿':'dark' })[selectedSkinTone]; const toned = toneName && item ? emojiItems.find(entry => entry.n === `${item.n}: ${toneName} skin tone`) : null; controls.selectEmoji(toned?.e || button.dataset.emoji); };
controls.onThemeChanged(applyFrame);
controls.onDisplayChanged(display => { language = display?.language === 'en' ? 'en' : 'ru'; applyText(); });
Promise.all([controls.getActiveTheme(), controls.getDisplaySettings()]).then(([theme, display]) => { applyFrame(theme); language = display?.language === 'en' ? 'en' : 'ru'; applyText(); });
