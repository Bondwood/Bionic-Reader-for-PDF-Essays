// Module 2 — Background Service Worker.
// Maintains global enabled/disabled state, coordinates inter-module messaging,
// decides when to redirect PDF navigations, and opens the Bionic viewer for a
// given PDF URL.

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


// ---- DeclarativeNetRequest routing rule ------------------------------------
// A dynamic redirect rule that sends main-frame .pdf navigations to the Bionic
// viewer. A dynamic rule is used (instead of the static rules/rules.json) so the
// extension ID can be substituted at runtime; rules.json is currently empty and
// is owned by Module 3.
const DNR_RULE_ID = 1;

function buildDnrRule() {
  const extensionId = chrome.runtime.id;
  return {
    id: DNR_RULE_ID,
    priority: 1,
    action: {
      type: 'redirect',
      redirect: {
        // \\0 === the matched URL, substituted into the viewer query param.
        regexSubstitution: `chrome-extension://${extensionId}/pages/viewer.html?url=\\0`
      }
    },
    condition: {
      regexFilter: '^(?:https?|file)://.*\\.pdf(?:\\?[^#]*)?$',
      resourceTypes: ['main_frame']
    }
  };
}

async function registerDnrRule() {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [DNR_RULE_ID],
      addRules: [buildDnrRule()]
    });
    return true;
  } catch (err) {
    // DNR can fail (e.g. permission config); never let it crash the worker.
    console.warn('Bionic Reader: could not register DNR rule', err);
    return false;
  }
}

async function setDnrRuleEnabled(enabled) {
  try {
    await chrome.declarativeNetRequest.updateEnabledRules({
      disableRuleIds: enabled ? [] : [DNR_RULE_ID],
      enableRuleIds: enabled ? [DNR_RULE_ID] : []
    });
  } catch (err) {
    console.warn('Bionic Reader: could not update DNR rule enabled state', err);
  }
}

// Called on install / update and after any toggle: keeps the DNR rule's enabled
// state in sync with the user's routing preference.
async function syncRoutingState() {
  await refreshSettingsCache();
  const s = settingsCache || DEFAULT_SETTINGS;
  await setDnrRuleEnabled(!!s.enabled && !!s.routePdfs);
}


// ---- Viewer opening / routing ----------------------------------------------
function buildViewerUrl(pdfUrl) {
  const extensionId = chrome.runtime.id;
  return `chrome-extension://${extensionId}/pages/viewer.html?url=${encodeURIComponent(pdfUrl)}`;
}

// Open (or focus) the Bionic viewer tab for a PDF URL.
async function openBionicViewer(pdfUrl, { focus = true } = {}) {
  const viewerUrl = buildViewerUrl(pdfUrl);
  const tabs = await chrome.tabs.query({ url: viewerUrl });
  if (tabs && tabs.length > 0) {
    if (focus) await chrome.tabs.update(tabs[0].id, { active: true });
    return { type: ResponseType.OK, tabId: tabs[0].id };
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
// Directs PDF main-frame navigations to the viewer when enabled.
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
  await openBionicViewer(clean, { focus: false });
  return true;
}

function onBeforeNavigate(details) {
  // Only act on top-level main-frame navigations.
  if (details.frameId !== 0 && details.frameId !== undefined) return;
  // Guard: this callback cannot cancel a navigation from onBeforeNavigate
  // (that requires webNavigationBlocking), so we open the viewer in a new tab
  // and leave the original navigation alone when it isn't a viewer page. This
  // keeps routing safe without a blocking API.
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
        // Open the viewer; do not navigate the current tab away (avoids loop).
        await openBionicViewer(clean, { focus: false });
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
  // Register the DNR rule once, then sync its enabled state.
  await registerDnrRule();
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

