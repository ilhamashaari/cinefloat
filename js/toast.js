/* ==========================================================================
   toast.js — Toasts: small messages that pop up at the bottom ("Saved to
   Watchlist  [Undo]"). They disappear by themselves.
   ========================================================================== */
(function (CF) {
  'use strict';

  class Toasts {
    constructor(root) {
      this.root = root;
    }

    /**
     * @param {string} message
     * @param {object} opts  { action: 'Undo', onAction: fn, duration: ms }
     */
    show(message, { action = '', onAction = null, duration = 3800 } = {}) {
      const el = document.createElement('div');
      el.className = 'toast';
      const text = document.createElement('span');
      text.textContent = message;               // textContent = safe, no HTML injection
      el.appendChild(text);

      let timer = 0;
      const close = () => {
        clearTimeout(timer);
        el.classList.add('is-out');
        setTimeout(() => el.remove(), 320);
      };
      if (action) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = action;
        button.addEventListener('click', () => { if (onAction) onAction(); close(); });
        el.appendChild(button);
      }
      const arm = () => { timer = setTimeout(close, duration); };
      el.addEventListener('pointerenter', () => clearTimeout(timer));
      el.addEventListener('pointerleave', arm);

      this.root.appendChild(el);
      while (this.root.children.length > 3) this.root.firstChild.remove();   // never stack more than 3
      arm();
      return el;
    }
  }

  CF.Toasts = Toasts;
})(window.CineFloat);
