export const PROXER_SKILL_CONTENT = `# Proxer Skill

Use this skill when an AI agent needs to run or explain Proxer reverse-tunnel workflows.

Proxer is a Node.js CLI for exposing local HTTP, Server-Sent Events, and WebSocket services through a client-initiated reverse tunnel. Run one public Proxer server, then connect local clients from private networks.

## Commands

Install or refresh this skill file:

\`\`\`bash
proxer skill install <directory>
proxer skill install <directory> --dry-run
proxer skill install <directory> --force
\`\`\`

Start a public server:

\`\`\`bash
proxer server --listen 0.0.0.0:8080 --domain proxy.example.com --token dev-token
\`\`\`

Expose a local HTTP service on port 3000:

\`\`\`bash
proxer http 3000 --server ws://proxy.example.com:8080 --subdomain demo --token dev-token
\`\`\`

Route public traffic by Host header. For a configured domain of \`proxy.example.com\` and subdomain \`demo\`, requests should use \`demo.proxy.example.com\`.

## Internal Paths

These paths are fixed and reserved by Proxer:

- \`/__proxer__/control\`: WebSocket tunnel control connection.
- \`/__proxer__/health/live\`: liveness probe.
- \`/__proxer__/health/ready\`: readiness probe.

There is no configurable control path. Do not invent or pass a \`--control-path\` flag.

## Environment Variables

Supported variables:

- \`PROXER_LISTEN\`: default server listen address for \`proxer server\`.
- \`PROXER_DOMAIN\`: public root domain for root and subdomain routing.
- \`PROXER_TOKEN\`: shared server/client token.
- \`PROXER_TRUSTED_PROXIES\`: comma-separated trusted proxy presets, IPs, or CIDRs.
- \`PROXER_SERVER\`: default tunnel server URL for \`proxer http\`.
- \`PROXER_SUBDOMAIN\`: default subdomain for \`proxer http\`.

CLI flags take precedence over these environment variables.

## Troubleshooting

- Token mismatch: use the same \`--token\` or \`PROXER_TOKEN\` for server and client. A missing token only matches another missing token.
- Host/subdomain routing: send requests with the configured root domain or subdomain Host. Proxer does not automatically route localhost/IP requests to a connected client.
- Trusted proxies: when behind Traefik or another reverse proxy, configure \`--trusted-proxy\` or \`PROXER_TRUSTED_PROXIES\` so Proxer can trust forwarded host/protocol headers from proxies you control.
`;
