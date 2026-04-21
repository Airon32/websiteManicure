const { spawn } = require("child_process");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const frontendArgs = process.argv.slice(2);
const nodeCommand = process.execPath;
const backendEntry = path.join(rootDir, "backend", "server.js");
const viteEntry = path.join(rootDir, "frontend", "node_modules", "vite", "bin", "vite.js");

const services = [
  {
    name: "backend",
    command: nodeCommand,
    args: [backendEntry],
    cwd: path.join(rootDir, "backend"),
  },
  {
    name: "frontend",
    command: nodeCommand,
    args: [viteEntry, ...frontendArgs],
    cwd: path.join(rootDir, "frontend"),
  },
];

const children = [];
let shuttingDown = false;

function stopChildren(signal = "SIGTERM") {
  for (const child of children) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
}

for (const service of services) {
  console.log(`[root] iniciando ${service.name}...`);

  const child = spawn(service.command, service.args, {
    cwd: service.cwd,
    stdio: "inherit",
    env: process.env,
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;

    const reason = signal ? `sinal ${signal}` : `codigo ${code}`;
    console.error(`[root] ${service.name} encerrou com ${reason}.`);
    stopChildren();
    process.exit(code ?? 1);
  });

  child.on("error", (error) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.error(`[root] falha ao iniciar ${service.name}:`, error.message);
    stopChildren();
    process.exit(1);
  });

  children.push(child);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.log("\n[root] encerrando frontend e backend...");
    stopChildren(signal);
    process.exit(0);
  });
}
