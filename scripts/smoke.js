const path = require("node:path");
const { spawn } = require("node:child_process");
const { sitePassword } = require("../lib/config");

const root = path.join(__dirname, "..");
const port = Number(process.env.SMOKE_PORT || 3143);
const origin = `http://127.0.0.1:${port}`;
const readRoutes = [
  "/api/recommendations/today",
  "/api/curation-items",
  "/api/sources",
  "/api/collection-runs",
  "/api/inbox",
  "/api/post-drafts",
  "/api/kevin-finds"
];

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Smoke server did not start.")), 10_000);
    const onData = (chunk) => {
      const text = chunk.toString();
      if (!text.includes("dig.everyday server started")) return;
      clearTimeout(timeout);
      child.stdout.off("data", onData);
      resolve();
    };
    child.stdout.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Smoke server exited early with code ${code}.`));
    });
  });
}

async function expectStatus(pathname, expected, cookie = "", options = {}) {
  const response = await fetch(`${origin}${pathname}`, {
    ...options,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  if (response.status !== expected) {
    const body = await response.text();
    throw new Error(`${pathname} returned ${response.status}, expected ${expected}: ${body.slice(0, 300)}`);
  }
  return response;
}

async function run() {
  if (!sitePassword) throw new Error("SITE_PASSWORD is required for the smoke test.");
  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

  try {
    await waitForServer(child);
    await expectStatus("/", 401);
    await expectStatus("/api/today", 401);

    const login = await fetch(`${origin}/auth/login`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ password: sitePassword })
    });
    if (login.status !== 303) throw new Error(`Login returned ${login.status}, expected 303.`);
    const cookie = String(login.headers.get("set-cookie") || "").split(";")[0];
    if (!cookie) throw new Error("Login did not return a session cookie.");

    await expectStatus("/", 200, cookie);
    await expectStatus("/styles.css", 200, cookie);
    await expectStatus("/js/app.js", 200, cookie);
    await expectStatus("/js/images.js", 200, cookie);
    for (const route of readRoutes) await expectStatus(route, 200, cookie);
    await expectStatus("/api/inbox", 400, cookie, { method: "POST", body: "{}" });
    await expectStatus("/api/sources", 400, cookie, {
      method: "POST",
      body: JSON.stringify({ url: "ftp://invalid.example" })
    });
    await expectStatus("/api/create-deck", 400, cookie, {
      method: "POST",
      body: JSON.stringify({ title: "x".repeat(121) })
    });
    await expectStatus("/api/curation-items/bulk-decision", 400, cookie, {
      method: "PATCH",
      body: JSON.stringify({ ids: [], decision: "rejected" })
    });
    await expectStatus("/api/post-drafts/not-a-draft/slides/1/image", 400, cookie, {
      method: "POST",
      body: JSON.stringify({ dataUrl: "invalid" })
    });
    await expectStatus("/api/not-a-route", 405, cookie, { method: "POST", body: "{}" });
    console.log(`Smoke tested ${readRoutes.length} read routes, 6 guarded write routes, and protected static assets.`);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      if (child.exitCode !== null) resolve();
      else child.once("exit", resolve);
      setTimeout(resolve, 2_000);
    });
    if (stderr) process.stderr.write(stderr);
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
