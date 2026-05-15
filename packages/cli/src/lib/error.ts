export class ProxerError extends Error {
  readonly exitCode: number;

  constructor(message: string, options: { readonly exitCode?: number } = {}) {
    super(message);
    this.name = "ProxerError";
    this.exitCode = options.exitCode ?? 1;
  }
}

export const formatProxerError = (error: unknown): string => {
  if (error instanceof ProxerError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
};
