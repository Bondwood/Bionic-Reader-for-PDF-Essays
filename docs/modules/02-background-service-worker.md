> This module is part of the Bionic Reader extension. It will be integrated with the other modules at the end.
> See `docs/README.md` for the full module list.

---
### Module 2 — Background Service Worker (`background.js`)

**Purpose**
Maintain global enabled/disabled state, coordinate inter-module messaging, decide when to redirect PDF navigations, and open the Bionic viewer for a given PDF URL.

**Files**
- `background.js`

**Key functions**

```js
// Called on install/update: seed defaults and register DNR rules.
chrome.runtime.onInstalled.addListener(async (details) => { ... });

// Central message dispatcher for popup/options/content scripts.
chrome.runtime.onMessage.addListener(
  (msg, sender, sendResponse) => { ... return true; } // async keep-alive
);

async function getSettings();                    // -> Settings (from chrome.storage.sync)
async function setSetting(key, value);           // persist one setting (validated)
function isEnabled();                            // -> boolean shortcut

// Open (or focus) the Bionic viewer tab for a PDF URL.
async function openBionicViewer(pdfUrl, { focus = true } = {});

// Build viewer URL: chrome-extension://<id>/pages/viewer.html?url=<encoded>
function buildViewerUrl(pdfUrl);

// Validate + sanitize the PDF URL before opening (delegates to security.js).
function routePdf(pdfUrl, { source = 'nav' } = {});

// Handle chrome.tabs.onUpdated / chrome.webNavigation.onBeforeNavigate events
// that indicate a PDF destination; apply routing decision.
chrome.webNavigation.onBeforeNavigate.addListener(onBeforeNavigate);
```

**Inputs**
- Extension lifecycle events.
- Runtime messages: `OPEN_PDF`, `TOGGLE_ENABLED`, `GET_SETTINGS`, `SET_SETTING`, `ROUTE_PDF`.
- Navigation events (`webNavigation.onBeforeNavigate`, `tabs.onUpdated`).

**Outputs**
- Redirected or cancelled navigations opening `viewer.html`.
- Replies to all message senders with typed, validated responses.
- Persisted settings changes.

**Dependencies**
- Module 1 (manifest permissions), Module 11 (`messages.js` protocol), Module 12 (`security.js` validation).
- `src/pdf-router.js` for rule-context decisions.

**Acceptance Criteria**
- Flipping the enable toggle instantly affects routing.
- `chrome.storage.sync` defaults are seeded on first install.
- Malformed shared state does not crash the worker; every `onMessage` path returns a typed response (or an error type).
- Service worker stays non-persistent (no long timers, no blocking work on the hot path).

---
