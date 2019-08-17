"use strict";

const { app } = require("electron");

const Clipboard = require("./src/clipboard");
const TrayHandler = require("./src/tray-handler");

app.on("ready", () => {
    const clipboard = new Clipboard();
    new TrayHandler({
        clipboard,
        app
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});