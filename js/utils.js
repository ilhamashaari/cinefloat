/* ==========================================================================
   utils.js — small helpers used by every other file.
   All files share ONE global object, `CineFloat`, instead of ES modules.
   (Classic scripts also work when you double-click index.html.)
   ========================================================================== */
(function (CF) {
  'use strict';

  const u = {};

  /** Short DOM helpers. */
  u.$ = (selector, root = document) => root.querySelector(selector);
  u.$$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  /** Escape text before putting it into innerHTML (prevents HTML injection). */
  u.esc = (value) =>
    String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  u.clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  u.lerp = (a, b, t) => a + (b - a) * t;
  u.rand = (min, max) => min + Math.random() * (max - min);
  u.sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** Delay a function until the user stops calling it for `ms` milliseconds. */
  u.debounce = (fn, ms) => {
    let timer = 0;
    const debounced = (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
    debounced.cancel = () => clearTimeout(timer);
    return debounced;
  };

  /** Fast, stable string hash (FNV-1a). Same text -> same number, so colours stay consistent. */
  u.hash = (text) => {
    let h = 2166136261;
    const s = String(text);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };

  u.year = (date) => (date ? String(date).slice(0, 4) : '');

  u.formatRuntime = (minutes) => {
    if (!minutes) return '';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h ? `${h}h ${m ? m + 'm' : ''}`.trim() : `${m}m`;
  };

  u.formatDate = (date) => {
    if (!date) return '';
    const d = new Date(date + 'T00:00:00');
    return isNaN(d) ? date : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };

  /** True when the user is typing in a form field (so shortcuts must not fire). */
  u.isTyping = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

  /** Rating tier used to colour stars and the ring. */
  u.tier = (rating) => (!rating ? 'none' : rating >= 7 ? 'high' : rating >= 5.5 ? 'mid' : 'low');

  /** TMDB image URLs. Posters use w500, backdrops use w1280 (as requested). */
  const IMG = 'https://image.tmdb.org/t/p/';
  u.img = {
    poster: (path, size = 'w500') => (path ? IMG + size + path : ''),
    backdrop: (path) => (path ? IMG + 'w1280' + path : ''),
    profile: (path) => (path ? IMG + 'w185' + path : ''),
    logo: (path) => (path ? IMG + 'w92' + path : '')
  };

  /**
   * Shared "who owns the current pointer gesture" flag.
   * Carousels (panning) and DragThrow (picking up a poster) both start from the
   * same pointerdown. Whoever recognises its gesture first claims it, and the
   * other one backs off.
   */
  CF.gesture = { owner: null, suppressClick: false };
  document.addEventListener(
    'click',
    (event) => {
      if (CF.gesture.suppressClick) {      // a drag/pan just ended: swallow the click it would cause
        event.stopPropagation();
        event.preventDefault();
        CF.gesture.suppressClick = false;
      }
    },
    true
  );
  /** Call right after a drag/pan ends; the flag clears itself on the next tick. */
  CF.gesture.endMoved = () => {
    CF.gesture.owner = null;
    CF.gesture.suppressClick = true;
    setTimeout(() => { CF.gesture.suppressClick = false; }, 0);
  };

  CF.utils = u;
})((window.CineFloat = window.CineFloat || {}));
