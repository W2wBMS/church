// Church 2.0 — runtime configuration.
//
// Local development talks to the local PostgreSQL-backed API by default.
// Deployed frontends use the configured API origin from localStorage.
const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
window.CHURCH2_CONFIG = {
  apiBase: (typeof localStorage !== 'undefined' && localStorage.getItem('church2_api_base'))
    || (isLocalHost ? 'http://localhost:4000' : ''),
};
