import { readFile, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { extname, join, normalize } from "node:path";

import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { cliVersion } from "../cli-version.ts";

const buildRoot = join(import.meta.dirname, "..", "build", "client");
const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

let browser: Browser;
let origin: string;
let server: Server;
let simulateCloudflareBeacon = false;

beforeAll(async () => {
  server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const requestPath = decodeURIComponent(url.pathname);
      const relativePath = requestPath.endsWith("/")
        ? `${requestPath.slice(1)}index.html`
        : requestPath.slice(1);
      const path = normalize(join(buildRoot, relativePath));
      if (!path.startsWith(normalize(buildRoot)))
        throw new Error("Invalid path");
      const file = (await stat(path)).isDirectory()
        ? join(path, "index.html")
        : path;
      let body = await readFile(file);
      if (extname(file) === ".html" && simulateCloudflareBeacon) {
        body = Buffer.from(
          body
            .toString("utf8")
            .replace(
              "</body>",
              '<script defer data-cf-beacon=\'{"token":"test"}\'></script></body>',
            ),
        );
      }
      response.writeHead(200, {
        "content-type":
          contentTypes[extname(file)] ?? "application/octet-stream",
      });
      response.end(body);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("No server port");
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve, reject) =>
    server?.close((error) => (error ? reject(error) : resolve())),
  );
});

describe("Proxer built documentation", () => {
  it("protects hydration from Cloudflare analytics injection", async () => {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    simulateCloudflareBeacon = true;
    try {
      const response = await page.goto(`${origin}/en/guides/how-it-works/`);
      expect(await response?.text()).toContain("data-cf-beacon");
      await page.locator('html[data-hydrated="true"]').waitFor();
      await expect(
        page.locator("script[data-cf-beacon]").count(),
      ).resolves.toBe(1);
      expect(errors).toEqual([]);
    } finally {
      simulateCloudflareBeacon = false;
      await page.close();
    }
  });

  it("renders the English landing and guide in desktop light mode", async () => {
    const page = await browser.newPage({ colorScheme: "light" });
    await page.addInitScript(() =>
      localStorage.setItem("tinyrack-theme", "tinyrack-light"),
    );
    await page.goto(`${origin}/en/`);
    await page.locator('html[data-hydrated="true"]').waitFor();
    await expect(
      page
        .getByRole("heading", {
          name: "A small reverse tunnel you can run yourself.",
        })
        .isVisible(),
    ).resolves.toBe(true);
    await expect(
      page.getByText(`Proxer v${cliVersion}`).first().isVisible(),
    ).resolves.toBe(true);
    await expect(
      page.getByRole("tab", { name: "Windows" }).isVisible(),
    ).resolves.toBe(true);
    expect(await page.locator("html").getAttribute("data-theme")).toBe(
      "tinyrack-light",
    );

    await page.goto(`${origin}/en/guides/routing/`);
    await page.locator('html[data-hydrated="true"]').waitFor();
    await expect(
      page
        .getByRole("heading", { name: "Routing and Trusted Proxies" })
        .isVisible(),
    ).resolves.toBe(true);
    await expect(
      page.locator('meta[name="twitter:card"]').getAttribute("content"),
    ).resolves.toBe("summary_large_image");
    await page.close();
  });

  it("shows the complete transcript when motion is reduced", async () => {
    const page = await browser.newPage({ reducedMotion: "reduce" });
    await page.goto(`${origin}/en/`);
    await page.locator('html[data-hydrated="true"]').waitFor();
    const steps = page.locator(".proxer-terminal-step");
    expect(await steps.count()).toBe(3);
    for (let index = 0; index < 3; index += 1) {
      await expect(
        steps.nth(index).evaluate((node) => getComputedStyle(node).opacity),
      ).resolves.toBe("1");
    }
    await page.close();
  });

  it("renders localized mobile documentation in dark mode", async () => {
    const page = await browser.newPage({
      colorScheme: "dark",
      reducedMotion: "reduce",
      viewport: { height: 844, width: 390 },
    });
    await page.addInitScript(() =>
      localStorage.setItem("tinyrack-theme", "tinyrack-dark"),
    );
    await page.goto(`${origin}/ko/`);
    await page.locator('html[data-hydrated="true"]').waitFor();
    await expect(
      page
        .getByRole("heading", {
          exact: true,
          name: "직접 운영할 수 있는 작은 리버스 터널.",
        })
        .isVisible(),
    ).resolves.toBe(true);
    expect(await page.locator("html").getAttribute("data-theme")).toBe(
      "tinyrack-dark",
    );
    await page.close();
  });

  it("keeps the root redirect", async () => {
    const page = await browser.newPage();
    await page.goto(`${origin}/`);
    await page.waitForURL(`${origin}/en/`);
    await page.close();
  });
});
