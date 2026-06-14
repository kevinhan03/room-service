const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const targets = ["server.js", "api", "lib", "routes", "js"];

function javascriptFiles(target) {
  const absolute = path.join(root, target);
  const stat = fs.statSync(absolute);
  if (stat.isFile()) return absolute.endsWith(".js") ? [absolute] : [];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(absolute, entry.name);
    return entry.isDirectory()
      ? javascriptFiles(path.relative(root, child))
      : child.endsWith(".js") ? [child] : [];
  });
}

const files = targets.flatMap(javascriptFiles).sort();
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
}

require(path.join(root, "server.js"));
console.log(`Checked ${files.length} JavaScript files.`);
