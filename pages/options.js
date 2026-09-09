// Module - Options page.
// Full settings UI persisted through the background worker (Module 2) using the
// shared message protocol (Module 11). Provides enable/disable, routing toggle,
// fixation percent, emphasis weight, and emphasis style controls.

(function () {
  'use strict';

  const BR = window.BR || {};
  const { MessageType, ResponseType, DEFAULT_SETTINGS } = BR.Messages || {};

  const form = document.getElementById('options-form');
  const els = {
    enabled: document.getElementById('enabled'),
    routePdfs: document.getElementById('routePdfs'),
    fixationPercent: document.getElementById('fixationPercent'),
    fixationPercentValue: document.getElementById('fixationPercent-value'),
    strength: document.getElementById('strength'),
    strengthValue: document.getElementById('strength-value'),
    style: document.getElementById('style'),
    status: document.getElementById('status'),
    reset: document.getElementById('reset')
  };

  let current = { ...(DEFAULT_SETTINGS || {}) };

  function toNumber(v, min, max) {
    let n = parseInt(v, 10);
    if (Number.isNaN(n)) n = min;
    return Math.max(min, Math.min(max, n));
  }

  function hydrate(values) {
    current = { ...(DEFAULT_SETTINGS || {}), ...values };
    els.enabled.checked = !!current.enabled;
    els.routePdfs.checked = !!current.routePdfs;
    els.fixationPercent.value = String(current.fixationPercent);
    els.fixationPercentValue.textContent = `${current.fixationPercent}%`;
    els.strength.value = String(current.strength);
    els.strengthValue.textContent = String(current.strength);
    els.style.value = ['stroke', 'highlight', 'shadow'].includes(current.style) ? current.style : 'stroke';
  }

  function setStatus(text, kind) {
    els.status.textContent = text || '';
    els.status.className = kind || '';
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

  async function load() {
    const res = await send({ type: MessageType && MessageType.GET_SETTINGS });
    if (res && res.type === (ResponseType && ResponseType.OK) && res.settings) {
      hydrate(res.settings);
    } else {
      hydrate(DEFAULT_SETTINGS || {});
    }
  }

  function collect() {
    return {
      enabled: els.enabled.checked,
      routePdfs: els.routePdfs.checked,
      fixationPercent: toNumber(els.fixationPercent.value, 10, 90),
      strength: toNumber(els.strength.value, 0, 4),
      style: els.style.value
    };
  }

  els.fixationPercent.addEventListener('input', () => {
    els.fixationPercentValue.textContent = `${els.fixationPercent.value}%`;
  });
  els.strength.addEventListener('input', () => {
    els.strengthValue.textContent = els.strength.value;
  });

  async function save(values) {
    const keys = Object.keys(values);
    for (const key of keys) {
      const res = await send({ type: MessageType && MessageType.SET_SETTING, key, value: values[key] });
      if (!(res && res.type === (ResponseType && ResponseType.OK))) {
        if (res && res.error) setStatus(`Failed to save "${key}": ${res.error}`, 'error');
        return false;
      }
    }
    return true;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ok = await save(collect());
    if (ok) { setStatus('Settings saved.', 'ok'); current = collect(); }
  });

  els.reset.addEventListener('click', async () => {
    const defaults = DEFAULT_SETTINGS || {};
    if (await save(defaults)) {
      hydrate(defaults);
      setStatus('Reset to defaults.', 'ok');
    }
  });

  load().catch(() => hydrate(DEFAULT_SETTINGS || {}));
})();
