import { buildHttpCommand } from "#app/cli/http.ts";
import { buildServerCommand } from "#app/cli/server.ts";

export const rootCommands = {
  server: buildServerCommand(),
  http: buildHttpCommand(),
};
