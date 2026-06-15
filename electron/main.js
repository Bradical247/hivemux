// amux desktop shell. Thin Electron wrapper: spawns the bundled `amux web`
// server on loopback, then loads the dashboard in a native window. The amux and
// ttyd binaries ride along as packaged resources (see electron-builder config),
// so the installed app is self-contained — no separate amux/ttyd install needed.
const { app, BrowserWindow, shell } = require("electron");
const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");

const PORT = Number(process.env.AMUX_GUI_PORT || 7878);
let server = null;
let win = null;

function resourceBin(name) {
  const base = app.isPackaged ? process.resourcesPath : path.join(__dirname, "resources");
  return path.join(base, name);
}

function waitForPort(port, onReady) {
  const attempt = () => {
    const sock = net.connect(port, "127.0.0.1");
    sock.once("connect", () => {
      sock.destroy();
      onReady();
    });
    sock.once("error", () => setTimeout(attempt, 150));
  };
  attempt();
}

function start() {
  const amux = resourceBin("amux");
  const ttydDir = path.dirname(resourceBin("ttyd"));
  // Put the bundled ttyd on PATH so amux's embedded terminals find it.
  const env = { ...process.env, PATH: `${ttydDir}:${process.env.PATH}` };
  server = spawn(amux, ["web", "--port", String(PORT), "--host", "127.0.0.1"], {
    env,
    stdio: "ignore",
  });

  win = new BrowserWindow({
    width: 1280,
    height: 820,
    title: "amux",
    backgroundColor: "#0d1117",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "icon.png"),
  });

  // External links open in the real browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  waitForPort(PORT, () => win && win.loadURL(`http://127.0.0.1:${PORT}/`));
}

app.whenReady().then(start);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) start();
});

function shutdown() {
  if (server) server.kill();
  server = null;
}
app.on("window-all-closed", () => {
  shutdown();
  app.quit();
});
app.on("quit", shutdown);
