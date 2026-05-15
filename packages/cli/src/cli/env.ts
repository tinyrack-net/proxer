export type EnvSource = Record<string, string | undefined>;

export const readEnvString = ({
  env,
  name,
}: {
  readonly env: EnvSource;
  readonly name: string;
}): string | undefined => {
  const value = env[name]?.trim();
  return value ? value : undefined;
};

export const readEnvList = ({
  env,
  name,
}: {
  readonly env: EnvSource;
  readonly name: string;
}): readonly string[] | undefined => {
  const value = readEnvString({ env, name });
  if (!value) {
    return undefined;
  }

  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return items.length > 0 ? items : undefined;
};

export const preferFlag = <T>(
  flagValue: T | undefined,
  envValue: T | undefined,
): T | undefined => {
  return flagValue === undefined ? envValue : flagValue;
};
