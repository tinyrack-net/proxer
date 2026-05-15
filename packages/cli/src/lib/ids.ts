import { randomUUID } from "node:crypto";

export const createStreamId = (): string => {
  return randomUUID();
};
