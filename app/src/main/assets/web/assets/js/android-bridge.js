// Android: stands in for preload.js. The host page (android/host.js) owns the windows,
// so every page takes its window.windowControls from there.
(() => {
  let host;
  try { host = window.top.NKHost; } catch {}
  if (!host || window === window.top) return;
  window.windowControls = host.controlsFor(window);
  document.documentElement.classList.add('android');

  // Touching a window brings it to the front, like clicking it on the PC.
  window.addEventListener('pointerdown', () => host.focusFrom(window), true);

  // -webkit-app-region: drag does not exist in a WebView: move the window by its title bar.
  document.addEventListener('pointerdown', event => {
    const bar = event.target.closest?.('.xp-titlebar');
    if (!bar || event.target.closest('button, input, select, textarea, a')) return;
    let lastX = event.screenX; let lastY = event.screenY;
    bar.setPointerCapture(event.pointerId);
    const move = moveEvent => { host.moveBy(window, moveEvent.screenX - lastX, moveEvent.screenY - lastY); lastX = moveEvent.screenX; lastY = moveEvent.screenY; };
    const stop = () => { bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', stop); bar.removeEventListener('pointercancel', stop); };
    bar.addEventListener('pointermove', move); bar.addEventListener('pointerup', stop); bar.addEventListener('pointercancel', stop);
  });

  // WebView has no getDisplayMedia(): the screen comes from MediaProjection as JPEG frames,
  // drawn into a canvas whose stream behaves like a display-capture track for nekochat.js.
  if (navigator.mediaDevices && !navigator.mediaDevices.getDisplayMedia) {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const size = await host.startScreenCapture();
      const canvas = document.createElement('canvas');
      canvas.width = size.width; canvas.height = size.height;
      const context = canvas.getContext('2d');
      const stream = canvas.captureStream(15);
      const track = stream.getVideoTracks()[0];
      let running = true;
      const baseSettings = track.getSettings();
      track.getSettings = () => ({ ...baseSettings, width: canvas.width, height: canvas.height, displaySurface: 'monitor' });
      const stopTrack = track.stop.bind(track);
      track.stop = () => { if (!running) return; running = false; stopTrack(); host.stopScreenCapture(); };
      host.onScreenCaptureEnded(() => { if (!running) return; running = false; stopTrack(); track.dispatchEvent(new Event('ended')); });
      (async () => {
        let lastFrame = '';
        while (running) {
          try {
            const response = await fetch(`/android-screen/frame.jpg?${Date.now()}`, { cache: 'no-store' });
            const frame = response.headers.get('X-Frame') || '';
            if (response.ok && frame !== lastFrame) {
              lastFrame = frame;
              const image = await createImageBitmap(await response.blob());
              context.drawImage(image, 0, 0, canvas.width, canvas.height);
              image.close();
            }
          } catch {}
          await new Promise(resolve => setTimeout(resolve, 70));
        }
      })();
      return stream;
    };
  }

  // Android back button: close the page's open dialog first.
  host.registerBack(window, () => {
    const dialog = [...document.querySelectorAll('dialog[open]')].pop();
    if (dialog) { dialog.close(); return true; }
    if (document.documentElement.classList.contains('chat-open') && matchMedia('(max-width: 640px)').matches) { document.querySelector('.tab.active')?.click(); return true; }
    return false;
  });

  // Narrow screens show either the chat list or the open chat (see android.css).
  document.addEventListener('DOMContentLoaded', () => {
    const header = document.querySelector('#conversation-header');
    if (!header) return;
    const update = () => {
      const open = header.childElementCount > 0;
      document.documentElement.classList.toggle('chat-open', open);
      if (open && !header.querySelector('.android-back')) {
        const button = document.createElement('button');
        // .xp-button gets the theme's real BUTTON_BMP 9-slice (theme-controls.css).
        button.type = 'button'; button.className = 'xp-button android-back'; button.setAttribute('aria-label', 'Назад');
        button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>';
        button.addEventListener('click', event => { event.stopPropagation(); document.querySelector('.tab.active')?.click(); });
        header.prepend(button);
      }
    };
    new MutationObserver(update).observe(header, { childList: true });
    update();
  });
})();
