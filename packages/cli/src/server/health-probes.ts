import type http from "node:http";
import { PROXER_INTERNAL_PREFIX } from "#app/config/constants.ts";

export const HEALTH_LIVE_PATH = `${PROXER_INTERNAL_PREFIX}/health/live`;
export const HEALTH_READY_PATH = `${PROXER_INTERNAL_PREFIX}/health/ready`;

type HealthProbe = "live" | "ready";

const probeForPath = (pathname: string): HealthProbe | undefined => {
  if (pathname === HEALTH_LIVE_PATH) {
    return "live";
  }

  if (pathname === HEALTH_READY_PATH) {
    return "ready";
  }

  return undefined;
};

export const handleHealthProbeRequest = ({
  pathname,
  request,
  response,
}: {
  readonly pathname: string;
  readonly request: http.IncomingMessage;
  readonly response: http.ServerResponse;
}): boolean => {
  const probe = probeForPath(pathname);
  if (!probe) {
    return false;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, {
      allow: "GET, HEAD",
      "content-type": "text/plain; charset=utf-8",
    });
    response.end("Method not allowed\n");
    return true;
  }

  const body = JSON.stringify({ probe, status: "ok" });
  response.writeHead(200, {
    "content-length": Buffer.byteLength(body),
    "content-type": "application/json",
  });
  response.end(request.method === "HEAD" ? undefined : body);
  return true;
};
