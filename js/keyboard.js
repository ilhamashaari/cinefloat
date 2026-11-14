/* ==========================================================================
   keyboard.js — Keyboard: global shortcuts and arrow-key navigation.

     /            focus the search bar
     Esc          close suggestions, then the dialog / panel / drawer / mood tray
     ← → ↑ ↓      move between posters (on the page)  /  previous or next movie (in the detail panel)
     Enter, Space open the focused poster
   ========================================================================== */
(function (CF) {
  'use strict';
  const { isTyping } = CF.utils;

  const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

  class Keyboard {
    constructor(ui) {
      this.ui = ui;
      document.addEventListener('keydown', (e) => this.onKey(e));
    }

    onKey(e) {
      const ui = this.ui;
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;

      if (e.key === 'Escape') {
        if (ui.closeTopmost()) e.preventDefault();
        return;
      }
      if (isTyping(e.target)) return;                       // never steal keys while the user is typing

      if (e.key === '/') {
        if (ui.panel.isOpen || ui.aboutOpen || ui.library.isOpen) return;
        e.preventDefault();
        scrollTo({ top: 0, behavior: ui.animator.reduced ? 'auto' : 'smooth' });
        ui.search.focus();
        return;
      }

      const dir = ARROWS[e.key];
      if (!dir) return;
      if (ui.panel.isOpen) {                                // inside the panel, ← → switch movie
        if (dir[0]) { e.preventDefault(); ui.panel.step(dir[0]); }
        return;
      }
      if (ui.library.isOpen || ui.aboutOpen) return;
      this.moveFocus(e, dir);
    }

    /** Spatial navigation: jump to the poster that is nearest in the pressed direction. */
    moveFocus(e, dir) {
      const cards = Array.from(document.querySelectorAll('.card:not(.card--skeleton)'))
        .filter((c) => !c.closest('.detail') && c.offsetParent !== null);
      if (!cards.length) return;
      const active = document.activeElement;
      const current = active && active.closest ? active.closest('.card') : null;

      if (!current || !cards.includes(current)) {
        if (!dir[0]) return;                                // ↑ ↓ keep scrolling the page until a poster is focused
        const first = cards.find((c) => {
          const r = c.getBoundingClientRect();
          return r.bottom > 90 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
        }) || cards[0];
        e.preventDefault();
        this.focusCard(first);
        return;
      }
      const next = this.nearest(current, cards, dir);
      if (next) { e.preventDefault(); this.focusCard(next); }
    }

    nearest(current, cards, [dx, dy]) {
      const r = current.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      let best = null, bestScore = Infinity;
      for (const card of cards) {
        if (card === current) continue;
        const b = card.getBoundingClientRect();
        if (!b.width) continue;
        const x = b.left + b.width / 2 - cx, y = b.top + b.height / 2 - cy;
        const along = dx ? x * dx : y * dy;                 // how far ahead, in the pressed direction
        const across = dx ? Math.abs(y) : Math.abs(x);      // how far off to the side
        if (along < 8) continue;
        if (dx && across > r.height * 0.6) continue;        // left / right stay in the same row
        const score = along + across * (dx ? 3 : 2);
        if (score < bestScore) { best = card; bestScore = score; }
      }
      return best;
    }

    focusCard(card) {
      card.focus({ preventScroll: true });                  // carousels slide by themselves (focusin), the page is scrolled below
      const r = card.getBoundingClientRect();
      if (r.top < 90 || r.bottom > innerHeight - 24) {
        scrollTo({ top: scrollY + r.top - innerHeight / 2 + r.height / 2, behavior: this.ui.animator.reduced ? 'auto' : 'smooth' });
      }
    }
  }

  CF.Keyboard = Keyboard;
})(window.CineFloat);
