<div align="center">

# Proxer

**Self-hosted reverse tunnels for putting private HTTP services behind a public URL you control.**

[![CI](https://github.com/tinyrack-net/proxer/actions/workflows/pipeline.yml/badge.svg)](https://github.com/tinyrack-net/proxer/actions/workflows/pipeline.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[Documentation](https://proxer.tinyrack.net/en/) · [Getting Started](https://proxer.tinyrack.net/en/getting-started/) · [한국어](https://proxer.tinyrack.net/ko/) · [日本語](https://proxer.tinyrack.net/ja/)

</div>

---

Proxer is a small CLI for the familiar problem where a service runs on a laptop, mini PC, NAS, or office box, and you need a stable public URL without opening inbound ports into that private network. You run one public Proxer server, and each private machine dials out to it with a WebSocket tunnel.

## Features

- **HTTP, SSE, and WebSocket** traffic forwarded through a single client-initiated tunnel
- **Host-based routing** with named subdomains, auto-assigned subdomains, or the root domain
- **Cluster mode** for round-robin load balancing across multiple clients on one route
- **Basic Auth** protection for public access to a tunnel
- **Self-hosted** on your own VPS or homelab edge — a single binary or container, no managed service

## Installation

### Windows

```powershell
winget install tinyrack.proxer
```

### macOS / Linux

```bash
brew install tinyrack-net/tap/proxer
```

### Docker

```bash
docker run --rm tinyrack/proxer --version
```

Prebuilt binaries for all supported platforms are also available on the [GitHub Releases](https://github.com/tinyrack-net/proxer/releases) page.

## Quick Start

Start the public server:

```bash
proxer server --listen 0.0.0.0:8080 --domain proxy.example.com --token dev-token
```

Expose a local service from a private machine:

```bash
proxer http 3000 --server wss://proxy.example.com --subdomain demo --token dev-token
```

Requests for `https://demo.proxy.example.com/` now reach `127.0.0.1:3000` on that machine.

## Documentation

For guides, command reference, and deployment notes, visit the **[Proxer documentation site](https://proxer.tinyrack.net/en/)**.

## License

[MIT](LICENSE)
