/* ==========================================================================
   library.js — LibraryDrawer: the side drawer that lists your Watchlist and
   Favorites, lets you remove items, open them, and export everything to JSON.
   ========================================================================== */
(function (CF) {
  'use strict';
  const { esc, year } = CF.utils;
  const { Cards } = CF;

  const LABELS = { watchlist: 'Watchlist', favorites: 'Favorites' };

  class LibraryDrawer {
    /**
     * @param {object} o  { root, scrim, store, toasts, onOpenMovie(movie, fromRect) }
     */
    constructor({ root, scrim, store, toasts, onOpenMovie }) {
      Object.assign(this, { root, scrim, store, toasts, onOpenMovie });
      this.tab = 'watchlist';
      this.isOpen = false;
      this.trigger = null;
      this.list = root.querySelector('#drawer-list');
      this.tabs = Array.from(root.querySelectorAll('[data-tab]'));

      this.tabs.forEach((btn) => btn.addEventListener('click', () => { this.tab = btn.dataset.tab; this.render(); }));
      root.querySelector('#drawer-close').addEventListener('click', () => this.close());
      scrim.addEventListener('click', () => this.close());
      root.querySelector('#btn-export').addEventListener('click', () => this.export());
      store.addEventListener('change', () => { if (this.isOpen) this.render(); });
    }

    open(tab) {
      if (tab) this.tab = tab;
      this.trigger = document.activeElement;
      this.render();
      this.root.hidden = false;
      this.root.inert = false;
      this.scrim.hidden = false;
      void this.root.offsetWidth;                 // force a layout so the slide-in transition runs
      this.root.classList.add('is-open');
      this.scrim.classList.add('is-on');
      this.isOpen = true;
      this.root.querySelector('#drawer-close').focus({ preventScroll: true });
    }

    close() {
      if (!this.isOpen) return;
      this.isOpen = false;
      this.root.classList.remove('is-open');
      this.scrim.classList.remove('is-on');
      this.root.inert = true;
      setTimeout(() => { if (!this.isOpen) { this.root.hidden = true; this.scrim.hidden = true; } }, 520);
      if (this.trigger && this.trigger.focus) this.trigger.focus({ preventScroll: true });
    }

    render() {
      this.tabs.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === this.tab)));
      const movies = this.store.list(this.tab);
      this.list.textContent = '';
      this.root.querySelector('#btn-export').disabled = !this.store.list('watchlist').length && !this.store.list('favorites').length;

      if (!movies.length) {
        const empty = document.createElement('div');
        empty.className = 'lib-empty';
        empty.innerHTML = `<span class="state__icon">${this.tab === 'watchlist' ? '🎬' : '💜'}</span>` +
          `<p>Your ${LABELS[this.tab].toLowerCase()} is empty.<br>Drag any poster onto the ${LABELS[this.tab]} zone, or use the buttons inside a movie.</p>`;
        this.list.appendChild(empty);
        return;
      }
      movies.forEach((movie) => {
        const item = document.createElement('div');
        item.className = 'lib-item';
        item.tabIndex = 0;
        item.setAttribute('role', 'button');
        item.innerHTML =
          `<div class="lib-item__thumb">${Cards.thumb(movie)}</div>` +
          `<div><div class="lib-item__title">${esc(movie.title)}</div><div class="lib-item__sub">${esc([year(movie.date), movie.rating ? '★ ' + movie.rating.toFixed(1) : ''].filter(Boolean).join(' · '))}</div></div>` +
          `<button class="icon-btn" type="button" aria-label="Remove ${esc(movie.title)} from ${LABELS[this.tab]}"><svg class="ico"><use href="#i-trash"/></svg></button>`;
        const open = () => {
          const rect = item.querySelector('.lib-item__thumb').getBoundingClientRect();
          this.close();
          this.onOpenMovie(movie, rect);
        };
        item.addEventListener('click', (e) => {
          if (e.target.closest('button')) return;
          open();
        });
        item.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === item) open(); });
        item.querySelector('button').addEventListener('click', () => {
          this.store.remove(this.tab, movie.id);
          this.toasts.show(`Removed from ${LABELS[this.tab]}`, { action: 'Undo', onAction: () => this.store.add(this.tab, movie) });
        });
        this.list.appendChild(item);
      });
    }

    /** Download watchlist + favorites as a .json file. */
    export() {
      const blob = new Blob([this.store.exportJSON()], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `cinefloat-library-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 5000);
      this.toasts.show('Library exported to a JSON file');
    }
  }

  CF.LibraryDrawer = LibraryDrawer;
})(window.CineFloat);
