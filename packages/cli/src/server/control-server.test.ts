import { afterEach, describe, expect, it } from "vitest";
import { type RawData, WebSocket } from "ws";
import { type HostPort, parseHostPort } from "#app/lib/address.ts";
import { decodeFrame, encodeFrame } from "#app/protocol/frame-codec.ts";
import { startControlServer } from "#app/server/control-server.ts";
import {
  DuplicateTunnelRouteError,
  TunnelRegistry,
} from "#app/server/stream-registry.ts";

const randomAddress: HostPort = { host: "127.0.0.1", port: 0 };

const createLogger = (): {
  readonly messages: string[];
  info(message: string): void;
  error(message: string): void;
} => {
  const messages: string[] = [];

  return {
    messages,
    info(message) {
      messages.push(message);
    },
    error(message) {
      messages.push(message);
    },
  };
};

const openWebSocket = async (url: string): Promise<WebSocket> => {
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return socket;
};

const nextMessage = async (socket: WebSocket) => {
  const data = await new Promise<RawData>((resolve) => {
    socket.once("message", resolve);
  });

  if (Buffer.isBuffer(data)) {
    return decodeFrame(data);
  }

  if (Array.isArray(data)) {
    return decodeFrame(Buffer.concat(data));
  }

  return decodeFrame(Buffer.from(new Uint8Array(data)));
};

const waitForClose = async (socket: WebSocket) => {
  await new Promise<void>((resolve) => {
    if (socket.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }

    socket.once("close", () => resolve());
  });
};

const nextClose = async (socket: WebSocket) => {
  return await new Promise<{ code: number; reason: string }>((resolve) => {
    socket.once("close", (code, reason) =>
      resolve({ code, reason: reason.toString("utf8") }),
    );
  });
};

const failAfter = async (timeoutMs: number): Promise<never> => {
  await new Promise((resolve) => setTimeout(resolve, timeoutMs));
  throw new Error("Timed out waiting for close");
};

const waitForCondition = async (
  predicate: () => boolean,
  timeoutMs = 1_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  if (!predicate()) {
    throw new Error("Timed out waiting for condition");
  }
};

describe("control server", () => {
  const handles: Array<{ close(): Promise<void> }> = [];
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    await Promise.all(
      sockets.splice(0).map(async (socket) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.close();
        }
        await waitForClose(socket);
      }),
    );
    await Promise.all(handles.splice(0).map((handle) => handle.close()));
  });

  it("registers a client and replies with a registered frame", async () => {
    const registry = new TunnelRegistry();
    const logger = createLogger();
    const handle = await startControlServer({
      address: randomAddress,
      logger,
      registry,
    });
    handles.push(handle);
    const socket = await openWebSocket(handle.url);
    sockets.push(socket);

    socket.send(encodeFrame({ type: "register", subdomain: "demo" }));

    await expect(nextMessage(socket)).resolves.toEqual({
      type: "registered",
      subdomain: "demo",
    });
    expect(
      registry.get({ type: "subdomain", subdomain: "demo" })?.route,
    ).toEqual({ type: "subdomain", subdomain: "demo" });
    expect(logger.messages).toEqual([
      expect.stringContaining("[demo] client connected route=subdomain"),
    ]);
  });

  it("registers a generated subdomain when route is omitted", async () => {
    const registry = new TunnelRegistry();
    const handle = await startControlServer({
      address: randomAddress,
      generateSubdomain: () => "px-auto",
      registry,
    });
    handles.push(handle);
    const socket = await openWebSocket(handle.url);
    sockets.push(socket);

    socket.send(encodeFrame({ type: "register" }));

    await expect(nextMessage(socket)).resolves.toEqual({
      type: "registered",
      subdomain: "px-auto",
    });
    expect(
      registry.get({ type: "subdomain", subdomain: "px-auto" })?.route,
    ).toEqual({ type: "subdomain", subdomain: "px-auto" });
    expect(registry.get({ type: "root" })).toBeUndefined();
  });

  it("registers a root-domain client when root is true", async () => {
    const registry = new TunnelRegistry();
    const handle = await startControlServer({
      address: randomAddress,
      generateSubdomain: () => "px-auto",
      registry,
    });
    handles.push(handle);
    const socket = await openWebSocket(handle.url);
    sockets.push(socket);

    socket.send(encodeFrame({ type: "register", root: true }));

    await expect(nextMessage(socket)).resolves.toEqual({ type: "registered" });
    expect(registry.get({ type: "root" })?.route).toEqual({ type: "root" });
    expect(
      registry.get({ type: "subdomain", subdomain: "px-auto" }),
    ).toBeUndefined();
  });

  it("retries when a generated subdomain collides", async () => {
    const registry = new TunnelRegistry();
    const candidates = ["px-collide", "px-free"];
    const handle = await startControlServer({
      address: randomAddress,
      generateSubdomain: () => candidates.shift() ?? "px-extra",
      registry,
    });
    handles.push(handle);
    const firstSocket = await openWebSocket(handle.url);
    const secondSocket = await openWebSocket(handle.url);
    sockets.push(firstSocket, secondSocket);

    firstSocket.send(
      encodeFrame({ type: "register", subdomain: "px-collide" }),
    );
    await nextMessage(firstSocket);
    secondSocket.send(encodeFrame({ type: "register" }));

    await expect(nextMessage(secondSocket)).resolves.toEqual({
      type: "registered",
      subdomain: "px-free",
    });
    expect(
      registry.get({ type: "subdomain", subdomain: "px-free" })?.route,
    ).toEqual({ type: "subdomain", subdomain: "px-free" });
  });

  it("retries generated subdomain collisions using typed duplicate route errors", async () => {
    class RenamedDuplicateRegistry extends TunnelRegistry {
      override register(
        tunnel: Parameters<TunnelRegistry["register"]>[0],
      ): void {
        if (
          tunnel.route.type === "subdomain" &&
          tunnel.route.subdomain === "px-collide"
        ) {
          throw new DuplicateTunnelRouteError(tunnel.route, "route occupied");
        }

        super.register(tunnel);
      }
    }

    const registry = new RenamedDuplicateRegistry();
    const candidates = ["px-collide", "px-free"];
    const handle = await startControlServer({
      address: randomAddress,
      generateSubdomain: () => candidates.shift() ?? "px-extra",
      registry,
    });
    handles.push(handle);
    const socket = await openWebSocket(handle.url);
    sockets.push(socket);

    socket.send(encodeFrame({ type: "register" }));

    await expect(nextMessage(socket)).resolves.toEqual({
      type: "registered",
      subdomain: "px-free",
    });
    expect(
      registry.get({ type: "subdomain", subdomain: "px-free" })?.route,
    ).toEqual({ type: "subdomain", subdomain: "px-free" });
  });

  it("retries invalid generated subdomains without registering them", async () => {
    const registry = new TunnelRegistry();
    const candidates = ["bad.name", "px-free"];
    const handle = await startControlServer({
      address: randomAddress,
      generateSubdomain: () => candidates.shift() ?? "px-extra",
      registry,
    });
    handles.push(handle);
    const socket = await openWebSocket(handle.url);
    sockets.push(socket);

    socket.send(encodeFrame({ type: "register" }));

    await expect(nextMessage(socket)).resolves.toEqual({
      type: "registered",
      subdomain: "px-free",
    });
    expect(
      registry.get({ type: "subdomain", subdomain: "bad.name" }),
    ).toBeUndefined();
    expect(
      registry.get({ type: "subdomain", subdomain: "px-free" })?.route,
    ).toEqual({ type: "subdomain", subdomain: "px-free" });
  });

  it("fails cleanly when generated subdomains are invalid", async () => {
    const registry = new TunnelRegistry();
    const handle = await startControlServer({
      address: randomAddress,
      generateSubdomain: () => "bad.name",
      randomSubdomainMaxAttempts: 2,
      registry,
    });
    handles.push(handle);
    const socket = await openWebSocket(handle.url);
    sockets.push(socket);
    const close = new Promise<{ code: number; reason: string }>((resolve) => {
      socket.once("close", (code, reason) =>
        resolve({ code, reason: reason.toString("utf8") }),
      );
    });

    socket.send(encodeFrame({ type: "register" }));

    await expect(nextMessage(socket)).resolves.toEqual({
      type: "error",
      streamId: "registration",
      message: "Could not allocate a random tunnel subdomain",
    });
    await expect(close).resolves.toEqual({
      code: 1008,
      reason: "Could not allocate a random tunnel subdomain",
    });
    expect(
      registry.get({ type: "subdomain", subdomain: "bad.name" }),
    ).toBeUndefined();
  });

  it("fails registration when generated subdomains all collide", async () => {
    const registry = new TunnelRegistry();
    const handle = await startControlServer({
      address: randomAddress,
      generateSubdomain: () => "px-collide",
      randomSubdomainMaxAttempts: 2,
      registry,
    });
    handles.push(handle);
    const firstSocket = await openWebSocket(handle.url);
    const secondSocket = await openWebSocket(handle.url);
    sockets.push(firstSocket, secondSocket);

    firstSocket.send(
      encodeFrame({ type: "register", subdomain: "px-collide" }),
    );
    await nextMessage(firstSocket);
    const close = new Promise<{ code: number; reason: string }>((resolve) => {
      secondSocket.once("close", (code, reason) =>
        resolve({ code, reason: reason.toString("utf8") }),
      );
    });
    secondSocket.send(encodeFrame({ type: "register" }));

    await expect(nextMessage(secondSocket)).resolves.toEqual({
      type: "error",
      streamId: "registration",
      message: "Could not allocate a random tunnel subdomain",
    });
    await expect(close).resolves.toEqual({
      code: 1008,
      reason: "Could not allocate a random tunnel subdomain",
    });
  });

  it("rejects an invalid registration subdomain without registering it", async () => {
    const registry = new TunnelRegistry();
    const handle = await startControlServer({
      address: randomAddress,
      registry,
    });
    handles.push(handle);
    const socket = await openWebSocket(handle.url);
    sockets.push(socket);

    socket.send(encodeFrame({ type: "register", subdomain: "bad.name" }));

    await expect(
      Promise.race([nextClose(socket), failAfter(100)]),
    ).resolves.toEqual({
      code: 1002,
      reason: "Invalid tunnel frame",
    });
    expect(
      registry.get({ type: "subdomain", subdomain: "bad.name" }),
    ).toBeUndefined();
    expect(registry.get({ type: "root" })).toBeUndefined();
  });

  it("closes a connection when no register frame arrives before the deadline", async () => {
    const registry = new TunnelRegistry();
    const handle = await startControlServer({
      address: randomAddress,
      registry,
      registerTimeoutMs: 20,
    });
    handles.push(handle);
    const socket = await openWebSocket(handle.url);
    sockets.push(socket);

    await expect(nextClose(socket)).resolves.toEqual({
      code: 1008,
      reason: "Tunnel registration timed out",
    });
    expect(registry.get({ type: "root" })).toBeUndefined();
  });

  it("keeps a connection open when registration arrives before the deadline", async () => {
    const registry = new TunnelRegistry();
    const handle = await startControlServer({
      address: randomAddress,
      registry,
      registerTimeoutMs: 100,
    });
    handles.push(handle);
    const socket = await openWebSocket(handle.url);
    sockets.push(socket);

    socket.send(encodeFrame({ type: "register", subdomain: "demo" }));

    await expect(nextMessage(socket)).resolves.toEqual({
      type: "registered",
      subdomain: "demo",
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(socket.readyState).toBe(WebSocket.OPEN);
    expect(
      registry.get({ type: "subdomain", subdomain: "demo" })?.route,
    ).toEqual({ type: "subdomain", subdomain: "demo" });
  });

  it("rejects registration with a mismatched token", async () => {
    const registry = new TunnelRegistry();
    const logger = createLogger();
    const handle = await startControlServer({
      address: randomAddress,
      logger,
      registry,
      token: "expected-token",
    });
    handles.push(handle);
    const socket = await openWebSocket(handle.url);
    sockets.push(socket);
    const close = new Promise<{ code: number; reason: string }>((resolve) => {
      socket.once("close", (code, reason) =>
        resolve({ code, reason: reason.toString("utf8") }),
      );
    });

    socket.send(
      encodeFrame({
        type: "register",
        subdomain: "demo",
        token: "wrong-token",
      }),
    );

    await expect(close).resolves.toEqual({
      code: 1008,
      reason: "Invalid tunnel token",
    });
    expect(
      registry.get({ type: "subdomain", subdomain: "demo" }),
    ).toBeUndefined();
    expect(logger.messages).toEqual([
      expect.stringContaining("client rejected reason=invalid-token"),
    ]);
    expect(logger.messages.join("\n")).not.toContain("expected-token");
    expect(logger.messages.join("\n")).not.toContain("wrong-token");
  });

  it("registers a client with the correct token", async () => {
    const registry = new TunnelRegistry();
    const handle = await startControlServer({
      address: randomAddress,
      registry,
      token: "expected-token",
    });
    handles.push(handle);
    const socket = await openWebSocket(handle.url);
    sockets.push(socket);

    socket.send(
      encodeFrame({
        type: "register",
        subdomain: "demo",
        token: "expected-token",
      }),
    );

    await expect(nextMessage(socket)).resolves.toEqual({
      type: "registered",
      subdomain: "demo",
    });
  });

  it("stores basic auth requirements without logging credentials", async () => {
    const registry = new TunnelRegistry();
    const logger = createLogger();
    const handle = await startControlServer({
      address: randomAddress,
      logger,
      registry,
      token: "expected-token",
    });
    handles.push(handle);
    const socket = await openWebSocket(handle.url);
    sockets.push(socket);

    socket.send(
      encodeFrame({
        basicAuth: { password: "secret", username: "admin" },
        subdomain: "demo",
        token: "expected-token",
        type: "register",
      }),
    );

    await expect(nextMessage(socket)).resolves.toEqual({
      type: "registered",
      subdomain: "demo",
    });
    expect(
      registry.get({ type: "subdomain", subdomain: "demo" })?.basicAuth,
    ).toEqual({ password: "secret", username: "admin" });
    expect(logger.messages.join("\n")).not.toContain("secret");
    expect(logger.messages.join("\n")).not.toContain("admin");
    expect(logger.messages.join("\n")).not.toContain("basicAuth");
  });

  it("rejects a different-length tunnel token without throwing", async () => {
    const registry = new TunnelRegistry();
    const handle = await startControlServer({
      address: randomAddress,
      registry,
      token: "expected-token",
    });
    handles.push(handle);
    const socket = await openWebSocket(handle.url);
    sockets.push(socket);
    const close = new Promise<{ code: number; reason: string }>((resolve) => {
      socket.once("close", (code, reason) =>
        resolve({ code, reason: reason.toString("utf8") }),
      );
    });

    socket.send(
      encodeFrame({
        type: "register",
        subdomain: "demo",
        token: "short",
      }),
    );

    await expect(close).resolves.toEqual({
      code: 1008,
      reason: "Invalid tunnel token",
    });
  });

  it("rejects duplicate tunnel subdomains", async () => {
    const registry = new TunnelRegistry();
    const logger = createLogger();
    const handle = await startControlServer({
      address: randomAddress,
      logger,
      registry,
    });
    handles.push(handle);
    const firstSocket = await openWebSocket(handle.url);
    const secondSocket = await openWebSocket(handle.url);
    sockets.push(firstSocket, secondSocket);

    firstSocket.send(encodeFrame({ type: "register", subdomain: "demo" }));
    await nextMessage(firstSocket);
    const close = new Promise<{ code: number; reason: string }>((resolve) => {
      secondSocket.once("close", (code, reason) =>
        resolve({ code, reason: reason.toString("utf8") }),
      );
    });
    secondSocket.send(encodeFrame({ type: "register", subdomain: "demo" }));

    await expect(nextMessage(secondSocket)).resolves.toEqual({
      type: "error",
      streamId: "registration",
      message: 'Tunnel subdomain "demo" is already registered',
    });
    await expect(close).resolves.toEqual({
      code: 1008,
      reason: 'Tunnel subdomain "demo" is already registered',
    });
    expect(
      registry.get({ type: "subdomain", subdomain: "demo" })?.connection,
    ).toBeDefined();
    expect(logger.messages).toEqual([
      expect.stringContaining("[demo] client connected route=subdomain"),
      expect.stringContaining(
        "[demo] client rejected reason=duplicate-subdomain",
      ),
    ]);
  });

  it("unregisters a tunnel when the client disconnects", async () => {
    const registry = new TunnelRegistry();
    const logger = createLogger();
    const handle = await startControlServer({
      address: randomAddress,
      logger,
      registry,
    });
    handles.push(handle);
    const socket = await openWebSocket(handle.url);
    sockets.push(socket);

    socket.send(encodeFrame({ type: "register", subdomain: "demo" }));
    await nextMessage(socket);
    socket.close();
    await waitForClose(socket);
    await waitForCondition(
      () =>
        registry.get({ type: "subdomain", subdomain: "demo" }) === undefined,
    );

    expect(
      registry.get({ type: "subdomain", subdomain: "demo" }),
    ).toBeUndefined();
    expect(logger.messages).toEqual([
      expect.stringContaining("[demo] client connected route=subdomain"),
      expect.stringContaining("[demo] client disconnected"),
    ]);
  });

  it("returns the listening control URL", async () => {
    const registry = new TunnelRegistry();
    const handle = await startControlServer({
      address: randomAddress,
      registry,
    });
    handles.push(handle);

    const parsedAddress = parseHostPort(handle.url.replace("ws://", ""));
    expect(parsedAddress.host).toBe("127.0.0.1");
    expect(parsedAddress.port).toBeGreaterThan(0);
  });
});
