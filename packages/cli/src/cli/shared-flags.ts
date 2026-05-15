import {
  DEFAULT_CONTROL_PATH,
  DEFAULT_HTTP_SERVER_URL,
  DEFAULT_LISTEN_ADDRESS,
} from "#app/config/constants.ts";

export const tokenFlag = {
  kind: "parsed" as const,
  parse: (input: string) => input,
  brief: "Token required by the tunnel server.",
  optional: true as const,
};

export const serverListenFlag = {
  kind: "parsed" as const,
  parse: (input: string) => input,
  brief: "Single HTTP/WebSocket listener address.",
  placeholder: "host:port",
  default: DEFAULT_LISTEN_ADDRESS,
};

export const controlPathFlag = {
  kind: "parsed" as const,
  parse: (input: string) => input,
  brief: "Control WebSocket path.",
  placeholder: DEFAULT_CONTROL_PATH,
  optional: true as const,
};

export const httpServerFlag = {
  kind: "parsed" as const,
  parse: (input: string) => input,
  brief: "Tunnel server base URL.",
  placeholder: "ws://host:port",
  default: DEFAULT_HTTP_SERVER_URL,
};

export const serverDomainFlag = {
  kind: "parsed" as const,
  parse: (input: string) => input.toLowerCase(),
  brief: "Public root domain used for root and subdomain routing.",
  placeholder: "example.com",
  optional: true as const,
};

export const httpSubdomainFlag = {
  kind: "parsed" as const,
  parse: (input: string) => input.toLowerCase(),
  brief: "Subdomain used for host routing.",
  placeholder: "subdomain",
  optional: true as const,
};
