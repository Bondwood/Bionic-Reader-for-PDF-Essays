// Module - Popup UI.
// Provides a quick enable/disable toggle, a shortcut to the options page, and a
// "open PDF in viewer" action for a URL pasted/entered by the user. Talks to the
// background worker (Module 2) via the shared message protocol (Module 11).

(function () {
  'use strict';

  const BR = window.BR || {};
  const { MessageType, ResponseType, DEFAULT_SETTINGS } = BR.Messages || {};

  const enabledEl = document.getElementById('enabled');
  const stateEl = document.getElementById('state');
  const openEl = document.getElementById('open-viewer');
  const optionsEl = document.getElementById('options');

  let current = { ...(DEFAULT_SETTINGS || {}) };

  function setState() {
    const on = !!current.enabled;
    enabledEl.checked = on;
    stateEl.textContent = on ? 'ON' : 'OFF';
    stateEl.className = 'state ' + (on ? 'on' : 'off');
  }

  function send(msg) {
    return new Promise((resolve) => {
      if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
        resolve({ type: ResponseType && ResponseType.ERROR, error: 'Extension runtime unavailable' });
        return;
      }
      try {
        chrome.runtime.sendMessage(msg, (res) => resolve(res || {}));
      } catch (err) {
        resolve({ type: ResponseType && ResponseType.ERROR, error: String((err && err.message) || err) });
      }
    });
  }

  async function loadSettings() {
    const res = await send({ type: MessageType && MessageType.GET_SETTINGS });
    if (res && res.type === (ResponseType && ResponseType.OK) && res.settings && typeof res.settings === 'object') {
      current = { ...(DEFAULT_SETTINGS || {}), ...res.settings };
    }
    setState();
  }

  enabledEl.addEventListener('change', async () => {
    const res = await send({ type: MessageType && MessageType.TOGGLE_ENABLED });
    if (res && res.settings) { current = { ...(DEFAULT_SETTINGS || {}), ...res.settings }; }
    setState();
  });

  optionsEl.addEventListener('click', () => {
    if (chrome && chrome.runtime && chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.close();
    }
  });

  openEl.addEventListener('click', async () => {
    const url = window.prompt('Paste a PDF URL to open in the Bionic viewer:', '');
    if (!url) return;
    const res = await send({ type: MessageType && MessageType.OPEN_PDF, url });
    if (res && res.type === (ResponseType && ResponseType.OK)) {
      window.close();
    } else if (res && res.error) {
      stateEl.textContent = res.error;
      stateEl.className = 'state off';
    }
  });

  loadSettings().catch(() => {});
})();
