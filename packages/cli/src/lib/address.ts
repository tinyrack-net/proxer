import { ProxerError } from "#app/lib/error.ts";

export type HostPort = {
  readonly host: string;
  readonly port: number;
};

export const parseHostPort = (
  input: string,
  defaultHost = "127.0.0.1",
): HostPort => {
  const separatorIndex = input.lastIndexOf(":");
  if (separatorIndex === -1) {
    throw new ProxerError("missing port");
  }

  const hostText = input.slice(0, separatorIndex).trim();
  const portText = input.slice(separatorIndex + 1).trim();
  if (portText.length === 0) {
    throw new ProxerError("missing port");
  }

  if (!/^\d+$/.test(portText)) {
    throw new ProxerError("invalid port");
  }

  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ProxerError("port must be between 1 and 65535");
  }

  return {
    host: hostText || defaultHost,
    port,
  };
};

export const formatHostPort = (address: HostPort): string => {
  return `${address.host}:${address.port}`;
};
