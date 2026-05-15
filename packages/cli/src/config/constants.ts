import packageJson from "../../package.json" with { type: "json" };

export const APP_NAME = "proxer";
export const APP_VERSION = packageJson.version;

export const DEFAULT_LISTEN_ADDRESS = "127.0.0.1:8080";
export const DEFAULT_HTTP_SERVER_URL = "ws://127.0.0.1:8080";
export const DEFAULT_CONTROL_PATH = "/__proxer_control_7f3d9a2b__";
