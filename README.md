<div align="center">

# Proxer

**A small reverse-tunnel CLI for putting a private HTTP service behind a public URL you control.**

[![CI](https://github.com/tinyrack-net/proxer/actions/workflows/pipeline.yml/badge.svg)](https://github.com/tinyrack-net/proxer/actions/workflows/pipeline.yml)
[![npm](https://img.shields.io/npm/v/@tinyrack/proxer)](https://www.npmjs.com/package/@tinyrack/proxer)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D24-brightgreen)](https://nodejs.org/)

[Quick Start](#quick-start) · [Examples](#examples) · [Packaging](#standalone-executables)

</div>

---

Proxer is for the familiar problem where a service is running on a laptop, mini PC, NAS, or office box, and you need a stable public URL without opening inbound ports back into that private network. You run one public Proxer server, then each private machine dials out to it with a WebSocket tunnel. Incoming HTTP, Server-Sent Events, and WebSocket traffic is routed back through that client-initiated connection.

## Use this when

- You run small services behind NAT or a firewall and want a public host name for them.
- You want the tunnel server inside your own VPS, homelab edge, or business infrastructure.
- You need HTTP streaming, SSE, or WebSocket upgrades to pass through the tunnel.
- You prefer explicit host routing: `proxy.example.com` for the root route, `demo.proxy.example.com` for a named route.

## Do not use this when

- You need a fully managed tunnel provider with account dashboards, access policies, and global edge locations.
- You need raw TCP or UDP forwarding. Proxer is HTTP/WebSocket oriented.
- You cannot run a public server or reverse proxy that preserves the original `Host` header.
- You want Proxer to guess where traffic should go. Unknown hosts return `404`.

## Installation

```bash
npm install -g @tinyrack/proxer
```

```bash
brew install tinyrack-net/tap/proxer
```

Prebuilt Linux, macOS, and Windows executables are published on the [GitHub Releases](https://github.com/tinyrack-net/proxer/releases) page.

The OCI image is published to Docker Hub (`tinyrack/proxer`) and GHCR (`ghcr.io/tinyrack-net/proxer`):

```bash
docker run --rm tinyrack/proxer --version
```

## Quick Start

These commands assume `your-server.example.com` reaches the public Proxer server. In production, put TLS in front with Caddy, Traefik, NGINX, or a load balancer, then point clients at the public `wss://` URL.

Start the public server:

```bash
proxer server --listen 0.0.0.0:8080 --domain your-server.example.com --token dev-token
```

Start something local on the client machine:

```bash
python3 -m http.server 3000 --bind 127.0.0.1
```

Register the root-domain route:

```bash
proxer http 3000 \
  --server wss://your-server.example.com \
  --token dev-token
```

Requests for the root host go to that client:

```bash
curl https://your-server.example.com/
```

Register a named subdomain route instead:

```bash
proxer http 3000 \
  --server wss://your-server.example.com \
  --subdomain demo \
  --token dev-token
```

Then request the matching host:

```bash
curl https://demo.your-server.example.com/
```

`dev-token` is only a demo value. For a real deployment, set a long random token with `PROXER_TOKEN`, a container secret, a Kubernetes secret, or your platform's secret manager. CLI arguments can land in shell history and process lists.

## Docker

Run the public server in a container:

```bash
docker run --rm -p 8080:8080 tinyrack/proxer server --listen 0.0.0.0:8080 --domain proxy.example.com --token dev-token
```

For real deployments, keep the token out of shell history where possible:

```bash
docker run --rm -p 8080:8080 \
  -e PROXER_TOKEN="$PROXER_TOKEN" \
  tinyrack/proxer \
  server --listen 0.0.0.0:8080 --domain proxy.example.com
```

The server keeps tunnel registrations in memory. If the container restarts, clients reconnect and register again.

For a tunnel client in Docker, remember that Proxer forwards to `127.0.0.1:<port>` from inside the client process. On Linux, `--network host` is the usual way to let a client container reach a service on the Docker host:

```bash
docker run --rm --network host \
  -e PROXER_TOKEN="$PROXER_TOKEN" \
  tinyrack/proxer \
  http 3000 --server ws://127.0.0.1:8080 --subdomain demo
```

On Docker Desktop, run the client on the host or in the same container/network namespace as the app. There is not currently a client flag for forwarding to `host.docker.internal`.

Kubernetes probes can use the built-in health endpoints:

```yaml
livenessProbe:
  httpGet:
    path: /__proxer__/health/live
    port: 8080
readinessProbe:
  httpGet:
    path: /__proxer__/health/ready
    port: 8080
```

## Configuration

CLI flags win over `PROXER_` environment variables. Built-in defaults are used last.

`proxer server`:

| CLI flag | Environment variable | Default |
| --- | --- | --- |
| `--listen <host:port>` | `PROXER_LISTEN` | `127.0.0.1:8080` |
| `--domain <domain>` | `PROXER_DOMAIN` | unset |
| `--token <token>` | `PROXER_TOKEN` | generated at startup |
| `--trusted-proxy <proxy>` | `PROXER_TRUSTED_PROXIES` | unset |

If the server token is omitted, Proxer prints the generated token as `token: ...`. Copy that value to clients. `proxer http` always needs `--token` or `PROXER_TOKEN`.

`proxer http <port>`:

| CLI flag | Environment variable | Default |
| --- | --- | --- |
| `--server <url>` | `PROXER_SERVER` | `ws://127.0.0.1:8080` |
| `--subdomain <subdomain>` | `PROXER_SUBDOMAIN` | unset |
| `--token <token>` | `PROXER_TOKEN` | required |

The local port is positional and has no environment variable.

`--trusted-proxy` is repeatable:

```bash
proxer server \
  --listen 0.0.0.0:8080 \
  --domain proxy.example.com \
  --trusted-proxy loopback \
  --trusted-proxy private \
  --token "$PROXER_TOKEN"
```

`PROXER_TRUSTED_PROXIES` is comma-separated:

```bash
PROXER_LISTEN=0.0.0.0:8080 \
PROXER_DOMAIN=proxy.example.com \
PROXER_TRUSTED_PROXIES=loopback,private,10.42.0.0/16 \
PROXER_TOKEN="$PROXER_TOKEN" \
proxer server
```

Supported trusted proxy values are `loopback`, `private`, IP literals, and CIDR ranges. Only trust proxies you control. A trusted reverse proxy must overwrite or strip inbound `X-Forwarded-*` and `X-Real-IP` headers before forwarding to Proxer, because Proxer trusts those headers from configured TCP peers.

## Request Flow

Proxer uses one HTTP/WebSocket listener. Public traffic, health probes, and tunnel control all arrive on the same port.

Reserved paths:

```text
/__proxer__/control
/__proxer__/health/live
/__proxer__/health/ready
```

Clients should pass only the server base URL, such as `wss://proxy.example.com`; Proxer appends `/__proxer__/control` internally. Paths under `/__proxer__/` are never proxied to your app.

```text
HTTP request for demo.proxy.example.com
  -> public Proxer server
  -> matching tunnel registered as --subdomain demo
  -> client forwards to 127.0.0.1:<port>
  -> response returns over the same tunnel stream
```

WebSocket upgrades follow the same host-routing rule, then become bidirectional tunnel streams. SSE and other streaming responses are forwarded in chunks.

## Examples

### HTTP

Terminal 1:

```bash
python3 -m http.server 3000 --bind 127.0.0.1
```

Terminal 2:

```bash
proxer server --listen 127.0.0.1:8080 --domain proxy.localhost --token dev-token
```

Terminal 3:

```bash
proxer http 3000 --server ws://127.0.0.1:8080 --subdomain demo --token dev-token
```

Call it with the host Proxer expects:

```bash
curl -H 'Host: demo.proxy.localhost' http://127.0.0.1:8080/
```

### Server-Sent Events

Start a small SSE app:

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

Run the same server and client commands from the HTTP example, then stream events:

```bash
curl -N -H 'Host: demo.proxy.localhost' http://127.0.0.1:8080/events
```

### WebSocket

Start a WebSocket echo app:

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

Run the same server and client commands from the HTTP example, then connect through Proxer:

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

## Agent Skill

For coding agents that read local skill files, Proxer can write a short `proxer.md` reference:

```bash
proxer skill install ~/.hermes/skills/proxer
proxer skill install ~/.hermes/skills/proxer --dry-run
proxer skill install ~/.hermes/skills/proxer --force
```

The command writes `<directory>/proxer.md`. It does not contact a network service.

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
