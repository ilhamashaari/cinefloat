/* ==========================================================================
   app.js — start-up. Creates the services and the UI, then hands over.
   Read this file first if you want to understand how the pieces fit:

     Store        saved lists + settings          (store.js)
     ApiService   TMDB requests, cache, abort     (api.js)
     ColorExtractor + Background  poster colours -> animated backdrop
     Animator     float / parallax / tilt / cursor / magnetic / FLIP
     UIController builds the rest: SearchBox, Explorer, DetailPanel,
                  LibraryDrawer, DragThrow, Carousels, Keyboard
   ========================================================================== */
(function (CF) {
  'use strict';

  function start() {
    const config = window.CINEFLOAT_CONFIG || {};   // from config.js (git-ignored); empty if the file is missing
    const store = new CF.Store();
    const api = new CF.ApiService(config);
    const colors = new CF.ColorExtractor();
    const background = new CF.Background(document.getElementById('bg'));
    const animator = new CF.Animator(document.getElementById('view'));
    const ui = new CF.UIController({ api, store, colors, background, animator });
    ui.init();
    new CF.Keyboard(ui);
    CF.app = { store, api, ui, animator };           // handy in DevTools: CineFloat.app.store.list('watchlist')
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(window.CineFloat);
