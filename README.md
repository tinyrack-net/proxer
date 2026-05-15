<div align="center">

# Proxer

**Reverse-tunnel CLI for exposing local HTTP, SSE, and WebSocket services through a persistent client tunnel.**

[![CI](https://github.com/tinyrack-net/proxer/actions/workflows/pipeline.yml/badge.svg)](https://github.com/tinyrack-net/proxer/actions/workflows/pipeline.yml)
[![npm](https://img.shields.io/npm/v/@tinyrack/proxer)](https://www.npmjs.com/package/@tinyrack/proxer)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D24-brightgreen)](https://nodejs.org/)

[Quick Start](#quick-start) · [Examples](#examples) · [Packaging](#standalone-executables)

</div>

---

Proxer is an ngrok/Pinggy-style reverse tunnel for self-hosted development and private infrastructure.

Run one public Proxer server, then connect tunnel clients from private networks. Public HTTP requests, Server-Sent Events, and WebSocket upgrades are forwarded over a persistent client-initiated WebSocket control connection, so the local service does not need to accept inbound internet traffic.

## Features

- **Single-port server** for public traffic and tunnel control
- **HTTP streaming proxy** for regular and long-running responses
- **Server-Sent Events support** without buffering the response body
- **WebSocket upgrade proxy** for realtime applications
- **Client-initiated tunnels** that work from NATed or private networks
- **Subdomain/root-domain tunnel routing** for explicit public hosts
- **Standalone executables** built from the Node.js CLI

## Installation

### npm

Use npm on any platform, or as a cross-platform option.

```bash
npm install -g @tinyrack/proxer
```

### macOS / Linux

```bash
brew install tinyrack-net/tap/proxer
```

### GitHub Releases

Prebuilt standalone executables are published for Linux, macOS, and Windows from the [GitHub Releases](https://github.com/tinyrack-net/proxer/releases) page.

### Docker

The OCI image is published to Docker Hub (`tinyrack/proxer`) and GHCR (`ghcr.io/tinyrack-net/proxer`). Docker Hub is the shortest image name:

```bash
docker run --rm tinyrack/proxer --version
```

Run a public Proxer server in Docker and publish port 8080:

```bash
docker run --rm -p 8080:8080 tinyrack/proxer server --listen 0.0.0.0:8080 --domain your-server.example.com --token dev-token
```

On Linux, run the tunnel client with host networking when it needs to reach a service on the Docker host:

```bash
docker run --rm --network host tinyrack/proxer http 3000 --server ws://127.0.0.1:8080 --subdomain demo --token dev-token
```

On macOS and Windows Docker Desktop, use `host.docker.internal` instead of `127.0.0.1` when the container needs to reach a local service on the host.

Kubernetes liveness and readiness probes can use the built-in single-port health endpoints. These endpoints do not require a tunnel or token:

```yaml
livenessProbe:
  httpGet:
    path: /__proxer/health/live
    port: 8080
readinessProbe:
  httpGet:
    path: /__proxer/health/ready
    port: 8080
```

## Quick Start

Start the public Proxer server:

```bash
proxer server --listen 0.0.0.0:8080 --domain your-server.example.com --token dev-token
```

Start a local app on the client machine:

```bash
python3 -m http.server 3000 --bind 127.0.0.1
```

Connect a tunnel client for the root domain route:

```bash
proxer http 3000 \
  --server ws://your-server.example.com:8080 \
  --token dev-token
```

Then open the public listener with the configured root domain Host:

```bash
curl -H 'Host: your-server.example.com' http://your-server.example.com:8080/
```

Alternatively, connect a tunnel client for a specific subdomain:

```bash
proxer http 3000 \
  --server ws://your-server.example.com:8080 \
  --subdomain demo \
  --token dev-token
```

Then route by the matching subdomain Host:

```bash
curl -H 'Host: demo.your-server.example.com' http://your-server.example.com:8080/
```

Requests for unregistered subdomains return 404. Proxer does not route direct localhost/IP requests to a single connected client automatically.

## How It Works

Proxer uses one HTTP/WebSocket listener. Public traffic enters through that listener, while tunnel clients connect to a reserved control WebSocket path on the same port.

Default control path:

```text
/__proxer_control_7f3d9a2b__
```

You normally do not need to type this path on the client. Pass only the server base URL and Proxer appends the default control path internally.

```text
HTTP requests                                  -> public HTTP proxy
WebSocket upgrade /__proxer_control_7f3d9a2b__ -> tunnel control connection
WebSocket upgrade on any other path            -> public WebSocket proxy
```

TLS is not required for single-port mode:

```text
http://host:8080 + ws://host:8080 -> no TLS
https://host + wss://host         -> TLS
```

For a custom deployment, set the same control path on both server and client:

```bash
proxer server \
  --listen 127.0.0.1:8080 \
  --control-path /_proxer/control \
  --token dev-token

proxer http 3000 \
  --server ws://127.0.0.1:8080 \
  --control-path /_proxer/control \
  --subdomain demo \
  --token dev-token
```

## Examples

### HTTP

Start a local HTTP service:

```bash
python3 -m http.server 3000 --bind 127.0.0.1
```

Start the Proxer server in another terminal:

```bash
proxer server --listen 127.0.0.1:8080 --domain proxy.localhost --token dev-token
```

Start the tunnel client in a third terminal:

```bash
proxer http 3000 --server ws://127.0.0.1:8080 --subdomain demo --token dev-token
```

Call the public listener:

```bash
curl -H 'Host: demo.proxy.localhost' http://127.0.0.1:8080/
```

### Server-Sent Events

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

Run the same `proxer server` and `proxer http` commands from the HTTP example, then stream events through the tunnel:

```bash
curl -N -H 'Host: demo.proxy.localhost' http://127.0.0.1:8080/events
```

### WebSocket

Start a local WebSocket echo service on port 3000:

```bash
node --input-type=module <<'EOF'
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

Run the same `proxer server` and `proxer http` commands from the HTTP example, then connect through the public listener:

```bash
node --input-type=module <<'EOF'
import { WebSocket } from "ws";

const socket = new WebSocket("ws://127.0.0.1:8080/echo", {
  headers: { host: "demo.proxy.localhost" },
});

socket.on("open", () => socket.send("hello"));
socket.on("message", (data) => {
  console.log(data.toString());
  socket.close();
});
EOF
```

## Development

```bash
mise exec -- pnpm install
mise exec -- pnpm run build
mise exec -- pnpm run typecheck
mise exec -- pnpm run test
mise exec -- pnpm run format:check
```

Run the CLI from this repository:

```bash
mise exec -- pnpm --filter @tinyrack/proxer start --help
mise exec -- pnpm --filter @tinyrack/proxer start server --listen 127.0.0.1:8080 --token dev-token
mise exec -- pnpm --filter @tinyrack/proxer start http 3000 --server ws://127.0.0.1:8080 --subdomain demo --token dev-token
```

## Standalone Executables

Build and smoke-test the standalone executable:

```bash
mise exec -- pnpm run pkg:build
mise exec -- pnpm run pkg:smoke -- --skip-build
```

The default build writes `packages/cli/dist/pkg/proxer`. Release builds produce Linux, macOS, and Windows artifacts.

## License

[MIT](LICENSE)
