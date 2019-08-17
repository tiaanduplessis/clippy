"use strict";

const { clipboard } = require("electron");
const EventEmitter = require("events").EventEmitter;

const UPDATE_INTERVAL = 1000;

class Clipboard extends EventEmitter {
  constructor(interval = UPDATE_INTERVAL) {
    super();

    this.items = [];

    this.clear = this.clear.bind(this);
    this.update = this.update.bind(this);

    setInterval(this.update, interval);
  }

  update() {
    const currentItem = clipboard.readText();

    if (!(this.items[this.items.length - 1] === currentItem)) {
      this.items.push(currentItem);
      this.emit("update", this.items);
    }
  }

  set(text) {
    clipboard.writeText(text);
  }

  clear(text) {
    this.items = [];
    this.emit("update", this.items);
  }
}

module.exports = Clipboard;