import { CONTROL_PATH } from "#app/config/constants.ts";
import { ProxerError } from "#app/lib/error.ts";

export type ResolveControlServerUrlOptions = {
  readonly server: string;
};

export const resolveControlServerUrl = ({
  server,
}: ResolveControlServerUrlOptions): string => {
  let url: URL;
  try {
    url = new URL(server);
  } catch {
    throw new ProxerError("--server must be a valid URL");
  }

  if (url.search || url.hash) {
    throw new ProxerError("--server must not include query or fragment");
  }

  if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol === "https:") {
    url.protocol = "wss:";
  } else if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new ProxerError(
      "--server must use ws://, wss://, http://, or https://",
    );
  }

  if (url.pathname !== "" && url.pathname !== "/") {
    throw new ProxerError("--server must not include a path");
  }

  url.pathname = CONTROL_PATH;

  return url.toString();
};
