/* ==========================================================================
   config.example.js
   1) Copy this file to  config.js   (same folder)
   2) Paste your TMDB "API Read Access Token" below (the long one, v4 auth)
   config.js is git-ignored, so your token is never committed.
   ========================================================================== */
window.CINEFLOAT_CONFIG = {
  TMDB_READ_TOKEN: 'PASTE_YOUR_V4_READ_ACCESS_TOKEN_HERE',
  LANGUAGE: 'en-US',    // any TMDB language code, e.g. 'ms-MY', 'fr-FR', 'ja-JP'
  REGION: 'US',         // 2-letter country used for "Where to watch" (e.g. 'MY', 'GB', 'DE')
  INCLUDE_ADULT: false  // keep adult titles out of search and discover results
};
