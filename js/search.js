/* ==========================================================================
   search.js — SearchBox: the floating search bar.

   * waits 400 ms after the last keystroke (debounce) before asking TMDB
   * a newer keystroke cancels the older request (AbortController, channel "suggest")
   * shows up to 6 live suggestions with mini posters; keyboard: ↑ ↓ Enter Esc
   * Enter (or "See all results") hands the text to the results grid
   * remembers recent searches as chips
   ========================================================================== */
(function (CF) {
  'use strict';
  const { $, debounce, esc, year } = CF.utils;
  const { Cards } = CF;

  class SearchBox {
    /** @param {object} o { api, store, onSubmit(query), onPick(movie, thumbRect), onClear() } */
    constructor(o) {
      Object.assign(this, o);
      this.form = $('#search-form');
      this.input = $('#search-input');
      this.clearBtn = $('#search-clear');
      this.spinner = $('#search-spinner');
      this.list = $('#suggest');
      this.historyEl = $('#history');
      this.items = [];        // movies currently listed
      this.active = -1;       // keyboard-highlighted row
      this.seq = 0;           // ignore answers that belong to an older keystroke
      this.fetchLater = debounce((q) => this.fetchSuggestions(q), 400);

      this.input.addEventListener('input', () => this.onInput());
      this.input.addEventListener('focus', () => { if (this.items.length && this.input.value.trim().length > 1) this.show(); });
      this.input.addEventListener('keydown', (e) => this.onKey(e));
      this.form.addEventListener('submit', (e) => { e.preventDefault(); this.submit(); });
      this.clearBtn.addEventListener('click', () => { this.clear(); this.input.focus(); });
      this.list.addEventListener('mousedown', (e) => e.preventDefault());          // keep focus in the input
      document.addEventListener('pointerdown', (e) => { if (!this.form.contains(e.target)) this.hide(); });
      this.historyEl.addEventListener('click', (e) => this.onHistoryClick(e));
      this.historyEl.addEventListener('keydown', (e) => {
        const chip = e.target.closest('[data-q]');
        if (chip && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); this.store.removeSearch(chip.dataset.q); }
      });
      this.store.addEventListener('change', (e) => { if (e.detail.key === 'history') this.renderHistory(); });
      this.renderHistory();
    }

    get isOpen() { return !this.list.hidden; }
    focus() { this.input.focus(); this.input.select(); }

    // ------------------------------------------------------------------ typing
    onInput() {
      const q = this.input.value.trim();
      this.clearBtn.hidden = !this.input.value;
      if (q.length < 2) {                      // too short: cancel everything that is pending
        this.fetchLater.cancel();
        this.api.abort('suggest');
        this.seq++;
        this.items = [];
        this.hide();
        this.busy(false);
        if (!q && this.onClear) this.onClear();
        return;
      }
      this.busy(true);
      this.fetchLater(q);
    }

    async fetchSuggestions(q) {
      const seq = ++this.seq;
      try {
        const page = await this.api.search(q, 1, 'suggest');
        if (seq !== this.seq) return;
        this.items = page.results.slice(0, 6);
        this.render(q, page.totalResults);
      } catch (err) {
        if (err.name === 'AbortError' || seq !== this.seq) return;
        this.items = [];
        this.message(err.kind === 'offline' || err.kind === 'network' ? 'You are offline. Check your connection and try again.' : 'Search is not available right now.');
      } finally {
        if (seq === this.seq) this.busy(false);
      }
    }

    // ------------------------------------------------------------------ rendering
    render(q, total) {
      this.list.textContent = '';
      this.active = -1;
      if (!this.items.length) return this.message(`No movies found for “${q}”.`);
      this.items.forEach((movie, i) => {
        const li = document.createElement('li');
        li.className = 'suggest__item';
        li.id = 'sg-' + i;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', 'false');
        li.innerHTML =
          `<div class="suggest__thumb">${Cards.thumb(movie)}</div>` +
          `<div><div class="suggest__title">${esc(movie.title)}</div><div class="suggest__sub">${esc(Cards.subtitle(movie) || 'Movie')}</div></div>` +
          `<span class="suggest__rate">${movie.rating ? `<svg class="ico"><use href="#i-star"/></svg>${movie.rating.toFixed(1)}` : ''}</span>`;
        li.addEventListener('click', () => this.pick(i));
        li.addEventListener('pointermove', () => this.setActive(i));
        this.list.appendChild(li);
      });
      const all = document.createElement('li');
      all.className = 'suggest__item suggest__all';
      all.id = 'sg-all';
      all.setAttribute('role', 'option');
      all.setAttribute('aria-selected', 'false');
      all.textContent = `See all ${total > 20 ? total.toLocaleString() + ' ' : ''}results for “${q}” →`;
      all.addEventListener('click', () => this.submit());
      this.list.appendChild(all);
      this.show();
    }

    message(text) {
      this.list.textContent = '';
      const li = document.createElement('li');
      li.className = 'suggest__empty';
      li.textContent = text;
      this.list.appendChild(li);
      this.show();
    }

    show() {
      this.list.hidden = false;
      this.input.setAttribute('aria-expanded', 'true');
    }
    hide() {
      this.list.hidden = true;
      this.input.setAttribute('aria-expanded', 'false');
      this.input.removeAttribute('aria-activedescendant');
      this.active = -1;
    }
    busy(flag) { this.spinner.hidden = !flag; }

    // ------------------------------------------------------------------ keyboard
    onKey(e) {
      if (e.key === 'Escape' && this.isOpen) { e.preventDefault(); e.stopPropagation(); this.hide(); return; }
      if (!this.isOpen || !this.list.querySelector('[role="option"]')) return;
      const options = Array.from(this.list.querySelectorAll('[role="option"]'));
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        // States are "no row" (-1) plus every row. Shift by one so they become 0..n, step, wrap, shift back.
        const states = options.length + 1;
        const next = ((this.active + 1 + (e.key === 'ArrowDown' ? 1 : -1) + states) % states) - 1;
        this.setActive(next);
      } else if (e.key === 'Enter' && this.active >= 0) {
        e.preventDefault();
        if (this.active < this.items.length) this.pick(this.active); else this.submit();
      }
    }
    setActive(index) {
      const options = Array.from(this.list.querySelectorAll('[role="option"]'));
      options.forEach((o, i) => o.setAttribute('aria-selected', String(i === index)));
      this.active = index;
      if (index >= 0 && options[index]) {
        this.input.setAttribute('aria-activedescendant', options[index].id);
        options[index].scrollIntoView({ block: 'nearest' });
      } else this.input.removeAttribute('aria-activedescendant');
    }

    // ------------------------------------------------------------------ actions
    pick(index) {
      const movie = this.items[index];
      if (!movie) return;
      const thumb = this.list.querySelectorAll('.suggest__thumb')[index];
      const rect = thumb ? thumb.getBoundingClientRect() : null;
      this.store.addSearch(this.input.value);
      this.hide();
      this.onPick(movie, rect);
    }

    submit() {
      const q = this.input.value.trim();
      if (!q) return;
      this.fetchLater.cancel();
      this.hide();
      this.busy(false);
      this.store.addSearch(q);
      this.input.blur();
      this.onSubmit(q);
    }

    clear() {
      this.input.value = '';
      this.clearBtn.hidden = true;
      this.fetchLater.cancel();
      this.api.abort('suggest');
      this.seq++;
      this.items = [];
      this.hide();
      this.busy(false);
      if (this.onClear) this.onClear();
    }

    /** Set the text from code (used by history chips) and search. */
    run(q) {
      this.input.value = q;
      this.clearBtn.hidden = false;
      this.submit();
    }

    // ------------------------------------------------------------------ recent searches
    renderHistory() {
      const list = this.store.state.history;
      this.historyEl.hidden = !list.length;
      this.historyEl.textContent = '';
      if (!list.length) return;
      const label = document.createElement('span');
      label.className = 'history__label';
      label.textContent = 'Recent';
      this.historyEl.appendChild(label);
      list.forEach((q) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip';
        chip.dataset.q = q;
        chip.title = 'Search again (press Delete to remove)';
        chip.innerHTML = `${esc(q)} <span class="x" data-remove aria-hidden="true">×</span>`;
        this.historyEl.appendChild(chip);
      });
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'link';
      clear.dataset.clear = '1';
      clear.textContent = 'Clear';
      this.historyEl.appendChild(clear);
    }
    onHistoryClick(e) {
      if (e.target.closest('[data-clear]')) return this.store.clearHistory();
      const chip = e.target.closest('[data-q]');
      if (!chip) return;
      if (e.target.closest('[data-remove]')) return this.store.removeSearch(chip.dataset.q);
      this.run(chip.dataset.q);
    }
  }

  CF.SearchBox = SearchBox;
})(window.CineFloat);
