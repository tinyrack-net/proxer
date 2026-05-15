import { ProxerError } from "#app/lib/error.ts";
import { assertTunnelFrame, type TunnelFrame } from "#app/protocol/frame.ts";

export class ProtocolError extends ProxerError {
  constructor(message: string) {
    super(message);
    this.name = "ProtocolError";
  }
}

export const encodeFrame = (frame: TunnelFrame): string => {
  return JSON.stringify(frame);
};

export const decodeFrame = (
  payload: string | Buffer | ArrayBuffer,
): TunnelFrame => {
  const text =
    typeof payload === "string"
      ? payload
      : payload instanceof Buffer
        ? payload.toString("utf8")
        : Buffer.from(new Uint8Array(payload)).toString("utf8");
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch {
    throw new ProtocolError("Invalid frame JSON");
  }

  try {
    assertTunnelFrame(value);
  } catch (error) {
    if (error instanceof Error) {
      throw new ProtocolError(error.message);
    }

    throw new ProtocolError("Invalid tunnel frame");
  }

  return value;
};
