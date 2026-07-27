const String proxerSkillContent = r'''# Proxer

Use `proxer` to expose local HTTP, SSE, and WebSocket services through a
self-hosted reverse tunnel.

## Server

```sh
proxer server --listen 0.0.0.0:8080 --domain proxy.example.com
```

Set `PROXER_TOKEN` for a stable secret. Without it, the server prints a newly
generated token.

## Client

```sh
proxer http 3000 --server wss://proxy.example.com --token "$PROXER_TOKEN"
proxer http 3000 --server wss://proxy.example.com --subdomain demo --token "$PROXER_TOKEN"
```

Use `--subdomain @` for the root route and `--mode cluster` to share a named
route across replicas.
''';
