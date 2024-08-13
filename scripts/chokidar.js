import chokidar from "chokidar";
import { kill, restart, start } from "./retrystart.js";
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

watcher.once("ready", () => {
  watcher.on("all", () => {
    restart();
  });
});

["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT", "SIGBREAK", "SIGKILL"].forEach(
  (signal) => {
    process.on(signal, () => {
      kill();
      process.exit();
    });
  }
);
