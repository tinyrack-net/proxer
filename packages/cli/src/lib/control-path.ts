import { DEFAULT_CONTROL_PATH } from "#app/config/constants.ts";
import { ProxerError } from "#app/lib/error.ts";

export const normalizeControlPath = (value: string | undefined): string => {
  if (value === undefined) {
    return DEFAULT_CONTROL_PATH;
  }

  if (value.length === 0) {
    throw new ProxerError("--control-path must not be empty");
  }

  if (!value.startsWith("/")) {
    throw new ProxerError("--control-path must start with /");
  }

  if (value === "/") {
    throw new ProxerError("--control-path must not be /");
  }

  return value;
};
