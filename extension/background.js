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
    // Fetch using the extension's host permissions (<all_urls>) so CORS headers
    // on the favicon server are irrelevant.
    const response = await fetch(url);
    if (!response.ok) throw new Error(`fetch ${url}: ${response.status}`);
    const blob = await response.blob();

    // Load via a blob URL so the canvas isn't tainted (blob: is same-origin),
    // and use a DOM Image so the browser's native decoder handles all formats
    // (SVG, ICO, WebP, ...) correctly.  SVGs often have naturalWidth==0 when
    // they carry only a viewBox, so we fall back to 64 in that case.
    const objectUrl = URL.createObjectURL(blob);
    try {
        return await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const w = img.naturalWidth  || 64;
                const h = img.naturalHeight || 64;
                const canvas = document.createElement('canvas');
                canvas.width  = w;
                canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                canvas.toBlob(pngBlob => {
                    if (!pngBlob) { reject(new Error('toBlob returned null')); return; }
                    pngBlob.arrayBuffer().then(buf => {
                        let s = '';
                        for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
                        resolve(btoa(s));
                    }).catch(reject);
                }, 'image/png');
            };
            img.onerror = () => reject(new Error(`image load failed: ${url}`));
            img.src = objectUrl;
        });
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
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
