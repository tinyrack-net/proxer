export type ApplicationInfo = {
  name: string;
  packageName: string;
  version: string;
  purpose: string;
};

export const createApplicationInfo = (): ApplicationInfo => {
  return {
    name: "proxer",
    packageName: "@tinyrack/proxer",
    version: "0.0.0",
    purpose: "Reverse-tunnel CLI for exposing local services through Tinyrack.",
  };
};
