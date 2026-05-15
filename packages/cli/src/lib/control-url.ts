import { normalizeControlPath } from "#app/lib/control-path.ts";
import { ProxerError } from "#app/lib/error.ts";

export type ResolveControlServerUrlOptions = {
  readonly server: string;
  readonly controlPath?: string;
};

export const resolveControlServerUrl = ({
  controlPath,
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

  const hasExplicitPath = url.pathname !== "" && url.pathname !== "/";
  if (hasExplicitPath && controlPath !== undefined) {
    throw new ProxerError(
      "--server path and --control-path cannot be used together",
    );
  }

  if (!hasExplicitPath) {
    url.pathname = normalizeControlPath(controlPath);
  } else {
    url.pathname = normalizeControlPath(url.pathname);
  }

  return url.toString();
};
