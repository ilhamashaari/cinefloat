/* ==========================================================================
   explore.js — Explorer: everything that decides WHAT the result grid shows.

   * the text search            (/search/movie, filters are applied on your device)
   * genre chips, year range, minimum rating, sort order  (/discover/movie)
   * the Mood Picker            (a mood = a set of genres, any of them may match)
   * "Surprise me"              (a random well-rated movie, respecting your filters)

   When nothing is searched or filtered, the grid is hidden and the home rows show.
   ========================================================================== */
(function (CF) {
  'use strict';
  const { $, debounce, esc, year } = CF.utils;
  const { Cards, Carousel } = CF;

  // TMDB genre ids: 35 Comedy, 10751 Family, 16 Animation, 53 Thriller, 28 Action, 80 Crime, 10749 Romance,
  // 878 Sci-Fi, 9648 Mystery, 12 Adventure, 14 Fantasy, 27 Horror, 18 Drama, 36 History, 99 Documentary
  const MOODS = [
    { id: 'happy', emoji: '😄', label: 'Happy', genres: [35, 10751, 16] },
    { id: 'thrilling', emoji: '😱', label: 'Thrilling', genres: [53, 28, 80] },
    { id: 'romantic', emoji: '💕', label: 'Romantic', genres: [10749] },
    { id: 'mind', emoji: '🌀', label: 'Mind-bending', genres: [878, 9648] },
    { id: 'adventurous', emoji: '🧭', label: 'Adventurous', genres: [12, 14] },
    { id: 'spooky', emoji: '👻', label: 'Spooky', genres: [27] },
    { id: 'thoughtful', emoji: '🤔', label: 'Thoughtful', genres: [18, 36, 99] },
    { id: 'nostalgic', emoji: '📼', label: 'Nostalgic', genres: [35, 18, 10749, 12], extra: { yearTo: 2004, minVotes: 500 } }
  ];
  const DEFAULT_SORT = 'popularity.desc';

  class Explorer {
    /** @param {object} o { api, store, animator, toasts, search, onOpenMovie(movie, rect), onAuthError(err) } */
    constructor(o) {
      Object.assign(this, o);
      this.f = { query: '', genres: new Set(), yearFrom: '', yearTo: '', minRating: 0, sort: DEFAULT_SORT, mood: null };
      this.token = 0;          // bumped on every new search / filter, so old answers are ignored
      this.page = 0; this.totalPages = 1; this.count = 0; this.autoPulls = 0;
      this.seen = new Set();

      this.results = $('#results'); this.rows = $('#rows');
      this.grid = $('#results-grid'); this.state = $('#results-state'); this.more = $('#load-more');
      this.title = $('#results-title'); this.sub = $('#results-sub');
      this.genreBox = $('#genre-chips');
      this.from = $('#year-from'); this.to = $('#year-to'); this.rating = $('#rating-min'); this.ratingOut = $('#rating-out'); this.sort = $('#sort');
      this.tray = $('#mood-tray'); this.moodBtn = $('#btn-mood');
      this.genreCarousel = new Carousel($('#genre-carousel'), { arrows: false });

      this.applyLater = debounce(() => this.apply(), 400);
      this.genreBox.addEventListener('click', (e) => this.onGenreClick(e));
      [this.from, this.to].forEach((el) => el.addEventListener('input', () => { this.readInputs(); this.applyLater(); }));
      this.rating.addEventListener('input', () => { this.readInputs(); this.applyLater(); });
      this.sort.addEventListener('change', () => { this.readInputs(); this.apply(); });
      $('#filters-reset').addEventListener('click', () => this.resetAll());
      this.more.addEventListener('click', () => {
        this.more.disabled = true;
        this.more.textContent = 'Loading…';
        this.loadPage(this.page + 1, this.token);
      });
      this.buildMoods();
      $('#btn-surprise').addEventListener('click', () => this.surprise());
    }

    // ------------------------------------------------------------------ state
    get isFiltering() {
      const f = this.f;
      return !!(f.query || f.genres.size || f.yearFrom || f.yearTo || f.minRating > 0 || f.sort !== DEFAULT_SORT || f.mood);
    }

    setQuery(q) {
      this.f.query = q;
      if (q) { this.f.mood = null; this.syncMoodUi(); }
      this.apply();
    }

    resetAll() {
      Object.assign(this.f, { genres: new Set(), yearFrom: '', yearTo: '', minRating: 0, sort: DEFAULT_SORT, mood: null });
      this.from.value = ''; this.to.value = ''; this.rating.value = '0'; this.sort.value = DEFAULT_SORT;
      this.readInputs();
      this.syncGenreUi(); this.syncMoodUi();
      this.search.clear();        // clears the text and calls setQuery('') -> apply()
    }

    readInputs() {
      const parse = (el, previous) => {
        const raw = el.value.trim();
        if (raw === '') return '';
        const n = Number(raw);
        return /^\d{4}$/.test(raw) && n >= 1900 && n <= 2100 ? raw : previous;   // ignore half-typed years like "19"
      };
      const f = this.f;
      f.yearFrom = parse(this.from, f.yearFrom);
      f.yearTo = parse(this.to, f.yearTo);
      // A reversed range (from > to) is NOT swapped while typing: you often change "from" first and
      // "to" second, and a swap in between would make the fields jump. It just finds nothing, and
      // the empty state explains why.
      f.minRating = Number(this.rating.value) || 0;
      f.sort = this.sort.value;
      this.ratingOut.textContent = f.minRating ? `${f.minRating.toFixed(1)}+` : 'Any';
    }

    // ------------------------------------------------------------------ genres + moods
    setGenres(list) {
      this.genreBox.textContent = '';
      list.forEach((g) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip';
        chip.dataset.id = g.id;
        chip.setAttribute('aria-pressed', 'false');
        chip.textContent = g.name;
        this.genreBox.appendChild(chip);
      });
      this.genreCarousel.measure();
    }
    onGenreClick(e) {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      const id = Number(chip.dataset.id);
      if (this.f.genres.has(id)) this.f.genres.delete(id); else this.f.genres.add(id);
      this.f.mood = null;                       // choosing genres by hand replaces a mood
      this.syncGenreUi(); this.syncMoodUi();
      this.apply();
    }
    syncGenreUi() {
      this.genreBox.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(this.f.genres.has(Number(c.dataset.id)))));
    }

    buildMoods() {
      MOODS.forEach((m) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'mood__btn floaty';
        b.dataset.mood = m.id;
        b.dataset.magnetic = '';
        b.setAttribute('aria-pressed', 'false');
        b.innerHTML = `<span class="mood__emoji">${m.emoji}</span>${esc(m.label)}`;
        this.tray.appendChild(b);
      });
      this.tray.addEventListener('click', (e) => {
        const b = e.target.closest('.mood__btn');
        if (!b) return;
        const same = this.f.mood && this.f.mood.id === b.dataset.mood;
        this.pickMood(same ? null : MOODS.find((m) => m.id === b.dataset.mood));
      });
      this.moodBtn.addEventListener('click', () => this.toggleMoods());
    }
    toggleMoods(force) {
      const open = force === undefined ? this.tray.hidden : force;
      this.tray.hidden = !open;
      this.moodBtn.setAttribute('aria-expanded', String(open));
      if (open) this.animator.decorate(this.tray);
    }
    pickMood(mood) {
      this.f.mood = mood;
      this.f.genres.clear();
      this.f.query = '';
      this.search.input.value = '';
      this.search.clearBtn.hidden = true;
      this.search.hide();
      this.syncGenreUi(); this.syncMoodUi();
      this.apply();
    }
    syncMoodUi() {
      this.tray.querySelectorAll('.mood__btn').forEach((b) => b.setAttribute('aria-pressed', String(!!this.f.mood && this.f.mood.id === b.dataset.mood)));
    }

    // ------------------------------------------------------------------ running a search / filter
    apply() {
      this.applyLater.cancel();
      return this.run();
    }

    async run() {
      const token = ++this.token;
      this.api.abort('results');
      if (!this.isFiltering) return this.showHome();
      this.showResults();
      this.page = 0; this.totalPages = 1; this.count = 0; this.autoPulls = 0;
      this.seen = new Set();
      this.grid.hidden = false;
      this.grid.textContent = '';
      this.grid.appendChild(Cards.skeleton(12));
      this.state.hidden = true;
      this.more.hidden = true;
      this.title.textContent = this.heading();
      this.sub.textContent = 'Searching…';
      await this.loadPage(1, token);
    }

    heading() {
      const f = this.f;
      if (f.query) return `Results for “${f.query}”`;
      if (f.mood) return `${f.mood.emoji} ${f.mood.label} movies`;
      return 'Browse movies';
    }

    /** Filters in the shape ApiService.discover() expects. */
    apiFilters() {
      const f = this.f, mood = f.mood, extra = (mood && mood.extra) || {};
      return {
        genres: mood ? mood.genres : [...f.genres],
        genreMode: mood ? 'or' : 'and',                  // a mood matches ANY of its genres, chips must ALL match
        yearFrom: f.yearFrom,
        yearTo: f.yearTo || extra.yearTo || '',
        minRating: f.minRating,
        sort: f.sort,
        minVotes: extra.minVotes
      };
    }

    /** The search endpoint has no filters, so we apply them to the results we received. */
    clientFilter(movies) {
      const f = this.f;
      const out = movies.filter((m) => {
        if (f.genres.size && ![...f.genres].every((id) => m.genreIds.includes(id))) return false;
        const y = Number(year(m.date)) || 0;
        if (f.yearFrom && y < Number(f.yearFrom)) return false;
        if (f.yearTo && y > Number(f.yearTo)) return false;
        return !(f.minRating && m.rating < f.minRating);
      });
      if (f.sort === 'vote_average.desc') out.sort((a, b) => b.rating - a.rating);
      else if (f.sort === 'primary_release_date.desc') out.sort((a, b) => b.date.localeCompare(a.date));
      else if (f.sort === 'primary_release_date.asc') out.sort((a, b) => a.date.localeCompare(b.date));
      return out;
    }

    async loadPage(page, token) {
      const f = this.f;
      try {
        const data = f.query ? await this.api.search(f.query, page, 'results') : await this.api.discover(this.apiFilters(), page);
        if (token !== this.token) return;
        if (page === 1) this.grid.textContent = '';
        this.page = data.page;
        this.totalPages = data.totalPages;

        let movies = f.query ? this.clientFilter(data.results) : data.results;
        movies = movies.filter((m) => !this.seen.has(m.id));
        movies.forEach((m) => this.seen.add(m.id));
        this.append(movies);
        this.count += movies.length;

        // Search + filters can leave a page almost empty: quietly fetch a few more pages.
        if (f.query && this.count < 8 && this.page < this.totalPages && this.autoPulls < 3) {
          this.autoPulls++;
          return this.loadPage(this.page + 1, token);
        }
        const total = data.totalResults.toLocaleString();
        this.sub.textContent = f.query
          ? `${total} matches${this.isFiltering && (f.genres.size || f.yearFrom || f.yearTo || f.minRating) ? ' · your filters narrow the results loaded so far' : ''}`
          : `${total} movies`;
        if (!this.count) this.empty();
        this.more.hidden = !this.count || this.page >= this.totalPages;
        this.more.disabled = false;
        this.more.textContent = 'Load more';
      } catch (err) {
        if (err.name === 'AbortError' || token !== this.token) return;
        if (err.kind === 'auth' && this.onAuthError) this.onAuthError(err);
        this.more.disabled = false;
        this.more.textContent = 'Load more';
        if (page === 1) {
          this.grid.textContent = '';
          this.sub.textContent = '';
          const offline = err.kind === 'offline' || err.kind === 'network';
          this.showState({
            icon: offline ? '📡' : '⚠️',
            title: offline ? 'You are offline' : 'Something went wrong',
            text: offline ? 'We could not reach TMDB and have nothing saved for this search yet.' : err.message,
            action: 'Try again', onAction: () => this.run()
          });
        } else {
          this.toasts.show('Could not load more movies', { action: 'Retry', onAction: () => this.more.click() });
        }
      }
    }

    append(movies) {
      const frag = document.createDocumentFragment();
      movies.forEach((m, i) => {
        const card = Cards.card(m);
        card.classList.add('enter');
        card.style.setProperty('--i', i);
        frag.appendChild(card);
      });
      this.grid.appendChild(frag);
      Cards.syncMarks(this.grid, this.store);
      this.animator.decorate(this.grid);
    }

    empty() {
      const f = this.f;
      const reversed = f.yearFrom && f.yearTo && Number(f.yearFrom) > Number(f.yearTo);
      this.grid.hidden = true;
      this.showState({
        icon: '🔭', title: 'No movies found',
        text: reversed ? 'The “from” year is later than the “to” year. Change one of them and the movies will come back.'
          : f.query ? `Nothing matched “${f.query}” with these filters. Try a different spelling or loosen the filters.`
          : 'No movies match these filters. Try widening the years or lowering the rating.',
        action: 'Reset filters', onAction: () => this.resetAll()
      });
    }

    showState({ icon, title, text, action, onAction }) {
      this.state.innerHTML = `<span class="state__icon">${icon}</span><h3>${esc(title)}</h3><p>${esc(text)}</p>` + (action ? `<button class="btn" type="button">${esc(action)}</button>` : '');
      if (action) this.state.querySelector('button').addEventListener('click', onAction);
      this.state.hidden = false;
    }

    showHome() {
      this.results.hidden = true;
      this.rows.hidden = false;
    }
    showResults() {
      const wasHidden = this.results.hidden;
      this.results.hidden = false;
      this.rows.hidden = true;
      if (wasHidden) this.results.scrollIntoView({ behavior: this.animator.reduced ? 'auto' : 'smooth', block: 'start' });
    }

    // ------------------------------------------------------------------ surprise me
    async surprise() {
      const btn = $('#btn-surprise');
      if (btn.disabled) return;
      btn.disabled = true;
      try {
        const filters = { ...this.apiFilters(), sort: DEFAULT_SORT, minVotes: 500, minRating: Math.max(this.f.minRating, 6.5) };
        let data = await this.api.discover(filters, 1 + Math.floor(Math.random() * 12), 'surprise');
        if (!data.results.length) data = await this.api.discover(filters, 1, 'surprise');
        if (!data.results.length) { this.toasts.show('Nothing matched your filters. Try loosening them.'); return; }
        const movie = data.results[Math.floor(Math.random() * data.results.length)];
        this.onOpenMovie(movie, null);
      } catch (err) {
        if (err.name === 'AbortError') return;
        if (err.kind === 'auth' && this.onAuthError) this.onAuthError(err);
        this.toasts.show(err.kind === 'offline' || err.kind === 'network' ? 'You are offline. Surprises need a connection.' : 'Could not pick a movie right now.');
      } finally {
        btn.disabled = false;
      }
    }
  }

  CF.Explorer = Explorer;
})(window.CineFloat);
