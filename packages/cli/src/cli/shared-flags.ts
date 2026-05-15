import {
  DEFAULT_CONTROL_ADDRESS,
  DEFAULT_HTTP_SERVER_URL,
  DEFAULT_PUBLIC_ADDRESS,
} from "#app/config/constants.ts";

export const tokenFlag = {
  kind: "parsed" as const,
  parse: (input: string) => input,
  brief: "Token required by the tunnel server.",
  optional: true as const,
};

export const serverPublicFlag = {
  kind: "parsed" as const,
  parse: (input: string) => input,
  brief: "Public HTTP listener address.",
  placeholder: "host:port",
  default: DEFAULT_PUBLIC_ADDRESS,
};

export const serverControlFlag = {
  kind: "parsed" as const,
  parse: (input: string) => input,
  brief: "Tunnel control WebSocket listener address.",
  placeholder: "host:port",
  default: DEFAULT_CONTROL_ADDRESS,
};

export const httpServerFlag = {
  kind: "parsed" as const,
  parse: (input: string) => input,
  brief: "Tunnel control WebSocket URL.",
  placeholder: "ws://host:port",
  default: DEFAULT_HTTP_SERVER_URL,
};

export const httpNameFlag = {
  kind: "parsed" as const,
  parse: (input: string) => input,
  brief: "Tunnel name used for host routing.",
  placeholder: "name",
  optional: true as const,
};
