/**
 * Development launcher — starts Next.js dev server AND the capture worker
 * as parallel child processes. Handles graceful shutdown of both.
 *
 * Usage: npx tsx scripts/dev-with-capture.ts
 */

import { spawn, type ChildProcess } from "child_process";

const children: ChildProcess[] = [];

function log(tag: string, msg: string) {
  const ts = new Date().toLocaleTimeString("en-GB", { hour12: false });
  const colors: Record<string, string> = {
    next: "\x1b[36m",    // cyan
    capture: "\x1b[33m", // yellow
    system: "\x1b[32m",  // green
  };
  const color = colors[tag] ?? "\x1b[0m";
  const reset = "\x1b[0m";
  console.log(`${color}[${ts}] [${tag}]${reset} ${msg}`);
}

function startProcess(name: string, command: string, args: string[]): ChildProcess {
  log("system", `Starting ${name}...`);

  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    cwd: process.cwd(),
    env: { ...process.env, FORCE_COLOR: "1" },
  });

  child.stdout?.on("data", (data: Buffer) => {
    const lines = data.toString().trim().split("\n");
    for (const line of lines) {
      if (line.trim()) log(name, line);
    }
  });

  child.stderr?.on("data", (data: Buffer) => {
    const lines = data.toString().trim().split("\n");
    for (const line of lines) {
      if (line.trim()) log(name, line);
    }
  });

  child.on("exit", (code, signal) => {
    log("system", `${name} exited (code=${code}, signal=${signal})`);
  });

  children.push(child);
  return child;
}

// Start both processes
startProcess("next", "npx", ["next", "dev"]);

// Delay capture worker slightly to let Prisma warm up
setTimeout(() => {
  startProcess("capture", "npx", ["tsx", "scripts/capture-worker.ts"]);
}, 3000);

// Graceful shutdown
function shutdown(signal: string) {
  log("system", `Received ${signal} — shutting down...`);
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
  setTimeout(() => {
    log("system", "Force killing remaining processes...");
    for (const child of children) {
      if (!child.killed) child.kill("SIGKILL");
    }
    process.exit(0);
  }, 5000);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
