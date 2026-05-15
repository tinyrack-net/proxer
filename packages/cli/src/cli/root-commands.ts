import { buildHttpCommand } from "#app/cli/http.ts";
import { buildServerCommand } from "#app/cli/server.ts";
import { buildSkillCommand } from "#app/cli/skill.ts";

export const rootCommands = {
  server: buildServerCommand(),
  http: buildHttpCommand(),
  skill: buildSkillCommand(),
};
