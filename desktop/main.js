// Kerbside as a standalone app (Electron): the same site, in a window of its own.
//
// What it gives over a browser tab: its own process and memory, apart from every other tab and
// extension; never slowed down in the background or behind another window; the
// high-performance GPU asked for, with a quarter of the machine's memory for it (Apple silicon
// shares it); a page that crashes is loaded again.
//
// What it does not: the page's script heap is still about 4 GiB. Electron's V8, like Chrome's,
// is built with pointer compression, which caps a page's heap there whatever --max-old-space-size
// says (measured 2026-11-11, Electron 44: jsHeapSizeLimit 4.09 GiB with 8 GiB asked for). The
// page's memory governor (module 28) keeps working to that limit; more room than that means the
// page holding less, or its work split across workers (each has a heap of its own).
//
//   npm start                      the live site (https://spatial-data-mapping.vercel.app)
//   npm run local                  a local server (http://localhost:8771/app-model.html)
//   electron . --url=<page>        any page of the site
//   npm run package                Kerbside.app in out/ (macOS, Apple silicon)
"use strict";

const { app, BrowserWindow, Menu, shell, session } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SITE = "https://spatial-data-mapping.vercel.app/app-model.html";
const argValue = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const START = argValue("url") || process.env.KERBSIDE_URL || SITE;

//: The page's own hosts: navigation stays in the app there, anything else opens in the browser,
//: and only they are given what they ask for (pointer lock, full screen, location, the mic).
const TRUSTED = new Set([
  "https://spatial-data-mapping.vercel.app",
  "https://djllcgon03ax2.cloudfront.net",
  new URL(START).origin,
]);
const trusted = (url) => {
  try {
    const u = new URL(url);
    return TRUSTED.has(u.origin) || u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch { return false; }
};
const PERMISSIONS = new Set(["pointerLock", "fullscreen", "geolocation", "media", "clipboard-read", "clipboard-sanitized-write", "notifications"]);

// ---- memory and GPU: before the app is ready ---------------------------------------------------
const totalMiB = Math.floor(os.totalmem() / 1048576);
//: As much script heap as V8 allows (it stops at about 4 GiB: see above), asked for in full.
const heapMiB = Math.max(4096, Math.min(16384, Math.floor(totalMiB / 2)));
app.commandLine.appendSwitch("js-flags", `--max-old-space-size=${heapMiB}`);
// Apple silicon's memory is the GPU's too: a quarter of it for textures and buffers.
app.commandLine.appendSwitch("force-gpu-mem-available-mb", String(Math.max(2048, Math.floor(totalMiB / 4))));
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-zero-copy");
app.commandLine.appendSwitch("force_high_performance_gpu");
// Never slowed down behind another window or in the background.
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.setName("Kerbside");

// ---- the window --------------------------------------------------------------------------------
const STATE = () => path.join(app.getPath("userData"), "window.json");
function savedBounds() {
  try { return JSON.parse(fs.readFileSync(STATE(), "utf8")); } catch { return { width: 1440, height: 900 }; }
}

let win = null;
function open() {
  const bounds = savedBounds();
  win = new BrowserWindow({
    ...bounds,
    minWidth: 640, minHeight: 480,
    title: "Kerbside",
    backgroundColor: "#0b1016",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
      partition: "persist:kerbside",
    },
  });
  if (bounds.maximized) win.maximize();
  win.once("ready-to-show", () => win.show());
  const keep = () => {
    if (!win || win.isDestroyed()) return;
    try { fs.writeFileSync(STATE(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() })); } catch { /* read-only */ }
  };
  win.on("close", keep);
  win.on("closed", () => { win = null; });
  // Links off the site open in the browser; the site's own pages stay here.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (trusted(url)) return { action: "allow", overrideBrowserWindowOptions: { backgroundColor: "#0b1016" } };
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (trusted(url)) return;
    event.preventDefault();
    if (/^https?:/.test(url)) shell.openExternal(url);
  });
  // A page that crashed or hung is loaded again rather than left blank.
  win.webContents.on("render-process-gone", (_event, details) => {
    console.warn(`kerbside: the page ended (${details.reason}); loading it again`);
    if (details.reason !== "clean-exit" && win && !win.isDestroyed()) setTimeout(() => win.loadURL(START), 800);
  });
  win.loadURL(START);
}

function menu() {
  const mac = process.platform === "darwin";
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(mac ? [{ role: "appMenu" }] : []),
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" }, { role: "forceReload" }, { role: "toggleDevTools" }, { type: "separator" },
        { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Kerbside",
      submenu: [
        { label: "Open the live site", click: () => win?.loadURL(SITE) },
        { label: "Open in the browser", click: () => win && shell.openExternal(win.webContents.getURL()) },
      ],
    },
    { role: "windowMenu" },
  ]));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    const ses = session.fromPartition("persist:kerbside");
    ses.setPermissionRequestHandler((wc, permission, done, details) => done(PERMISSIONS.has(permission) && trusted(details.requestingUrl || wc.getURL())));
    ses.setPermissionCheckHandler((_wc, permission, origin) => PERMISSIONS.has(permission) && trusted(origin));
    menu();
    open();
    app.on("activate", () => { if (!win) open(); });
  });
  app.on("window-all-closed", () => app.quit());
}

