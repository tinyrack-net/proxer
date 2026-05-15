import { buildRouteMap } from "@stricli/core";
import type { ProxerCommandContext } from "#app/application.ts";
import { rootCommands } from "#app/cli/root-commands.ts";

export const buildRootRoute = () => {
  return buildRouteMap<keyof typeof rootCommands, ProxerCommandContext>({
    routes: rootCommands,
    docs: {
      brief: "Expose local services through reverse tunnels.",
    },
  });
};
