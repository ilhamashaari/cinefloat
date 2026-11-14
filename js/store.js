/* ==========================================================================
   store.js — Store: everything the user saves, kept in localStorage.
   * watchlist / favorites : lists of movies
   * history               : recent searches
   * settings              : theme + reduce-motion choice
   The Store fires a "change" event whenever something changes, so the UI can
   refresh itself without the Store knowing anything about the UI.
   ========================================================================== */
(function (CF) {
  'use strict';

  const PREFIX = 'cinefloat:';
  const MAX_HISTORY = 8;

  class Store extends EventTarget {
    constructor() {
      super();
      this.fallback = {}; // used only if localStorage is blocked (private windows etc.)
      this.state = {
        watchlist: this.read('watchlist', []),
        favorites: this.read('favorites', []),
        history: this.read('history', []),
        settings: Object.assign({ theme: 'dark', reduceMotion: null }, this.read('settings', {}))
      };
      // Keep several open windows / tabs in sync.
      window.addEventListener('storage', (e) => {
        if (!e.key || !e.key.startsWith(PREFIX)) return;
        const name = e.key.slice(PREFIX.length);
        if (name in this.state) {
          this.state[name] = this.read(name, this.state[name]);
          this.emit(name);
        }
      });
    }

    // ---- storage helpers (always wrapped in try/catch) ----
    read(name, fallback) {
      try {
        const raw = localStorage.getItem(PREFIX + name);
        return raw ? JSON.parse(raw) : fallback;
      } catch (e) {
        return name in this.fallback ? this.fallback[name] : fallback;
      }
    }
    write(name) {
      this.fallback[name] = this.state[name];
      try { localStorage.setItem(PREFIX + name, JSON.stringify(this.state[name])); } catch (e) { /* quota or blocked */ }
      this.emit(name);
    }
    emit(name) {
      this.dispatchEvent(new CustomEvent('change', { detail: { key: name } }));
    }

    /** Keep a small copy of a movie (not the whole API object). */
    static slim(m) {
      return {
        id: m.id, title: m.title, posterPath: m.posterPath || null, backdropPath: m.backdropPath || null,
        rating: m.rating || 0, votes: m.votes || 0, date: m.date || '',
        overview: String(m.overview || '').slice(0, 260), genreIds: m.genreIds || [], popularity: m.popularity || 0
      };
    }

    // ---- watchlist + favorites ("list" is either of those two names) ----
    list(name) { return this.state[name]; }
    has(name, id) { return this.state[name].some((m) => m.id === id); }
    add(name, movie) {
      if (this.has(name, movie.id)) return false;
      this.state[name] = [Store.slim(movie), ...this.state[name]];
      this.write(name);
      return true;
    }
    remove(name, id) {
      this.state[name] = this.state[name].filter((m) => m.id !== id);
      this.write(name);
    }
    /** Adds if missing, removes if present. Returns true when the movie is now saved. */
    toggle(name, movie) {
      if (this.has(name, movie.id)) { this.remove(name, movie.id); return false; }
      this.add(name, movie);
      return true;
    }

    // ---- recent searches ----
    addSearch(text) {
      const q = String(text || '').trim();
      if (q.length < 2) return;
      this.state.history = [q, ...this.state.history.filter((h) => h.toLowerCase() !== q.toLowerCase())].slice(0, MAX_HISTORY);
      this.write('history');
    }
    removeSearch(text) {
      this.state.history = this.state.history.filter((h) => h !== text);
      this.write('history');
    }
    clearHistory() { this.state.history = []; this.write('history'); }

    // ---- settings ----
    get settings() { return this.state.settings; }
    setSetting(name, value) {
      this.state.settings = { ...this.state.settings, [name]: value };
      this.write('settings');
    }

    // ---- export ----
    exportJSON() {
      return JSON.stringify(
        { app: 'CineFloat', version: 1, exportedAt: new Date().toISOString(), watchlist: this.state.watchlist, favorites: this.state.favorites },
        null, 2
      );
    }
  }

  CF.Store = Store;
})(window.CineFloat);
