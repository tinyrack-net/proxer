<div align="center">

# Proxer

**Reverse-tunnel CLI for exposing local HTTP services through a persistent client tunnel.**

[![Node.js](https://img.shields.io/badge/node-%3E%3D24-brightgreen)](https://nodejs.org/)

</div>

---

Proxer runs a public HTTP listener plus a WebSocket tunnel control listener. A local client connects outbound to the control listener and forwards HTTP, SSE, and WebSocket traffic to a local service.

## Development

```bash
mise exec -- pnpm install
mise exec -- pnpm run build
mise exec -- pnpm run typecheck
mise exec -- pnpm run test
mise exec -- pnpm run format:check
```

## CLI

```bash
mise exec -- pnpm --filter @tinyrack/proxer start --help
mise exec -- pnpm --filter @tinyrack/proxer start --version
```

Available MVP commands:

```bash
proxer server --public 127.0.0.1:8080 --control 127.0.0.1:7000 --token dev-token
proxer http 3000 --server ws://127.0.0.1:7000 --name demo --token dev-token
```

When running from this repository, use `mise exec -- pnpm --filter @tinyrack/proxer start` in place of `proxer`.

## HTTP Demo

Start a local HTTP service:

```bash
python3 -m http.server 3000 --bind 127.0.0.1
```

Start the Proxer server in another terminal:

```bash
mise exec -- pnpm --filter @tinyrack/proxer start server --public 127.0.0.1:8080 --control 127.0.0.1:7000 --token dev-token
```

Start the tunnel client in a third terminal:

```bash
mise exec -- pnpm --filter @tinyrack/proxer start http 3000 --server ws://127.0.0.1:7000 --name demo --token dev-token
```

Call the public listener with a host that maps to the tunnel name:

```bash
curl -H 'Host: demo.localhost' http://127.0.0.1:8080/
```

## SSE Demo

Start a local SSE service on port 3000:

```bash
node --input-type=module <<'EOF'
import http from "node:http";

http
  .createServer((request, response) => {
    if (request.url !== "/events") {
      response.writeHead(404);
      response.end("Not found\n");
      return;
    }

    response.writeHead(200, {
      "cache-control": "no-cache",
      "content-type": "text/event-stream",
    });
    response.write("data: one\n\n");
    setTimeout(() => {
      response.write("data: two\n\n");
      response.end();
    }, 1000);
  })
  .listen(3000, "127.0.0.1", () => {
    console.log("SSE server listening on http://127.0.0.1:3000/events");
  });
EOF
```

Run the same `proxer server` and `proxer http` commands from the HTTP demo, then stream events through the tunnel:

```bash
curl -N -H 'Host: demo.localhost' http://127.0.0.1:8080/events
```

## WebSocket Demo

Start a local WebSocket echo service on port 3000:

```bash
mise exec -- pnpm --filter @tinyrack/proxer exec node --input-type=module <<'EOF'
import http from "node:http";
import { WebSocketServer } from "ws";

const server = http.createServer();
const wss = new WebSocketServer({ server });

wss.on("connection", (socket) => {
  socket.on("message", (data, isBinary) => {
    socket.send(data, { binary: isBinary });
  });
});

server.listen(3000, "127.0.0.1", () => {
  console.log("WebSocket echo listening on ws://127.0.0.1:3000");
});
EOF
```

Run the same `proxer server` and `proxer http` commands from the HTTP demo, then connect through the public listener:

```bash
mise exec -- pnpm --filter @tinyrack/proxer exec node --input-type=module <<'EOF'
import { WebSocket } from "ws";

const socket = new WebSocket("ws://127.0.0.1:8080/echo", {
  headers: { host: "demo.localhost" },
});

socket.on("open", () => socket.send("hello"));
socket.on("message", (data) => {
  console.log(data.toString());
  socket.close();
});
EOF
```

## SEA Packaging

Build and smoke-test the standalone executable:

```bash
mise exec -- pnpm run pkg:build
mise exec -- pnpm run pkg:smoke -- --skip-build
```
