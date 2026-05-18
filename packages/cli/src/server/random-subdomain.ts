import { randomBytes } from "node:crypto";

const RANDOM_SUBDOMAIN_PREFIX = "px-";
const RANDOM_SUBDOMAIN_BYTES = 8;

export type RandomSubdomainGenerator = () => string;

export const generateRandomSubdomain: RandomSubdomainGenerator = () => {
  const random = randomBytes(RANDOM_SUBDOMAIN_BYTES)
    .toString("base64url")
    .toLowerCase()
    .replace(/_/g, "0");

  return `${RANDOM_SUBDOMAIN_PREFIX}${random}`;
};
