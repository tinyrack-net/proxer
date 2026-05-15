import packageJson from "../../package.json" with { type: "json" };

export const APP_NAME = "proxer";
export const APP_VERSION = packageJson.version;

export const DEFAULT_LISTEN_ADDRESS = "127.0.0.1:8080";
export const DEFAULT_HTTP_SERVER_URL = "ws://127.0.0.1:8080";
export const PROXER_INTERNAL_PREFIX = "/__proxer__";
export const CONTROL_PATH = `${PROXER_INTERNAL_PREFIX}/control`;
