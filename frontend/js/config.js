// Church 2.0 — runtime configuration.
//
// Local development talks to the local API (which connects to Supabase) by default.
// Deployed frontends use the production API unless an override is configured.
const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
window.CHURCH2_CONFIG = {
  apiBase: (typeof localStorage !== 'undefined' && localStorage.getItem('church2_api_base'))
    || (isLocalHost ? 'http://localhost:4000' : 'https://church-smmc.onrender.com'),
};
