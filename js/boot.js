/* ==========================================================================
   boot.js — runs BEFORE the page paints, so the saved theme and motion
   setting are applied immediately (no flash of the wrong theme).
   ========================================================================== */
(function () {
  var root = document.documentElement;
  try {
    var saved = JSON.parse(localStorage.getItem('cinefloat:settings') || '{}');
    var theme = ['dark', 'light', 'amoled'].indexOf(saved.theme) > -1 ? saved.theme : 'dark';
    // reduceMotion: true / false = the user chose; null / missing = follow the operating system
    var osReduces = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var reduce = saved.reduceMotion === true || (saved.reduceMotion == null && osReduces);
    root.dataset.theme = theme;
    root.dataset.motion = reduce ? 'reduced' : 'full';
  } catch (e) {
    root.dataset.theme = 'dark';
    root.dataset.motion = 'full';
  }
})();
