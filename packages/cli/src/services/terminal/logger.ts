export type TerminalLogger = {
  info(message: string): void;
  error(message: string): void;
};

type WritableLike = {
  write(message: string): unknown;
};

export const createTerminalLogger = (
  stdout: WritableLike,
  stderr: WritableLike,
): TerminalLogger => {
  return {
    info(message) {
      stdout.write(`${message}\n`);
    },
    error(message) {
      stderr.write(`${message}\n`);
    },
  };
};
