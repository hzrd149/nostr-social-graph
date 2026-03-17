import { test, expect } from "@playwright/test";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { fileURLToPath } from "url";
import fs from "fs";
import fsp from "fs/promises";
import http from "http";
import net from "net";
import os from "os";
import path from "path";
import { FileStore } from "../scripts/hashtreeStore";
import { ProfileSearchIndex, profileSearchIndexNhash } from "../scripts/profileSearchIndex";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const dataPath = path.join(repoRoot, "data", "profileData.json");

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
]);

let viteProcess: ChildProcessWithoutNullStreams | null = null;
let blossomServer: http.Server | null = null;
let tempDir = "";
let baseUrl = "";
let blossomUrl = "";
let searchName = "";
let searchTerm = "";

function pickSearchTerm(name: string, pubKey: string): string {
  const tokens = name
    .split(/[^a-zA-Z0-9]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  for (const token of tokens) {
    if (token.length < 2) {
      continue;
    }
    const lower = token.toLowerCase();
    if (STOP_WORDS.has(lower)) {
      continue;
    }
    return token;
  }

  return pubKey.slice(0, 8);
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to allocate a port"));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForPort(port: number, timeoutMs = 30_000): Promise<void> {
  const hosts = ["localhost", "127.0.0.1", "::1"];
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const host of hosts) {
      try {
        await new Promise<void>((resolve, reject) => {
          const socket = net.connect({ port, host }, () => {
            socket.end();
            resolve();
          });
          socket.on("error", reject);
        });
        return;
      } catch {
        // retry
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for port ${port}`);
}

async function startBlossomServer(dir: string): Promise<{ server: http.Server; url: string }> {
  const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    const parsed = new URL(req.url ?? "/", "http://localhost");
    if (!parsed.pathname.endsWith(".bin")) {
      res.statusCode = 404;
      res.end();
      return;
    }

    const hash = parsed.pathname.slice(1, -4);
    const filePath = path.join(dir, hash);
    if (!fs.existsSync(filePath)) {
      res.statusCode = 404;
      res.end();
      return;
    }

    if (req.method === "HEAD") {
      res.statusCode = 200;
      res.end();
      return;
    }

    const data = fs.readFileSync(filePath);
    res.setHeader("Content-Type", "application/octet-stream");
    res.statusCode = 200;
    res.end(data);
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start Blossom test server");
  }
  return { server, url: `http://localhost:${address.port}` };
}

function startViteServer(env: NodeJS.ProcessEnv, port: number): ChildProcessWithoutNullStreams {
  const viteBin = path.join(repoRoot, "node_modules", ".bin", "vite");
  const child = spawn(
    viteBin,
    ["--config", "vite.config.ts", "--port", String(port), "--strictPort"],
    {
      cwd: path.join(repoRoot, "examples"),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  child.stdout.on("data", (data) => {
    if (process.env.DEBUG_E2E) {
      process.stdout.write(data);
    }
  });
  child.stderr.on("data", (data) => {
    if (process.env.DEBUG_E2E) {
      process.stderr.write(data);
    }
  });

  return child;
}

async function stopProcess(child: ChildProcessWithoutNullStreams | null): Promise<void> {
  if (!child || child.killed) {
    return;
  }
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (!child.killed) {
    child.kill("SIGKILL");
  }
}

test.beforeAll(async () => {
  const profileData = JSON.parse(await fsp.readFile(dataPath, "utf-8")) as string[][];
  const entry = profileData.find((row) => row[0] && row[1]);
  if (!entry) {
    throw new Error("Profile data is empty");
  }

  const [pubKey, name, nip05] = entry;
  searchName = name;
  searchTerm = pickSearchTerm(name, pubKey);

  tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "nostr-profile-index-"));
  const store = new FileStore(tempDir);
  const index = new ProfileSearchIndex(store);

  let root = null;
  root = await index.indexProfile(root, {
    pubKey,
    name,
    nip05: nip05 || undefined,
  });

  if (!root) {
    throw new Error("Failed to build profile search index root");
  }

  const nhash = profileSearchIndexNhash(root);
  if (!nhash) {
    throw new Error("Failed to compute profile search index nhash");
  }

  const blossom = await startBlossomServer(tempDir);
  blossomServer = blossom.server;
  blossomUrl = blossom.url;

  const vitePort = await getFreePort();
  viteProcess = startViteServer(
    {
      ...process.env,
      VITE_PROFILE_SEARCH_INDEX: nhash,
      VITE_BLOSSOM_SERVERS: blossomUrl,
      FORCE_COLOR: "0",
    },
    vitePort
  );

  baseUrl = `http://localhost:${vitePort}`;
  await waitForPort(vitePort);
});

test.afterAll(async () => {
  await stopProcess(viteProcess);
  if (blossomServer) {
    await new Promise<void>((resolve) => blossomServer!.close(() => resolve()));
  }
  if (tempDir) {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
});

test("uses hashtree profile search index in the UI", async ({ page }) => {
  const blossomRequests: string[] = [];
  page.on("request", (req) => {
    if (req.url().startsWith(blossomUrl) && req.url().endsWith(".bin")) {
      blossomRequests.push(req.url());
    }
  });

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  const input = page.getByPlaceholder("Search (or paste public key)");
  await input.waitFor({ state: "visible" });
  await input.fill(searchTerm);

  const firstResult = page.locator("ul.dropdown-content li").first();
  await expect(firstResult).toBeVisible();
  await expect(firstResult).toContainText(searchName);

  await expect.poll(() => blossomRequests.length, { timeout: 5_000 }).toBeGreaterThan(0);
});
