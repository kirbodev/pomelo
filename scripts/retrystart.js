import cp from "child_process";
import EventEmitter from "events";

const restartEvent = new EventEmitter();

export function start(script) {
  script ||= "start:full";
  console.log(`Starting ${script}`);
  const ch = cp.spawn("bun", ["run", script], {
    stdio: "inherit",
  });
  // on error, restart
  ch.once("exit", (_, signal) => {
    if (signal === "SIGINT") return;
    restartEvent.emit("restart");
  });
  restartEvent.once("restart", () => {
    restartEvent.removeAllListeners("restart");
    console.log(`Restarting ${script}`);
    kill(ch);
    start(script);
  });
}

start(process.argv.find((arg) => arg.startsWith("--script="))?.split("=")[1]);

export function restart() {
  restartEvent.emit("restart");
}

/**
 *
 * @param {cp.ChildProcess} child
 */
export function kill(child) {
  if (child) {
    child.kill("SIGINT");
    console.log(
      child.killed ? "Killed child process" : "Failed to kill child process"
    );
  }
}
