const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const UPSTREAM = process.env.UPSTREAM_URL || 'wss://alfis-mac-mini.taila833af.ts.net:10000';

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', upstream: UPSTREAM }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (client, req) => {
  const forwardHeaders = {};
  for (const [key, val] of Object.entries(req.headers)) {
    if (['authorization', 'cookie', 'token', 'x-auth-token'].includes(key.toLowerCase()) || key.toLowerCase().startsWith('x-')) {
      forwardHeaders[key] = val;
    }
  }

  const upstream = new WebSocket(UPSTREAM, { headers: forwardHeaders, rejectUnauthorized: false });
  
  // Buffer messages from client until upstream is open
  const buffer = [];
  let upstreamReady = false;

  upstream.on('open', () => {
    console.log(`[relay] upstream connected for ${req.socket.remoteAddress}`);
    upstreamReady = true;
    // Flush buffered messages
    for (const { data, isBinary } of buffer) {
      upstream.send(data, { binary: isBinary });
    }
    buffer.length = 0;
  });

  upstream.on('message', (data, isBinary) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data, { binary: isBinary });
    }
  });

  upstream.on('close', (code, reason) => {
    if (client.readyState === WebSocket.OPEN) {
      client.close(code, reason);
    }
  });

  upstream.on('error', (err) => {
    console.error('[relay] upstream error:', err.message);
    if (client.readyState === WebSocket.OPEN) {
      client.close(1011, 'upstream error');
    }
  });

  client.on('message', (data, isBinary) => {
    if (upstreamReady && upstream.readyState === WebSocket.OPEN) {
      upstream.send(data, { binary: isBinary });
    } else {
      // Buffer until upstream is ready
      buffer.push({ data, isBinary });
    }
  });

  client.on('close', (code, reason) => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.close(code, reason);
    }
  });

  client.on('error', (err) => {
    console.error('[relay] client error:', err.message);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[relay] listening on ${HOST}:${PORT} → ${UPSTREAM}`);
});
