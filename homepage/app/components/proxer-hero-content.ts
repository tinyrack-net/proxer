export const terminalSteps = [
  "❯ proxer server --listen 0.0.0.0:8080 --domain tunnel.example.com\nserver listening on 0.0.0.0:8080",
  "❯ proxer http 3000 --server wss://tunnel.example.com\nsubdomain: px-k7m3q9t2ab\nurl: https://px-k7m3q9t2ab.tunnel.example.com",
  "❯ curl https://px-k7m3q9t2ab.tunnel.example.com\nHello from localhost:3000",
] as const;

export const installTargets = [
  {
    command: "winget install tinyrack.proxer",
    label: "Windows",
    value: "winget",
  },
  {
    command: "brew install tinyrack-net/tap/proxer",
    label: "macOS / Linux",
    value: "homebrew",
  },
] as const;
