'use strict'

const {app} = require('electron')

const Clipboard = require('./src/clipboard')
const TrayHandler = require('./src/tray-handler')

function onReady() {
    const clipboard = new Clipboard()
    new TrayHandler({
        clipboard,
        app
    })
}

app.on('ready', onReady)

app.on('window-all-closed', function() {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})
