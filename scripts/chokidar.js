import chokidar from "chokidar";
import { restart, start, stop } from "./retrystart.js";
import "dotenv/config";

const watcher = chokidar.watch("src/**/*", {
  ignored: "node_modules",
  persistent: true,
});

// see if redis is alive
await fetch(`http://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`).catch(
  (e) => {
    if (e.code === "ConnectionRefused") {
      console.error(
        `Redis is not running on http://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}! Please start it first!`
      );
      process.exit(1);
    }
  }
);

let restartTimer;
watcher.once("ready", () => {
  start();
  watcher.on("all", () => {
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => restart(), 100);
  });
});

["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT", "SIGBREAK"].forEach((signal) => {
  process.on(signal, () => {
    stop();
    process.exit(0);
  });
});