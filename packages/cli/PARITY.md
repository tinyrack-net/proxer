# TypeScript to Dart parity

Proxer 0.13.0 keeps the existing command names, flags, environment precedence,
exit codes, JSON frames, routing modes, authentication, and HTTP/SSE/WebSocket
behavior.

The Dart implementation intentionally differs only in runtime-specific details:

- stack traces are emitted only when `PROXER_DEBUG=1`;
- native executables replace npm, Node SEA, and pkg distribution;
- public WebSocket upgrades use Dart's raw detached socket after Proxer writes
  the original handshake bytes.

Application tests fix the root, `server`, `http`, and `skill install` help
contracts. Protocol tests fix JSON frame encoding and validation, and
integration tests cover HTTP bodies, SSE, and WebSocket byte streams through a
real server/client pair.
