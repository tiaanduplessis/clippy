"use strict";

const path = require("path");
const { nativeImage, Menu, Tray } = require("electron");

function TrayHandler({ clipboard, app } = {}) {
  const image = nativeImage.createFromPath(path.join(__dirname, "tray.png"));
  image.setTemplateImage(true);

  const appIcon = new Tray(image);

  function handleUpdate(data) {
    const updatedContextMenu = data.map((item) => {
      const displayItem = item.length > 40 ? item.substring(0, 37) + "…" : item;
      return {
        label: displayItem,
        click: () => clipboard.set(item),
        position: "endof=clipboarditems"
      };
    });

    updatedContextMenu.push({
      label: "Clear history",
      click: () => clipboard.clear(),
      position: "endof=actions"
    }, {
      label: "Quit",
      click: () => app.quit(),
      position: "endof=actions"
    })

    appIcon.setContextMenu(Menu.buildFromTemplate(updatedContextMenu));
  }

  clipboard.on("update", handleUpdate);
  appIcon.setToolTip("Clippy");
}

module.exports = TrayHandler;