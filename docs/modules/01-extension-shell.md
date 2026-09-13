> This module is part of the Bionic Reader extension. It will be integrated with the other modules at the end.
> See `docs/README.md` for the full module list.

---
### Module 1 — Extension Shell / Manifest (`manifest.json`)

**Purpose**
Declare the extension's identity, permissions, entry points, and content security policy for MV3. It is the gatekeeper: everything else is unreachable unless it is correctly registered here.

**Files**
- `manifest.json`
- `icons/icon16.png`, `icons/icon32.png`, `icons/icon48.png`, `icons/icon128.png`

**Key fields & rationale**

```json
{
  "manifest_version": 3,
  "name": "Bionic Reader for PDF",
  "version": "1.0.0",
  "permissions": ["storage", "declarativeNetRequest", "declarativeNetRequestWithHostAccess"],
  "host_permissions": ["http://*/*", "https://*/*", "file:///*"],
  "background": { "service_worker": "background.js", "type": "module" },
  "action": { "default_popup": "pages/popup.html" },
  "options_page": "pages/options.html",
  "web_accessible_resources": [
    { "resources": ["pages/viewer.html", "vendor/pdfjs/*"], "matches": ["<all_urls>"] }
  ],
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["src/security.js", "src/messages.js", "src/pdf-router.js"],
      "run_at": "document_idle",
      "all_frames": true
    }
  ],
  "declarative_net_request": {
    "rule_resources": [{ "id": "pdf_rules", "enabled": true, "path": "rules/rules.json" }]
  },
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'; worker-src 'self'"
  }
}
```

- **`storage`** — persist user settings.
- **`declarativeNetRequest` + host permissions** — rewrite/redirect navigations whose destination is a PDF so they open in our viewer. `host_permissions` grants read access needed to detect `application/pdf` responses; `file://` is included but requires the user to enable "Allow access to file URLs" manually.
- **`content_scripts` run at `document_idle` in all frames** — intercept `<a href="*.pdf">` downloads and anchors and `<embed>`/`<iframe>` elements before they load.
- **CSP `script-src 'self'`** — no remote scripts; PDF.js must be vendored.

**Inputs**
None (static declaration). Read by Chrome at install time.

**Outputs**
A registered extension with correct entry points.

**Dependencies**
None (foundation module).

**Acceptance Criteria**
- `chrome://extensions` loads the extension without manifest errors.
- Popup, options page, and viewer page are all reachable.
- CSP blocks remote scripts; vendored `pdf.mjs` still loads (bundled as `'self'`).
- Installing the extension does not throw permission warnings beyond `file://` (which is justified in the options page).

---
