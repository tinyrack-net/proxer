<div align="center">

# Proxer

**A small reverse-tunnel CLI for putting a private HTTP service behind a public URL you control.**

[![CI](https://github.com/tinyrack-net/proxer/actions/workflows/pipeline.yml/badge.svg)](https://github.com/tinyrack-net/proxer/actions/workflows/pipeline.yml)
[![GitHub Release](https://img.shields.io/github/v/release/tinyrack-net/proxer)](https://github.com/tinyrack-net/proxer/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Dart](https://img.shields.io/badge/dart-%3E%3D3.12-blue)](https://dart.dev/)

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
brew install tinyrack-net/tap/proxer
```

On Windows, install with WinGet:

```powershell
winget install tinyrack.proxer
```

Prebuilt Linux, macOS, and Windows executables are also published on the [GitHub Releases](https://github.com/tinyrack-net/proxer/releases) page.

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

Register a tunnel. By default, the server assigns a random subdomain and the client keeps using that assigned name while it reconnects during this run:

```bash
proxer http 3000 \
  --server wss://your-server.example.com \
  --token dev-token
```

Example output:

```text
subdomain: px-k7m3q9t2ab
public: https://px-k7m3q9t2ab.your-server.example.com
```

Requests for that assigned host go to the client:

```bash
curl https://px-k7m3q9t2ab.your-server.example.com/
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

Use cluster mode when multiple clients should share one named route:

```bash
proxer http 3000 \
  --server wss://your-server.example.com \
  --subdomain demo \
  --mode cluster \
  --token dev-token
```

All clients for a route must use the same mode. Cluster routes distribute HTTP requests round-robin and choose one tunnel when a WebSocket, SSE, or other long-lived stream opens.

Request the root-domain route only when you intend to occupy the root host:

```bash
proxer http 3000 \
  --server wss://your-server.example.com \
  --subdomain @ \
  --token dev-token
```

Then requests for `https://your-server.example.com/` go to that client. Root routing is intended for servers started with `--domain`; without a configured domain, Proxer derives routes from the first host label, so `--subdomain @` usually will not match the host you expect.

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
| `--subdomain <subdomain>` | `PROXER_SUBDOMAIN` | auto-assigned random subdomain |
| `--mode <single\|cluster>` | `PROXER_MODE` | `single` |
| `--token <token>` | `PROXER_TOKEN` | required |
| `--basic-auth-password <password>` | `PROXER_BASIC_AUTH_PASSWORD` | unset |
| `--basic-auth-username <username>` | `PROXER_BASIC_AUTH_USERNAME` | unset |

The local port is positional and has no environment variable.

Omitting `--subdomain` and `PROXER_SUBDOMAIN` asks the server to assign a random subdomain such as `px-k7m3q9t2ab`. Use `--subdomain demo` or `PROXER_SUBDOMAIN=demo` for a chosen stable name. Use `--subdomain @` or `PROXER_SUBDOMAIN=@` only when you intentionally want root-domain routing on a server configured with `--domain`. Basic Auth can be combined with any route mode, including auto-assigned subdomains.

`--basic-auth-password` protects public HTTP, SSE, and WebSocket access to that tunnel. If `--basic-auth-username` is omitted, any Basic Auth username is accepted and only the password is checked. If a username is set, both username and password must match. These credentials protect public access to the proxied site; `--token` or `PROXER_TOKEN` is still required for tunnel registration.

Prefer environment variables or secret stores for real deployments. Passing `--basic-auth-password` directly can leak through shell history or process listings, and Basic Auth credentials are sent in request headers, so use HTTPS/WSS in front of Proxer.

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
HTTP request for px-k7m3q9t2ab.proxy.example.com
  -> public Proxer server
  -> matching tunnel registered with the assigned subdomain
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

Call the named demo route with the matching host:

```bash
curl -H 'Host: demo.proxy.localhost' http://127.0.0.1:8080/
```

Omit `--subdomain` to let Proxer assign one:

```bash
proxer http 3000 --server ws://127.0.0.1:8080 --token dev-token
```

The client prints the assigned public URL:

```text
subdomain: px-k7m3q9t2ab
public: http://px-k7m3q9t2ab.proxy.localhost:8080
```

Call it with the host Proxer expects:

```bash
curl -H 'Host: px-k7m3q9t2ab.proxy.localhost' http://127.0.0.1:8080/
```

Protect public access to a tunnel with Basic Auth:

```bash
PROXER_BASIC_AUTH_PASSWORD='secret' \
  proxer http 3000 --server ws://127.0.0.1:8080 --token dev-token
```

Require a username and password:

```bash
PROXER_BASIC_AUTH_USERNAME='admin' \
PROXER_BASIC_AUTH_PASSWORD='secret' \
  proxer http 3000 --server ws://127.0.0.1:8080 --subdomain demo --token dev-token
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
dart pub get
dart run tool/validate.dart
```

Run the CLI from this repository:

```bash
dart run bin/proxer.dart --help
dart run bin/proxer.dart server --listen 127.0.0.1:8080 --token dev-token
dart run bin/proxer.dart http 3000 --server ws://127.0.0.1:8080 --subdomain demo --token dev-token
```

## Standalone Executables

Build and smoke-test the standalone executable:

```bash
dart compile exe bin/proxer.dart -o proxer
dart run tool/smoke.dart --executable-path proxer
```

Release builds compile native Linux, macOS, and Windows artifacts on their target operating systems.

## License

[MIT](LICENSE)
