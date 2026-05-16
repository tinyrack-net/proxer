const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export const SUBDOMAIN_RULE_MESSAGE =
  "subdomain must be a DNS label: lowercase letters, numbers, and hyphens only; no leading or trailing hyphen; max 63 characters";

export const normalizeTunnelSubdomain = (input: string): string => {
  return input.toLowerCase();
};

export const isTunnelSubdomain = (value: unknown): value is string => {
  return typeof value === "string" && SUBDOMAIN_PATTERN.test(value);
};
