import net from "node:net";
import { ProxerError } from "#app/lib/error.ts";

export type TrustedProxyRule =
  | {
      readonly kind: "ipv4-cidr";
      readonly network: number;
      readonly prefixLength: number;
    }
  | {
      readonly kind: "ipv6-cidr";
      readonly network: bigint;
      readonly prefixLength: number;
    };

export type TrustedProxyConfig = {
  readonly rules: readonly TrustedProxyRule[];
};

const IPV4_BITS = 32;
const IPV6_BITS = 128;
const IPV6_GROUPS = 8;

const parseIpv4Address = (value: string): number | undefined => {
  if (net.isIP(value) !== 4) {
    return undefined;
  }

  const octets = value.split(".").map((item) => Number(item));
  return (
    (((octets[0] ?? 0) << 24) +
      ((octets[1] ?? 0) << 16) +
      ((octets[2] ?? 0) << 8) +
      (octets[3] ?? 0)) >>>
    0
  );
};

const expandIpv4Tail = (value: string): string => {
  const lastColon = value.lastIndexOf(":");
  const tail = value.slice(lastColon + 1);
  const ipv4 = parseIpv4Address(tail);
  if (ipv4 === undefined) {
    return value;
  }

  const high = ((ipv4 >>> 16) & 0xffff).toString(16);
  const low = (ipv4 & 0xffff).toString(16);
  return `${value.slice(0, lastColon)}:${high}:${low}`;
};

const parseIpv6Address = (value: string): bigint | undefined => {
  if (net.isIP(value) !== 6) {
    return undefined;
  }

  const withoutZone = value.split("%")[0] ?? value;
  const normalized = expandIpv4Tail(withoutZone.toLowerCase());
  const doubleColonParts = normalized.split("::");
  if (doubleColonParts.length > 2) {
    return undefined;
  }

  const parseGroups = (part: string): number[] => {
    if (!part) {
      return [];
    }

    return part.split(":").map((group) => {
      if (!/^[0-9a-f]{1,4}$/u.test(group)) {
        return Number.NaN;
      }
      return Number.parseInt(group, 16);
    });
  };

  const left = parseGroups(doubleColonParts[0] ?? "");
  const right = parseGroups(doubleColonParts[1] ?? "");
  if (left.some(Number.isNaN) || right.some(Number.isNaN)) {
    return undefined;
  }

  const missingGroups = IPV6_GROUPS - left.length - right.length;
  if (doubleColonParts.length === 1 && missingGroups !== 0) {
    return undefined;
  }
  if (doubleColonParts.length === 2 && missingGroups < 1) {
    return undefined;
  }

  const groups = [
    ...left,
    ...Array.from({ length: missingGroups }, () => 0),
    ...right,
  ];
  if (groups.length !== IPV6_GROUPS) {
    return undefined;
  }

  return groups.reduce(
    (address, group) => (address << 16n) + BigInt(group),
    0n,
  );
};

const ipv4Mask = (prefixLength: number): number => {
  if (prefixLength === 0) {
    return 0;
  }

  return (0xffffffff << (IPV4_BITS - prefixLength)) >>> 0;
};

const ipv6Mask = (prefixLength: number): bigint => {
  if (prefixLength === 0) {
    return 0n;
  }

  return (
    ((1n << BigInt(prefixLength)) - 1n) << BigInt(IPV6_BITS - prefixLength)
  );
};

const parsePrefixLength = ({
  bits,
  input,
  value,
}: {
  readonly bits: number;
  readonly input: string;
  readonly value: string;
}): number => {
  if (!/^\d+$/u.test(value)) {
    throw new ProxerError(`Invalid trusted proxy value "${input}"`);
  }

  const prefixLength = Number(value);
  if (
    !Number.isInteger(prefixLength) ||
    prefixLength < 0 ||
    prefixLength > bits
  ) {
    throw new ProxerError(`Invalid trusted proxy value "${input}"`);
  }

  return prefixLength;
};

const createIpv4Rule = (
  address: number,
  prefixLength: number,
): TrustedProxyRule => {
  const mask = ipv4Mask(prefixLength);
  return {
    kind: "ipv4-cidr",
    network: (address & mask) >>> 0,
    prefixLength,
  };
};

const createIpv6Rule = (
  address: bigint,
  prefixLength: number,
): TrustedProxyRule => {
  return {
    kind: "ipv6-cidr",
    network: address & ipv6Mask(prefixLength),
    prefixLength,
  };
};

const parseTrustedProxyValue = (input: string): readonly TrustedProxyRule[] => {
  switch (input) {
    case "loopback":
      return parseTrustedProxyValues(["127.0.0.0/8", "::1/128"]).rules;
    case "private":
      return parseTrustedProxyValues([
        "10.0.0.0/8",
        "172.16.0.0/12",
        "192.168.0.0/16",
        "fc00::/7",
      ]).rules;
  }

  const cidrParts = input.split("/");
  if (cidrParts.length > 2) {
    throw new ProxerError(`Invalid trusted proxy value "${input}"`);
  }

  const addressText = cidrParts[0] ?? "";
  const ipv4 = parseIpv4Address(addressText);
  if (ipv4 !== undefined) {
    const prefixLength = cidrParts[1]
      ? parsePrefixLength({ bits: IPV4_BITS, input, value: cidrParts[1] })
      : IPV4_BITS;
    return [createIpv4Rule(ipv4, prefixLength)];
  }

  const ipv6 = parseIpv6Address(addressText);
  if (ipv6 !== undefined) {
    const prefixLength = cidrParts[1]
      ? parsePrefixLength({ bits: IPV6_BITS, input, value: cidrParts[1] })
      : IPV6_BITS;
    return [createIpv6Rule(ipv6, prefixLength)];
  }

  throw new ProxerError(`Invalid trusted proxy value "${input}"`);
};

export const parseTrustedProxyValues = (
  values: readonly string[],
): TrustedProxyConfig => {
  return {
    rules: values.flatMap((value) =>
      parseTrustedProxyValue(value.trim().toLowerCase()),
    ),
  };
};

const parseRemoteAddress = (
  remoteAddress: string | undefined,
):
  | { readonly kind: "ipv4"; readonly address: number }
  | { readonly kind: "ipv6"; readonly address: bigint }
  | undefined => {
  if (!remoteAddress) {
    return undefined;
  }

  const value = remoteAddress.trim().toLowerCase();
  const mappedIpv4 = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/u)?.[1];
  const ipv4 = parseIpv4Address(mappedIpv4 ?? value);
  if (ipv4 !== undefined) {
    return { kind: "ipv4", address: ipv4 };
  }

  const ipv6 = parseIpv6Address(value);
  if (ipv6 !== undefined) {
    return { kind: "ipv6", address: ipv6 };
  }

  return undefined;
};

export const isTrustedProxy = (
  remoteAddress: string | undefined,
  config: TrustedProxyConfig,
): boolean => {
  const remote = parseRemoteAddress(remoteAddress);
  if (!remote) {
    return false;
  }

  return config.rules.some((rule) => {
    if (remote.kind === "ipv4" && rule.kind === "ipv4-cidr") {
      return (
        (remote.address & ipv4Mask(rule.prefixLength)) >>> 0 === rule.network
      );
    }

    if (remote.kind === "ipv6" && rule.kind === "ipv6-cidr") {
      return (remote.address & ipv6Mask(rule.prefixLength)) === rule.network;
    }

    return false;
  });
};
