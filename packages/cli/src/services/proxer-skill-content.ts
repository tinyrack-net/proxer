export const PROXER_SKILL_CONTENT = `# Proxer

Use this skill when an AI agent needs to run, explain, debug, or generate commands for Proxer reverse-tunnel workflows.

Proxer is a self-hosted reverse-tunnel CLI for exposing local HTTP, Server-Sent Events, and WebSocket services through a public server you control. Run one public Proxer server, then connect tunnel clients from private networks. Each client opens a persistent WebSocket control connection, so the local service does not need inbound internet access.

## When to Use Proxer

- Expose a local development service through a stable public hostname.
- Reach HTTP, SSE, or WebSocket services running behind NAT, firewalls, or private networks.
- Keep the tunnel control plane in infrastructure the user controls instead of a hosted tunnel provider.
- Give an AI agent a copy-pasteable local or self-hosted tunnel workflow.

Do not assume Proxer guesses routes. Public requests are routed by Host header to either a root-domain tunnel or a single-label subdomain tunnel.

## Installation and Distribution

- npm package: \`@tinyrack/proxer\`
- npm install: \`npm install -g @tinyrack/proxer\`
- Homebrew: \`brew install tinyrack-net/tap/proxer\`
- GitHub Releases: prebuilt standalone executables for Linux, macOS, and Windows are published at \`https://github.com/tinyrack-net/proxer/releases\`.
- Docker Hub: \`tinyrack/proxer\`; GHCR: \`ghcr.io/tinyrack-net/proxer\`.

Useful basics:

\`\`\`bash
proxer --help
proxer --version
proxer server --help
proxer http --help
proxer skill install --help
\`\`\`

## Command Reference

### \`proxer server\`

Starts one HTTP/WebSocket listener for public traffic, health probes, and tunnel control.

Default listen address: \`127.0.0.1:8080\`.

Options:

- \`--listen <host:port>\`: bind address for the single listener.
- \`--domain <domain>\`: public root domain used for root and subdomain routing.
- \`--token <token>\`: shared token required by tunnel clients.
- \`--trusted-proxy <proxy>\`: trusted reverse proxy preset, IP, or CIDR. Repeat the flag for multiple values.

Environment variables:

- \`PROXER_LISTEN\`: default value for \`--listen\`.
- \`PROXER_DOMAIN\`: default value for \`--domain\`.
- \`PROXER_TOKEN\`: default value for \`--token\`.
- \`PROXER_TRUSTED_PROXIES\`: comma-separated trusted proxy values.

CLI flags take precedence over environment variables.

Token behavior:

If \`--token\` and \`PROXER_TOKEN\` are omitted, the server auto-generates a strong token and prints it as \`token: ...\`. Copy that printed token to clients. For real deployments, prefer \`PROXER_TOKEN\`, Docker/Kubernetes secrets, or another secret store over putting long-lived tokens in shell history or process lists.

### \`proxer http <port>\`

Connects a client-initiated tunnel to a Proxer server and forwards public HTTP, Server-Sent Events, and WebSocket traffic to \`127.0.0.1:<port>\` on the client machine.

Default server URL: \`ws://127.0.0.1:8080\`.

Options:

- \`<port>\`: local HTTP port to expose. It is positional and has no environment variable.
- \`--server <url>\`: Proxer server base URL. Accepted schemes are \`ws://\`, \`wss://\`, \`http://\`, and \`https://\`; HTTP schemes are converted to WebSocket schemes internally. Do not include a path, query, or fragment.
- \`--subdomain <subdomain>\`: register a chosen subdomain route. Omit it to let the server assign a random subdomain. Use \`--subdomain @\` only when you intentionally want root-domain routing on a server configured with \`--domain\`.
- \`--token <token>\`: shared token matching the server.

Environment variables:

- \`PROXER_SERVER\`: default value for \`--server\`.
- \`PROXER_SUBDOMAIN\`: default value for \`--subdomain\`.
- \`PROXER_TOKEN\`: default value for \`--token\`.

Since v0.8, \`proxer http\` requires a client token; without \`--token\` or \`PROXER_TOKEN\`, it fails with \`token is required\`.

Subdomain rules:

- Proxer lowercases subdomain input.
- A subdomain must be one DNS label: lowercase letters, numbers, and hyphens only.
- It cannot start or end with a hyphen.
- It cannot contain dots or underscores.
- Maximum length is 63 characters.

### \`proxer skill install <directory>\`

Installs this agent skill markdown file.

\`\`\`bash
proxer skill install <directory>
proxer skill install <directory> --dry-run
proxer skill install <directory> --force
\`\`\`

Behavior:

- Writes \`<directory>/proxer.md\`.
- \`--dry-run\` prints the target path without creating a directory or file.
- \`--force\` overwrites an existing \`proxer.md\`.
- The command has no network side effects and no environment variables.

## Routing Model

Proxer routes public requests by Host header.

With \`proxer server --domain proxy.example.com\`:

- A client without \`--subdomain\` gets a server-assigned random subdomain such as \`px-k7m3q9t2ab\`. The client keeps using that assigned subdomain across reconnects during the same run.
- A client with \`--subdomain @\` registers the root route. Requests for \`proxy.example.com\` go to that client. Root routing is intended for servers started with \`--domain\`; without one, Proxer derives routes from the first host label.
- A client with \`--subdomain demo\` registers \`demo.proxy.example.com\`. Requests for that host go to that client.
- Requests for unregistered subdomains return 404.
- Direct \`localhost\` or IP-based Host requests are not automatically routed to a connected client.

Without \`--domain\`, Proxer derives a subdomain route from the first label of the request Host. Prefer setting \`--domain\` for predictable public deployments.

404 meanings:

- \`No tunnel route matched host ...\`: the Host header did not match the configured domain/subdomain routing rules.
- \`No tunnel registered for root domain\` or \`No tunnel registered for subdomain ...\`: the Host matched a route, but no client is currently registered for it.

## Internal Paths

These fixed paths are reserved by the single-port server and are not proxied to applications:

- \`/__proxer__/control\`: WebSocket tunnel control endpoint.
- \`/__proxer__/health/live\`: liveness probe.
- \`/__proxer__/health/ready\`: readiness probe.

Kubernetes liveness/readiness probes: \`/__proxer__/health/live\` and \`/__proxer__/health/ready\`.

There is no configurable control path; do not invent or pass \`--control-path\`.

Clients should pass only the server base URL, such as \`wss://proxy.example.com\`. Proxer appends \`/__proxer__/control\` internally.

## TLS and Reverse Proxies

Proxer itself listens with HTTP/WebSocket. For public deployments, put Proxer behind TLS and use \`wss://\`/\`https://\` externally. Terminate TLS with Caddy, Traefik, NGINX, a load balancer, or another reverse proxy, then forward HTTP/WebSocket traffic to Proxer over loopback or a private network.

Server command shape behind a reverse proxy:

\`\`\`bash
PROXER_LISTEN=0.0.0.0:8080 \\
PROXER_DOMAIN=proxy.example.com \\
PROXER_TRUSTED_PROXIES=loopback,private \\
PROXER_TOKEN="$PROXER_TOKEN" \\
proxer server
\`\`\`

Client command shape through the public TLS endpoint:

\`\`\`bash
PROXER_SERVER=wss://proxy.example.com \\
PROXER_TOKEN="$PROXER_TOKEN" \\
proxer http 3000
\`\`\`

Trusted proxy behavior:

- \`--trusted-proxy <proxy>\` is repeatable; \`PROXER_TRUSTED_PROXIES\` is comma-separated.
- Supported values are \`loopback\`, \`private\`, IP literals, and CIDR ranges such as \`10.42.0.0/16\`.
- \`loopback\` trusts loopback addresses.
- \`private\` trusts private IPv4 ranges and unique-local IPv6 ranges.
- Only trust proxies you control.
- Without trusted proxies, Proxer ignores forwarded host/protocol/client-IP headers for routing decisions.
- When a proxy is trusted, it may supply \`X-Forwarded-For\`, \`X-Real-IP\`, \`X-Forwarded-Host\`, and \`X-Forwarded-Proto\`. The proxy must overwrite or strip inbound \`X-Forwarded-*\` and \`X-Real-IP\` headers from external clients before forwarding to Proxer.

## Copy-Paste Examples

### Local Loopback Demo

Use a demo token only for local testing.

Terminal 1:

\`\`\`bash
python3 -m http.server 3000 --bind 127.0.0.1
\`\`\`

Terminal 2:

\`\`\`bash
proxer server --listen 127.0.0.1:8080 --domain proxy.localhost --token dev-token
\`\`\`

Terminal 3:

\`\`\`bash
proxer http 3000 --server ws://127.0.0.1:8080 --subdomain demo --token dev-token
\`\`\`

Call the public listener with a matching Host header:

\`\`\`bash
curl -H 'Host: demo.proxy.localhost' http://127.0.0.1:8080/
\`\`\`

### Public TLS Reverse Proxy

Run Proxer behind the reverse proxy:

\`\`\`bash
PROXER_LISTEN=0.0.0.0:8080 \\
PROXER_DOMAIN=proxy.example.com \\
PROXER_TRUSTED_PROXIES=loopback,private \\
PROXER_TOKEN="$PROXER_TOKEN" \\
proxer server
\`\`\`

Connect a client through the TLS endpoint:

\`\`\`bash
proxer http 3000 \\
  --server wss://proxy.example.com \\
  --subdomain demo \\
  --token "$PROXER_TOKEN"
\`\`\`

Then route public traffic to \`https://demo.proxy.example.com/\`.

Omit \`--subdomain\` to use an auto-assigned route, or pass \`--subdomain @\` when the root host itself should route to the client and the server has \`--domain\` configured.

### Docker Server

\`\`\`bash
docker run --rm -p 8080:8080 \\
  -e PROXER_TOKEN="$PROXER_TOKEN" \\
  -e PROXER_TRUSTED_PROXIES=loopback,private \\
  tinyrack/proxer \\
  server --listen 0.0.0.0:8080 --domain proxy.example.com
\`\`\`

Use \`ghcr.io/tinyrack-net/proxer\` instead of \`tinyrack/proxer\` if you prefer GHCR.

### Docker Client

On Linux, use host networking when the container must reach a service on the Docker host:

\`\`\`bash
docker run --rm --network host \\
  -e PROXER_TOKEN="$PROXER_TOKEN" \\
  tinyrack/proxer \\
  http 3000 --server ws://127.0.0.1:8080 --subdomain demo
\`\`\`

On macOS and Windows Docker Desktop, use \`host.docker.internal\` when a container needs to reach a local service on the host. For example, expose the host service through a container-local forwarder or configure the app/listener so \`host.docker.internal:<port>\` is reachable; do not assume \`127.0.0.1\` inside the container means the host.

### Kubernetes Health Probes

\`\`\`yaml
livenessProbe:
  httpGet:
    path: /__proxer__/health/live
    port: 8080
readinessProbe:
  httpGet:
    path: /__proxer__/health/ready
    port: 8080
\`\`\`

## Troubleshooting

- Missing client token: since v0.8, \`proxer http\` requires \`--token\` or \`PROXER_TOKEN\`; otherwise it fails with \`token is required\`.
- Token mismatch: use the same token on server and client. If the server auto-generated a token, copy the printed \`token: ...\` value into the client command or environment.
- 404 \`No tunnel route matched host ...\`: the incoming Host header does not match the configured \`--domain\` route rules. Send the expected Host header or fix DNS/reverse proxy Host preservation.
- 404 \`No tunnel registered for ...\`: the Host matched a route, but no matching tunnel client is connected or the client registered a different root/subdomain route.
- \`localhost\` or IP Host is not routed: with domain routing, Proxer expects the configured root domain or \`<subdomain>.<domain>\`; it does not route direct IP or localhost requests to the only client.
- Reverse proxy Host/protocol is wrong: configure \`--trusted-proxy\` or \`PROXER_TRUSTED_PROXIES\` for the proxy TCP peer, and make the proxy preserve or set the original Host and protocol headers.
- Forwarded headers still ignored: Proxer trusts forwarded headers only from configured trusted proxy addresses; untrusted peers cannot influence routing with \`X-Forwarded-*\`.
- Docker client cannot reach local app: on Linux, consider \`--network host\`; on Docker Desktop, use \`host.docker.internal\` instead of \`127.0.0.1\` for host services.
- Control endpoint returns 404 over plain HTTP: \`/__proxer__/control\` requires a WebSocket upgrade. Clients should use \`proxer http --server <base-url>\`, not call the control path manually.

## Safety and Operational Notes

- Use demo tokens such as \`dev-token\` only for local demos.
- Prefer environment variables, Docker secrets, Kubernetes secrets, or a platform secret manager over CLI token flags for real deployments.
- Bind \`127.0.0.1:8080\` by default or when a local reverse proxy is on the same host; use \`0.0.0.0:8080\` only when you intentionally expose the listener on all interfaces or inside container networking.
- Preserve the original Host header through reverse proxies. For Traefik this usually means leaving \`passHostHeader\` enabled.
- Do not route \`/__proxer__/*\` to the local app; all paths under that prefix are reserved for Proxer internals.
- There is no \`PROXER_CONTROL_PATH\` support and no \`--control-path\` flag.
`;
