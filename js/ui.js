/* ==========================================================================
   ui.js — UIController: creates every component and connects them.

   It owns: the home rows, the floating hero posters, clicking a poster,
   hover colours, drag-and-drop saving, theme + motion switches, the About
   dialog, the offline banner and the "add your token" screen.
   (Search lives in search.js, filters/results in explore.js, the movie sheet
   in panel.js, the side drawer in library.js.)
   ========================================================================== */
(function (CF) {
  'use strict';
  const { $, $$, esc, img, isTyping } = CF.utils;
  const { Cards, Carousel } = CF;

  const ROWS = [
    { id: 'trending', title: 'Trending this week', load: (api) => api.trending() },
    { id: 'popular', title: 'Popular right now', load: (api) => api.popular() },
    { id: 'top', title: 'All-time top rated', load: (api) => api.topRated() },
    { id: 'now', title: 'Now playing in theatres', load: (api) => api.nowPlaying() }
  ];

  class UIController {
    /** @param {object} o { api, store, colors, background, animator } */
    constructor(o) {
      Object.assign(this, o);
      this.html = document.documentElement;
      this.rowsEl = $('#rows');
      this.rowState = new Map();     // row id -> { row, section, carousel, track, failed }
      this.aboutOpen = false;
      this.genresFailed = false;
      this.toasts = new CF.Toasts($('#toasts'));
    }

    init() {
      const { api, store, animator, background, colors, toasts } = this;
      const openMovie = (movie, rect) => this.panel.open(movie, { fromRect: rect });

      this.panel = new CF.DetailPanel({ root: $('#detail'), api, store, animator, background, colors, toasts, onAuthError: () => this.showSetup('invalid') });
      this.library = new CF.LibraryDrawer({ root: $('#drawer'), scrim: $('#drawer-scrim'), store, toasts, onOpenMovie: openMovie });
      this.search = new CF.SearchBox({
        api, store,
        onSubmit: (q) => this.explorer.setQuery(q),
        onPick: openMovie,
        onClear: () => this.explorer.setQuery('')
      });
      this.explorer = new CF.Explorer({ api, store, animator, toasts, search: this.search, onOpenMovie: openMovie, onAuthError: () => this.showSetup('invalid') });
      this.dragthrow = new CF.DragThrow({ animator, onDrop: (zone, movie) => this.onDrop(zone, movie) });

      this.bindChrome();
      this.bindCards();
      this.initTheme();
      this.initMotion();
      this.initLogos();
      this.initNetwork();
      this.updateCounts();
      animator.decorate(document);          // top-bar buttons etc. (magnetic)

      if (!api.hasToken) { this.showSetup('missing'); return; }
      this.buildRows();
      this.loadGenres();
    }

    // ------------------------------------------------------------------ top bar, buttons, dialogs
    bindChrome() {
      $('#btn-watchlist').addEventListener('click', () => this.library.open('watchlist'));
      $('#btn-favorites').addEventListener('click', () => this.library.open('favorites'));
      $('#brand').addEventListener('click', (e) => { e.preventDefault(); this.goHome(); });
      $('#results-back').addEventListener('click', () => this.goHome());
      $('#btn-about').addEventListener('click', () => this.openAbout());
      $('#btn-about-2').addEventListener('click', () => this.openAbout());
      $$('#about [data-close]').forEach((el) => el.addEventListener('click', () => this.closeAbout()));
      this.store.addEventListener('change', () => { this.updateCounts(); Cards.syncMarks(document, this.store); });

      const d = window.desktop;
      const label = $('#about-version');
      label.textContent = d ? `Desktop app · Electron ${d.versions.electron} · Chromium ${d.versions.chrome}` : 'Running in a web browser.';
      if (d && d.getVersion) d.getVersion().then((v) => { label.textContent = `CineFloat ${v} · ` + label.textContent; }).catch(() => {});
    }

    goHome() {
      this.explorer.resetAll();
      this.explorer.toggleMoods(false);
      scrollTo({ top: 0, behavior: this.animator.reduced ? 'auto' : 'smooth' });
    }

    updateCounts() {
      ['watchlist', 'favorites'].forEach((name) => {
        const n = this.store.list(name).length;
        const el = $('#count-' + name);
        el.textContent = n > 99 ? '99+' : n;
        el.dataset.zero = String(n === 0);
      });
    }

    openAbout() {
      const el = $('#about');
      this.aboutTrigger = document.activeElement;
      el.hidden = false;
      el.inert = false;
      void el.offsetWidth;
      el.classList.add('is-open');
      this.html.classList.add('modal-open');
      this.aboutOpen = true;
      el.querySelector('.modal__card').focus({ preventScroll: true });
    }
    closeAbout() {
      if (!this.aboutOpen) return;
      const el = $('#about');
      this.aboutOpen = false;
      el.classList.remove('is-open');
      el.inert = true;
      this.html.classList.remove('modal-open');
      setTimeout(() => { if (!this.aboutOpen) el.hidden = true; }, 380);
      if (this.aboutTrigger && this.aboutTrigger.focus) this.aboutTrigger.focus({ preventScroll: true });
    }

    /** Esc: closes the top-most thing. Returns true when something was closed. */
    closeTopmost() {
      if (this.search.isOpen) { this.search.hide(); return true; }
      if (this.aboutOpen) { this.closeAbout(); return true; }
      if (this.panel.isOpen) { this.panel.close(); return true; }
      if (this.library.isOpen) { this.library.close(); return true; }
      if (!$('#mood-tray').hidden) { this.explorer.toggleMoods(false); return true; }
      if (isTyping(document.activeElement)) { document.activeElement.blur(); return true; }
      return false;
    }

    // ------------------------------------------------------------------ cards: click, hover colour, drop
    bindCards() {
      document.addEventListener('click', (e) => {
        const card = e.target.closest('.card');
        if (!card || !card.cfMovie || card.classList.contains('card--skeleton')) return;
        if (e.target.closest('button, a')) return;
        this.openCard(card);
      });
      document.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('card') && e.target.cfMovie) {
          e.preventDefault();
          this.openCard(e.target);
        }
      });

      // The background (and the card's glow) take the colour of the poster under the pointer or keyboard focus.
      this.animator.onHover = (card) => {
        if (!card.cfMovie) return;
        this.colors.get(card.cfMovie).then((c) => {
          if (this.animator.hoverCard !== card) return;
          card.style.setProperty('--glow', `rgb(${c.a[0]} ${c.a[1]} ${c.a[2]} / 0.62)`);
          this.background.setHover(c);
        });
      };
      this.animator.onLeave = () => this.background.setHover(null);
      document.addEventListener('focusin', (e) => {
        const card = e.target.closest && e.target.closest('.card');
        if (card && card.cfMovie && e.target.matches(':focus-visible')) this.colors.get(card.cfMovie).then((c) => this.background.setHover(c));
      });
      document.addEventListener('focusout', (e) => { if (e.target.closest && e.target.closest('.card')) this.background.setHover(null); });
    }

    openCard(card) {
      const poster = card.querySelector('.card__poster');
      if (!poster) return;
      const siblings = Array.from(card.parentElement.children).filter((c) => c.classList.contains('card') && c.cfMovie);
      this.panel.open(card.cfMovie, {
        fromRect: poster.getBoundingClientRect(),
        card: card.closest('.detail') ? null : card,       // a card inside the panel is replaced anyway
        list: siblings.map((c) => c.cfMovie),
        index: siblings.indexOf(card)
      });
    }

    /** A poster was dropped on the Watchlist / Favorites zone. */
    onDrop(zone, movie) {
      const name = zone === 'watchlist' ? 'Watchlist' : 'Favorites';
      if (this.store.has(zone, movie.id)) { this.toasts.show(`“${movie.title}” is already in your ${name}`); return; }
      this.store.add(zone, movie);
      this.toasts.show(`Saved “${movie.title}” to ${name}`, { action: 'Undo', onAction: () => this.store.remove(zone, movie.id) });
      const count = $('#count-' + zone);
      if (!this.animator.reduced) count.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.6)' }, { transform: 'scale(1)' }], { duration: 480, easing: 'cubic-bezier(0.3, 1.5, 0.5, 1)' });
    }

    // ------------------------------------------------------------------ home rows
    buildRows() {
      ROWS.forEach((row) => {
        const section = document.createElement('section');
        section.className = 'row';
        section.dataset.row = row.id;
        section.innerHTML = `<div class="section-head"><h2>${esc(row.title)}</h2></div>` +
          `<div class="carousel"><div class="carousel__viewport" data-cursor="Drag"><div class="carousel__track"></div></div></div>`;
        this.rowsEl.appendChild(section);
        const carousel = new Carousel(section.querySelector('.carousel'));
        this.rowState.set(row.id, { row, section, carousel, track: section.querySelector('.carousel__track'), failed: false });
        this.loadRow(row.id);
      });
    }

    async loadRow(id) {
      const s = this.rowState.get(id);
      const box = s.section.querySelector('.carousel');
      const old = s.section.querySelector('.state');
      if (old) old.remove();
      box.hidden = false;
      s.track.textContent = '';
      s.track.appendChild(Cards.skeleton(9));
      s.carousel.x = 0;
      s.carousel.measure();
      try {
        const page = await s.row.load(this.api);
        s.track.textContent = '';
        page.results.forEach((m) => s.track.appendChild(Cards.card(m)));
        Cards.syncMarks(s.track, this.store);
        this.animator.decorate(s.section);
        s.carousel.x = 0;
        s.carousel.measure();
        s.failed = false;
        if (id === 'trending') this.populateFloaters(page.results);
      } catch (err) {
        if (err.name === 'AbortError') return;
        s.failed = true;
        if (err.kind === 'auth') this.showSetup('invalid');
        box.hidden = true;
        const offline = err.kind === 'offline' || err.kind === 'network';
        const state = document.createElement('div');
        state.className = 'state state--inline';
        state.innerHTML = `<span class="state__icon">${offline ? '📡' : '🎞️'}</span><h3>${offline ? 'You appear to be offline' : 'Could not load this row'}</h3>` +
          `<p>${offline ? 'Reconnect and it will refresh by itself, or try again now.' : esc(err.message)}</p><button class="btn" type="button">Try again</button>`;
        state.querySelector('button').addEventListener('click', () => this.loadRow(id));
        s.section.appendChild(state);
      }
    }

    async loadGenres() {
      try {
        const list = await this.api.genres();
        this.genresFailed = false;
        Cards.setGenres(list);
        this.explorer.setGenres(list);
      } catch (err) {
        this.genresFailed = true;
        if (err.kind === 'auth') this.showSetup('invalid');
      }
    }

    /** Big decorative posters that drift behind the headline (they use the Trending row's data). */
    populateFloaters(movies) {
      const box = $('#floaters');
      if (box.childElementCount) return;
      const depths = [3, 1, 3, 2, 1, 2, 1, 2];
      movies.filter((m) => m.posterPath).slice(0, 8).forEach((m, i) => {
        const el = document.createElement('div');
        el.className = 'fl floaty';
        el.dataset.depth = depths[i];
        const image = new Image();
        image.alt = '';
        image.draggable = false;
        image.src = img.poster(m.posterPath, 'w342');
        el.appendChild(image);
        box.appendChild(el);
      });
      this.animator.decorate(box);
      box.querySelectorAll('.fl').forEach((el, i) => setTimeout(() => el.classList.add('is-in'), 150 + i * 130));
    }

    // ------------------------------------------------------------------ theme + motion
    initTheme() {
      const set = (theme) => {
        this.html.dataset.theme = theme;
        $$('[data-theme-btn]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.themeBtn === theme)));
      };
      set(this.html.dataset.theme);
      $$('[data-theme-btn]').forEach((b) => b.addEventListener('click', () => {
        set(b.dataset.themeBtn);
        this.store.setSetting('theme', b.dataset.themeBtn);
      }));
    }

    initMotion() {
      const btn = $('#btn-motion');
      const sync = () => {
        btn.setAttribute('aria-pressed', String(this.animator.reduced));
        btn.title = this.animator.reduced ? 'Motion is reduced (click to turn animations back on)' : 'Reduce motion';
      };
      sync();
      btn.addEventListener('click', () => {
        const next = !this.animator.reduced;
        this.animator.setReduced(next);
        this.store.setSetting('reduceMotion', next);      // the user's explicit choice now wins over the OS setting
        sync();
        this.toasts.show(next ? 'Reduced motion is on' : 'Animations are back on');
      });
      const query = matchMedia('(prefers-reduced-motion: reduce)');
      query.addEventListener('change', (e) => {
        if (this.store.settings.reduceMotion == null) { this.animator.setReduced(e.matches); sync(); }
      });
    }

    // ------------------------------------------------------------------ TMDB logo, network, setup
    /** Try each logo source in turn; fall back to plain text if none loads. */
    initLogos() {
      $$('img.tmdb-logo[data-srcs]').forEach((logo) => {
        const sources = logo.dataset.srcs.split(/\s+/).filter(Boolean);
        let i = 0;
        const next = () => {
          if (i < sources.length) { logo.src = sources[i++]; return; }
          const text = document.createElement('strong');
          text.textContent = 'TMDB';
          logo.replaceWith(text);
        };
        logo.addEventListener('error', next);
        next();
      });
    }

    initNetwork() {
      const banner = $('#banner');
      let hideTimer = 0;
      const show = (text, autoHide) => {
        banner.textContent = text;
        banner.hidden = false;
        clearTimeout(hideTimer);
        if (autoHide) hideTimer = setTimeout(() => { if (navigator.onLine) banner.hidden = true; }, 6000);
      };
      window.addEventListener('offline', () => show('You are offline. Showing saved results where possible.', false));
      window.addEventListener('online', () => {
        banner.hidden = true;
        this.rowState.forEach((s, id) => { if (s.failed) this.loadRow(id); });
        if (this.genresFailed) this.loadGenres();
      });
      this.api.addEventListener('stale', () => show('Showing saved results. TMDB could not be reached.', true));
      if (!navigator.onLine) show('You are offline. Showing saved results where possible.', false);
    }

    showSetup(kind) {
      if (kind === 'invalid') {
        $('#setup-title').textContent = 'TMDB did not accept the token';
        $('#setup-text').innerHTML = 'The token in <code>config.js</code> was rejected. Use the long <strong>API Read Access Token</strong> (it starts with <code>eyJ</code>), not the short API key.';
      }
      $('#setup').hidden = false;
    }
  }

  CF.UIController = UIController;
})(window.CineFloat);
