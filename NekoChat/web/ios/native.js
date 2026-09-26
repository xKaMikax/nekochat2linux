// window.NekoNative for iPhone: the same interface host.js uses on Android, implemented
// with WKScriptMessageHandlerWithReply (NativeBridge.swift). Replies arrive as promises.
(() => {
  const post = message => window.webkit.messageHandlers.neko.postMessage(message);
  window.NekoNative = {
    call(id, method, argsJson) {
      post({ method, args: JSON.parse(argsJson) })
        .then(payload => window.NKHost.resolveNative(id, true, payload ?? 'null'))
        .catch(error => window.NKHost.resolveNative(id, false, String(error?.message || error)));
    },
    notifyMessage(sender, content, avatarUrl) { post({ method: 'notify:message', args: [sender, content, avatarUrl] }).catch(() => {}); },
    notifyCall(title, status) { post({ method: 'notify:call', args: [title, status] }).catch(() => {}); },
    cancelCall() { post({ method: 'notify:cancel-call', args: [] }).catch(() => {}); },
    isForeground: () => document.visibilityState === 'visible',
    // iOS apps cannot send themselves to the background or quit.
    moveToBack() {},
    quit() {},
    stopScreenCapture() {},
  };
})();
