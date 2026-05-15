import { timingSafeEqual } from "node:crypto";

export const secureCompare = (
  expected: string,
  actual: string | undefined,
): boolean => {
  if (actual === undefined) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
};
