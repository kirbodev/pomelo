import cp from "child_process";
import { execSync } from "child_process";

const script = process.argv.find((arg) => arg.startsWith("--script="))?.split("=")[1] ?? "start";

let child = null;
let restarting = false;

function build() {
  console.log("Building");
  const result = cp.spawnSync("bun", ["run", "build"], { stdio: "inherit" });
  return result.status === 0;
}

function launch() {
  if (!build()) {
    console.error("Build failed, the last server will be restarted on the next change");
    return;
  }
  console.log(`Starting ${script}`);
  const spawned = cp.spawn("bun", ["run", script], { stdio: "inherit" });
  child = spawned;
  spawned.once("exit", (code, signal) => {
    if (child !== spawned) return;
    child = null;
    if (signal === "SIGINT") return;
    console.log(`Server exited with code ${code}, restarting`);
    restart();
  });
}

export function start() {
  if (child || restarting) return;
  launch();
}

export function restart() {
  if (restarting) return;
  restarting = true;
  try {
    kill();
    launch();
  } finally {
    restarting = false;
  }
}

export function stop() {
  kill();
}

export function kill() {
  if (!child) return;
  const spawned = child;
  child = null;
  if (process.platform === "win32") {
    try {
      execSync(`taskkill /pid ${spawned.pid} /T /F`, { stdio: "ignore" });
      console.log("Killed child process tree");
    } catch {
      console.log("Child process was already gone");
    }
  } else {
    spawned.kill("SIGTERM");
    setTimeout(() => {
      if (spawned.exitCode === null) spawned.kill("SIGKILL");
    }, 3000);
  }
}