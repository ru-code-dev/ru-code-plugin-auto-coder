"use strict";

const fs = process.getBuiltinModule("node:fs");
const path = process.getBuiltinModule("node:path");

const ENV_FILE = ".env";
const REPOS_FILE = "local-repos.json";
const HEARTBEAT_LIMIT_FILE = "heartbeat-limit";

const cwd = process.cwd();

const readFromCwd = (name) => {
  try {
    return fs.readFileSync(path.join(cwd, name), "utf8");
  } catch {
    return null;
  }
};

const dump = (name, text) => {
  console.log(`=== ${name} ===`);
  process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
};

const envText = readFromCwd(ENV_FILE);
const reposText = readFromCwd(REPOS_FILE);

const missing = [];
if (envText === null) missing.push(ENV_FILE);
if (reposText === null) missing.push(REPOS_FILE);
if (missing.length > 0) {
  console.error(`auto-coder: cannot start — ${missing.join(" and ")} missing in ${cwd}`);
  process.exit(1);
}

dump(ENV_FILE, envText);
dump(REPOS_FILE, reposText);

const limitText = readFromCwd(HEARTBEAT_LIMIT_FILE);
const parsedLimit = limitText === null ? Number.NaN : Number.parseInt(limitText.trim(), 10);
const heartbeatLimit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : Number.NaN;

let beat = 0;
const timer = setInterval(() => {
  beat += 1;
  console.log(`heartbeat #${beat} ${new Date().toISOString()}`);
  if (beat >= heartbeatLimit) {
    clearInterval(timer);
    process.exit(0);
  }
}, 1000);
