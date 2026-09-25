// Module 2 — Background Service Worker.
// Maintains global enabled/disabled state, coordinates inter-module messaging,
// detects PDF main-frame navigations, and opens the Bionic viewer in a NEW tab
// (never in place of the page the user navigated to) for a given PDF URL.

// Shared protocol (Module 11) and security/URL validation (Module 12) are
// imported as side-effect ES modules. They attach to globalThis.BR (they are
// UMD-style classic scripts that also work as CommonJS for Node tests). This
// keeps message types, default settings, and URL-validation rules in exactly
// one place per concern.
import './src/messages.js';
import './src/security.js';

const BR = globalThis.BR || {};
const { MessageType, ResponseType, DEFAULT_SETTINGS, SettingKey } = BR.Messages || {};
const Security = BR.Security || {};

// Keys whose values are persisted individually via setSetting.
const SETTING_KEYS = SettingKey || Object.freeze(['enabled', 'fixationPercent', 'strength', 'style', 'routePdfs']);

// URL validation helpers (Module 12). We bind the pure functions used by this
// worker so the rest of the file can call them as locals.
const looksLikePdf = Security.looksLikePdf || (() => false);
const sanitizePdfUrl = Security.sanitizePdfUrl || ((u) => (typeof u === 'string' ? u : null));

// ---- Settings management ---------------------------------------------------
async function getSettings() {
  try {
    const stored = await chrome.storage.sync.get(Array.from(SETTING_KEYS));
    const merged = { ...DEFAULT_SETTINGS };
    for (const key of SETTING_KEYS) {
      if (stored[key] !== undefined) merged[key] = stored[key];
    }
    return sanitizeSettings(merged);
  } catch (err) {
    // Malformed storage must never crash the worker -> fall back to defaults.
    return { ...DEFAULT_SETTINGS };
  }
}

function sanitizeSettings(raw) {
  const out = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return out;
  if (typeof raw.enabled === 'boolean') out.enabled = raw.enabled;
  if (typeof raw.routePdfs === 'boolean') out.routePdfs = raw.routePdfs;
  if (typeof raw.fixationPercent === 'number' && Number.isFinite(raw.fixationPercent)) {
    out.fixationPercent = Math.min(100, Math.max(0, Math.round(raw.fixationPercent)));
  }
  if (typeof raw.strength === 'number' && Number.isFinite(raw.strength)) {
    out.strength = Math.min(4, Math.max(0, Math.round(raw.strength)));
  }
  if (['stroke', 'highlight', 'shadow'].includes(raw.style)) out.style = raw.style;
  return out;
}

async function setSetting(key, value) {
  if (!SETTING_KEYS.includes(key)) {
    return { type: ResponseType.ERROR, error: `Unknown setting key: ${key}` };
  }
  const current = await getSettings();
  const next = { ...current, [key]: value };
  const sanitized = sanitizeSettings(next);
  try {
    await chrome.storage.sync.set({ [key]: sanitized[key] });
  } catch (err) {
    return { type: ResponseType.ERROR, error: `Failed to persist setting: ${err && err.message}` };
  }
  return { type: ResponseType.OK, key, value: sanitized[key], settings: sanitized };
}

// Cache the latest settings so enabled/routePdfs checks are instant without a
// storage round-trip on the hot path. Refreshed on install, on every write, and
// on storage changes from any context.
let settingsCache = null;

async function refreshSettingsCache() {
  settingsCache = await getSettings();
  return settingsCache;
}

function isEnabled() {
  return settingsCache ? settingsCache.enabled : DEFAULT_SETTINGS.enabled;
}


// ---- Direct-navigation routing ---------------------------------------------
// Direct PDF navigations (typed URL, bookmark, redirect, window.location) are
// detected by the webNavigation / tabs.onUpdated listeners below and open the
// Bionic viewer in a NEW tab, leaving the original navigation untouched. The
// viewer must never replace the originating tab, so no declarativeNetRequest
// redirect rule is registered.
//
// A stale dynamic rule from older versions is removed once on install/update.
const LEGACY_DNR_RULE_ID = 1;

async function removeLegacyDnrRule() {
  if (!chrome.declarativeNetRequest || !chrome.declarativeNetRequest.updateDynamicRules) return false;
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [LEGACY_DNR_RULE_ID] });
    return true;
  } catch (err) {
    // DNR may be unavailable (permission config); never let it crash the worker.
    console.warn('Bionic Reader: could not clear legacy routing rule', err);
    return false;
  }
}

// Called on install / update and after any toggle. With in-place redirects gone
// there is no rule state to sync, but the cache is refreshed so the navigation
// listeners see the latest enabled/routePdfs values immediately.
async function syncRoutingState() {
  await refreshSettingsCache();
}


// ---- Viewer opening / routing ----------------------------------------------
function buildViewerUrl(pdfUrl) {
  const extensionId = chrome.runtime.id;
  return `chrome-extension://${extensionId}/pages/viewer.html?url=${encodeURIComponent(pdfUrl)}`;
}

// Find an existing viewer tab showing the same PDF URL, if any.
async function findExistingViewerTab(viewerUrl) {
  try {
    if (!chrome.tabs || !chrome.tabs.query) return null;
    // Query without a match-pattern argument: the viewer URL contains a query
    // string, and comparing exact URLs avoids match-pattern parsing quirks.
    const tabs = await chrome.tabs.query({});
    return tabs.find((tab) => tab && tab.url === viewerUrl) || null;
  } catch (err) {
    return null;
  }
}

// Open (or focus) the Bionic viewer in a NEW tab for a PDF URL. The originating
// tab is never navigated or replaced.
//
// inNewWindow: create the viewer as the first tab of a separate browser window
//              instead of the current window.
async function openBionicViewer(pdfUrl, { focus = true, inNewWindow = false } = {}) {
  const viewerUrl = buildViewerUrl(pdfUrl);

  // Reuse an existing viewer tab for the same PDF instead of piling up tabs.
  const existing = await findExistingViewerTab(viewerUrl);
  if (existing) {
    if (focus && existing.id !== undefined) {
      try {
        await chrome.tabs.update(existing.id, { active: true });
        if (existing.windowId !== undefined && chrome.windows && chrome.windows.update) {
          await chrome.windows.update(existing.windowId, { focused: true });
        }
      } catch (err) { /* focusing is best-effort */ }
    }
    return { type: ResponseType.OK, tabId: existing.id, reused: true };
  }

  if (inNewWindow && chrome.windows && chrome.windows.create) {
    const win = await chrome.windows.create({ url: viewerUrl, focused: focus });
    const tab = win && win.tabs && win.tabs[0];
    return { type: ResponseType.OK, tabId: tab && tab.id, windowId: win && win.id };
  }

  const tab = await chrome.tabs.create({ url: viewerUrl, active: focus });
  return { type: ResponseType.OK, tabId: tab.id };
}

// Validate + sanitize the PDF URL before opening (inline Module 12 logic).
async function routePdf(pdfUrl, { source = 'nav' } = {}) {
  const clean = sanitizePdfUrl(pdfUrl);
  if (!clean || !looksLikePdf(clean)) {
    return { type: ResponseType.ERROR, error: 'Not a routable PDF URL', source };
  }
  // Only honor manual routing when the extension is enabled AND routing is on.
  if (source !== 'nav') {
    const s = settingsCache || await getSettings();
    if (!s.enabled || !s.routePdfs) {
      return { type: ResponseType.ERROR, error: 'Routing disabled', source };
    }
  }
  try {
    return await openBionicViewer(clean, { focus: true });
  } catch (err) {
    return { type: ResponseType.ERROR, error: `Failed to open viewer: ${err && err.message}`, source };
  }
}


// ---- Message dispatcher ------------------------------------------------------
// Central handler for popup / options / content-script messages. Every path
// returns a typed response (ok | error) so senders are never left hanging.
async function handleMessage(msg) {
  if (!msg || typeof msg !== 'object') {
    return { type: ResponseType.ERROR, error: 'Malformed message' };
  }

  switch (msg.type) {
    case MessageType.GET_SETTINGS:
      return { type: ResponseType.OK, settings: await getSettings() };

    case MessageType.SET_SETTING:
      // Guard against malformed payloads before delegating.
      if (msg.key === undefined) {
        return { type: ResponseType.ERROR, error: 'SET_SETTING requires a key' };
      }
      return await setSetting(msg.key, msg.value);

    case MessageType.TOGGLE_ENABLED:
      {
        const cur = await getSettings();
        const next = !cur.enabled;
        const res = await setSetting('enabled', next);
        if (res.type === ResponseType.OK) await syncRoutingState();
        return res;
      }

    case MessageType.OPEN_PDF:
      if (typeof msg.url !== 'string' || msg.url.length === 0) {
        return { type: ResponseType.ERROR, error: 'OPEN_PDF requires a url' };
      }
      return await routePdf(msg.url, { source: 'message', ...(msg.options || {}) });

    case MessageType.ROUTE_PDF:
      if (typeof msg.url !== 'string' || msg.url.length === 0) {
        return { type: ResponseType.ERROR, error: 'ROUTE_PDF requires a url' };
      }
      return await routePdf(msg.url, { source: msg.source || 'nav' });

    default:
      return { type: ResponseType.ERROR, error: `Unknown message type: ${msg.type}` };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Wrap in a promise so async work keeps the responder alive; every outcome is
  // a typed, JSON-serializable response. Return true to keep the channel open.
  handleMessage(msg, sender)
    .then(sendResponse)
    .catch((err) => sendResponse({ type: ResponseType.ERROR, error: String(err && err.message || err) }));
  return true;
});

// Keep the shared cache coherent when settings change from any context (popup,
// options page, other extension windows).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes) refreshSettingsCache();
});


// ---- Navigation routing (webNavigation / tabs.onUpdated) --------------------
// Opens the viewer in a NEW tab for PDF main-frame navigations when enabled,
// leaving the originating tab on its original URL. The viewer never replaces
// the page the user navigated to.
//
// NOTE: the manifest (Module 1) does not currently grant the 'webNavigation'
// permission, so these listeners are registered only if the API is available;
// otherwise fall back to tabs.onUpdated which needs no extra permission.

function isViewerUrl(url) {
  return typeof url === 'string' && url.startsWith('chrome-extension://');
}

async function maybeRouteNavigation(url) {
  if (!url || isViewerUrl(url)) return false;           // never loop viewer pages
  const clean = sanitizePdfUrl(url);
  if (!clean || !looksLikePdf(clean)) return false;
  const s = settingsCache || await getSettings();
  if (!s.enabled || !s.routePdfs) return false;
  await openBionicViewer(clean, { focus: true });
  return true;
}

function onBeforeNavigate(details) {
  // Only act on top-level main-frame navigations.
  if (details.frameId !== 0 && details.frameId !== undefined) return;
  // This callback cannot cancel a navigation (that requires the blocking
  // webRequest API), so instead of redirecting we open the viewer in a new tab
  // and leave the original navigation completely alone.
  maybeRouteNavigation(details.url).catch(() => {});
}

// tabs.onUpdated fallback: catch main-frame PDF navigations via URL changes.
// Works with only the "tabs" permission, which the manifest grants implicitly
// via host_permissions; if 'tabs' is unavailable the listener no-ops.
async function onTabUpdated(tabId, changeInfo, tab) {
  if (!tab || tab.url === undefined) return;
  if (changeInfo.status === 'loading' && tab.url && !isViewerUrl(tab.url)) {
    const clean = sanitizePdfUrl(tab.url);
    if (clean && looksLikePdf(clean)) {
      const s = settingsCache || await getSettings();
      if (s.enabled && s.routePdfs) {
        // Open the viewer in a separate tab; never navigate this tab away.
        await openBionicViewer(clean, { focus: true });
      }
    }
  }
}

// ---- Lifecycle wiring -------------------------------------------------------
chrome.runtime.onInstalled.addListener(async (details) => {
  // Seed defaults only on a fresh install (never clobber user data on update).
  if (details && details.reason === 'install') {
    try {
      const stored = await chrome.storage.sync.get(Array.from(SETTING_KEYS));
      const needsSeeding = SETTING_KEYS.some((k) => stored[k] === undefined);
      if (needsSeeding) {
        await chrome.storage.sync.set({ ...DEFAULT_SETTINGS });
      }
    } catch (err) {
      console.warn('Bionic Reader: could not seed settings', err);
    }
  }
  await refreshSettingsCache();
  // Clear any dynamic redirect rule left by older versions: the viewer now
  // opens in a new tab, so an in-place redirect must never be active.
  await removeLegacyDnrRule();
  await syncRoutingState();
});

// Register navigation listeners if the (optional) webNavigation API exists.
if (chrome.webNavigation && typeof chrome.webNavigation.onBeforeNavigate.addListener === 'function') {
  chrome.webNavigation.onBeforeNavigate.addListener(onBeforeNavigate);
} else {
  // Fallback needs only the tabs API for reading tab URLs.
  if (chrome.tabs && typeof chrome.tabs.onUpdated.addListener === 'function') {
    chrome.tabs.onUpdated.addListener(onTabUpdated);
  }
}

// Warm the cache so isEnabled() and routing decisions work immediately.
refreshSettingsCache();

