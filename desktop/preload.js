// What the page may know of the app it runs in (window.kerbsideDesktop): that it is the
// standalone app, and how much memory the machine has. Nothing else crosses over.
"use strict";

const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("kerbsideDesktop", Object.freeze({
  app: "kerbside-desktop",
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  platform: process.platform,
}));
