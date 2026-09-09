// Module 11 - Shared message protocol.
//
// Single source of truth for the message types exchanged between the background
// service worker (Module 2), the popup, the options page, and the content-script
// PDF router (Module 3). Keeping these constants in one module prevents typos and
// keeps the wire protocol consistent across contexts.
//
// This module is loaded as a *classic* script in content-script contexts
// (manifest.js content_scripts ordering) and also referenced by other pages via
// <script src>. It intentionally performs no I/O and declares no globals that
// could collide with page scripts beyond the BR.* namespace.

(function (global) {
  'use strict';

  // Outbound request types sent TO the background service worker.
  const MessageType = Object.freeze({
    GET_SETTINGS: 'GET_SETTINGS',
    SET_SETTING: 'SET_SETTING',
    TOGGLE_ENABLED: 'TOGGLE_ENABLED',
    OPEN_PDF: 'OPEN_PDF',
    ROUTE_PDF: 'ROUTE_PDF'
  });

  // Typed response envelope types returned FROM the background worker.
  const ResponseType = Object.freeze({
    OK: 'ok',
    ERROR: 'error'
  });

  // Keys persisted in chrome.storage.sync. Mirrors the DEFAULT_SETTINGS contract
  // in background.js and the engine modules.
  const SettingKey = Object.freeze([
    'enabled',
    'fixationPercent',
    'strength',
    'style',
    'routePdfs'
  ]);

  const Settings = Object.freeze({
    DEFAULT_SETTINGS: Object.freeze({
      enabled: true,
      fixationPercent: 50,   // percentage of each word emphasized
      strength: 2,           // 0..4 emphasis strength
      style: 'stroke',       // 'stroke' | 'highlight' | 'shadow'
      routePdfs: true        // whether PDF navigation routing is active
    })
  });

  const BR = global.BR || (global.BR = {});
  BR.Messages = Object.freeze({
    MessageType,
    ResponseType,
    SettingKey,
    DEFAULT_SETTINGS: Settings.DEFAULT_SETTINGS
  });

  // CommonJS export for Node-based unit tests.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MessageType, ResponseType, SettingKey, DEFAULT_SETTINGS: Settings.DEFAULT_SETTINGS };
  }
})(typeof window !== 'undefined' ? window : globalThis);
