'use strict';

const NATIVE_HOST = 'sway_favicon';
let nativePort = null;

function getPort() {
    if (!nativePort) {
        nativePort = browser.runtime.connectNative(NATIVE_HOST);
        nativePort.onDisconnect.addListener(() => { nativePort = null; });
    }
    return nativePort;
}

async function iconToBase64PNG(url) {
    if (!url) return null;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`fetch ${url}: ${response.status}`);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    const w = bitmap.width  || 16;
    const h = bitmap.height || 16;
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    const pngBlob = await canvas.convertToBlob({ type: 'image/png' });
    const buf = await pngBlob.arrayBuffer();
    let binary = '';
    for (const b of new Uint8Array(buf)) binary += String.fromCharCode(b);
    return btoa(binary);
}

async function sendIconForWindow(windowId, favIconUrl) {
    if (!favIconUrl) return;
    try {
        const b64 = await iconToBase64PNG(favIconUrl);
        if (b64) getPort().postMessage({ windowId, icon: b64 });
    } catch (_) {
        // Native host not installed, unsupported image type, etc.
    }
}

// Set titlePreface so sway can identify this Firefox window by its WM title,
// then immediately send the active tab's icon.
async function initWindow(windowId) {
    await browser.windows.update(windowId, { titlePreface: `[fx:${windowId}] ` });
    const [tab] = await browser.tabs.query({ windowId, active: true });
    if (tab?.favIconUrl) await sendIconForWindow(windowId, tab.favIconUrl);
}

browser.windows.onCreated.addListener(win => initWindow(win.id));

// Active tab changed in a window — icon should reflect the new tab's favicon.
// Small delay to let Firefox propagate the updated Wayland title to sway first.
browser.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
    await new Promise(r => setTimeout(r, 150));
    try {
        const tab = await browser.tabs.get(tabId);
        await sendIconForWindow(windowId, tab.favIconUrl);
    } catch (_) {}
});

// Favicon updated on an already-open tab — only matters if it's currently active.
browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (!('favIconUrl' in changeInfo) || !tab.active) return;
    await sendIconForWindow(tab.windowId, changeInfo.favIconUrl);
});

// Initialize all windows already open when the extension loads.
browser.windows.getAll({ populate: false }).then(wins => {
    for (const win of wins) initWindow(win.id);
});
