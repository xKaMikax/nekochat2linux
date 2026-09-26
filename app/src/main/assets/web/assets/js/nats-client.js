// Minimal NATS client over WebSocket (the NATS text protocol, like nats.ws does).
// Used by nekochat.js as the primary real-time transport: the server takes the same
// JSON messages on nkc.in.<uid> and delivers the user's events on nkc.out.<uid>.
(() => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const CRLF = encoder.encode('\r\n');

  function concat(first, second) {
    const joined = new Uint8Array(first.length + second.length);
    joined.set(first); joined.set(second, first.length);
    return joined;
  }
  function lineEnd(buffer) {
    for (let index = 0; index + 1 < buffer.length; index += 1) if (buffer[index] === 13 && buffer[index + 1] === 10) return index;
    return -1;
  }

  // Resolves once the server has accepted CONNECT + SUB (answered our PING).
  function connect({ url, user, pass, subscribe, onMessage, onClose, timeout = 8000 }) {
    return new Promise((resolve, reject) => {
      let buffer = new Uint8Array(0);
      let ready = false;
      let closed = false;
      const ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      const write = text => ws.send(encoder.encode(text));
      const connection = {
        publish(subject, text) {
          if (closed || ws.readyState !== WebSocket.OPEN) throw new Error('NATS connection is closed.');
          const payload = encoder.encode(text);
          ws.send(concat(concat(encoder.encode(`PUB ${subject} ${payload.length}\r\n`), payload), CRLF));
        },
        close() { finish(); },
      };
      const timer = setTimeout(() => finish(new Error('NATS connection timed out.')), timeout);
      function finish(error) {
        if (closed) return;
        closed = true; clearTimeout(timer);
        try { ws.close(); } catch {}
        if (!ready) reject(error || new Error('NATS connection closed.'));
        else onClose?.();
      }
      function handleLine(line) {
        const [op] = line.split(' ', 1);
        switch (op.toUpperCase()) {
          case 'INFO':
            write(`CONNECT ${JSON.stringify({ verbose: false, pedantic: false, user, pass, name: 'NekoChat Reloaded', lang: 'javascript', version: '1.0.0', protocol: 1, echo: false, headers: false, no_responders: false })}\r\n`);
            write(`SUB ${subscribe} 1\r\nPING\r\n`);
            break;
          case 'PING': write('PONG\r\n'); break;
          case 'PONG': if (!ready) { ready = true; clearTimeout(timer); resolve(connection); } break;
          case '-ERR': finish(new Error(`NATS: ${line.slice(5).replace(/^'|'$/g, '')}`)); break;
          default: break; // +OK
        }
      }
      ws.onmessage = event => {
        const chunk = typeof event.data === 'string' ? encoder.encode(event.data) : new Uint8Array(event.data);
        buffer = buffer.length ? concat(buffer, chunk) : chunk;
        for (;;) {
          const end = lineEnd(buffer);
          if (end < 0) return;
          const line = decoder.decode(buffer.subarray(0, end));
          if (/^MSG /i.test(line)) {
            // MSG <subject> <sid> [reply-to] <#bytes>
            const size = Number(line.split(' ').pop());
            if (buffer.length < end + 2 + size + 2) return;
            const payload = decoder.decode(buffer.subarray(end + 2, end + 2 + size));
            buffer = buffer.subarray(end + 2 + size + 2);
            if (ready) { try { onMessage?.(payload); } catch (error) { console.warn(error); } }
            continue;
          }
          buffer = buffer.subarray(end + 2);
          handleLine(line);
          if (closed) return;
        }
      };
      ws.onerror = () => finish(new Error('NATS WebSocket error.'));
      ws.onclose = () => finish(new Error('NATS WebSocket closed.'));
    });
  }

  window.NekoNats = { connect };
})();
