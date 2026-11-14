/* ==========================================================================
   panel.js — DetailPanel: the big movie sheet.

   Opening a movie:
     1. the card's poster is copied into a "flyer" that is animated (FLIP) from
        the card's position to the panel's poster slot — the shared element
     2. the panel fades in underneath, with the basic info from the list
     3. the full details (cast, trailer, providers, similar...) are fetched
        with ONE request and filled in when they arrive
   Closing runs the same flight in reverse.
   ========================================================================== */
(function (CF) {
  'use strict';
  const { esc, clamp, year, img, tier, formatRuntime } = CF.utils;
  const { Cards, Carousel } = CF;

  const initials = (name) => String(name || '?').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

  class DetailPanel {
    /** @param {object} o { root, api, store, animator, background, colors, toasts, onAuthError } */
    constructor(o) {
      Object.assign(this, o);
      this.html = document.documentElement;
      this.panel = this.root.querySelector('.detail__panel');
      this.slot = this.root.querySelector('#detail-poster');
      this.content = this.root.querySelector('#detail-content');
      this.backdrop = this.root.querySelector('.detail__backdrop');
      this.body = this.root.querySelector('.detail__body');
      this.btnWatch = this.root.querySelector('#d-watch');
      this.btnFav = this.root.querySelector('#d-fav');
      this.layer = document.getElementById('ghost-layer');

      this.isOpen = false;
      this.movie = null;
      this.seq = 0;               // every open/close bumps this, so late answers from old requests are ignored
      this.sourceCard = null;     // the card the poster flew out of
      this.ctx = null;            // { list, index } so the arrow keys can step to the next / previous movie
      this.trigger = null;
      this.flyer = null;
      this.closeTimer = 0;

      this.root.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', () => this.close()));
      this.backdrop.addEventListener('load', () => this.backdrop.classList.add('is-loaded'));
      this.btnWatch.addEventListener('click', () => this.toggle('watchlist'));
      this.btnFav.addEventListener('click', () => this.toggle('favorites'));
      this.store.addEventListener('change', () => this.syncButtons());
      this.panel.addEventListener('keydown', (e) => this.trapFocus(e));
    }

    // ------------------------------------------------------------------ open
    /**
     * @param {object} movie
     * @param {object} opts { fromRect: where the poster flies from, card: the source card element,
     *                        list: movies of the same row / grid, index: position in that list }
     */
    open(movie, { fromRect = null, card = null, list = null, index = -1 } = {}) {
      clearTimeout(this.closeTimer);
      this.cancelFlyer();
      const switching = this.isOpen;
      const seq = ++this.seq;
      this.movie = movie;
      this.ctx = list ? { list, index } : null;
      if (!switching) this.trigger = document.activeElement;

      if (this.sourceCard && this.sourceCard !== card) this.sourceCard.classList.remove('is-source');
      this.sourceCard = card;
      if (card) card.classList.add('is-source');          // the poster "leaves" its spot

      this.renderBase(movie);
      if (!switching) {
        this.root.hidden = false;
        this.root.inert = false;
        this.root.removeAttribute('aria-hidden');
        this.html.classList.add('panel-open');
        this.isOpen = true;
      }
      this.panel.scrollTop = 0;

      // Shared-element flight: poster copy flies from the card to the slot.
      const toRect = this.slot.getBoundingClientRect();
      if (fromRect && !this.animator.reduced && toRect.width) {
        this.slot.style.visibility = 'hidden';
        this.flyer = this.makeFlyer(toRect);
        this.animator.flipFrom(this.flyer, fromRect).then(() => {
          if (seq !== this.seq) return;
          this.slot.style.visibility = '';
          this.cancelFlyer();
        });
      } else if (!this.animator.reduced) {
        this.slot.animate([{ opacity: 0, transform: 'scale(0.94)' }, { opacity: 1, transform: 'none' }], { duration: 480, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
      }
      if (switching && !fromRect && !this.animator.reduced) {
        const dir = this.lastDir || 1;
        this.body.animate([{ opacity: 0, transform: `translate3d(${24 * dir}px, 0, 0)` }, { opacity: 1, transform: 'none' }], { duration: 380, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
      }

      void this.root.offsetWidth;                       // make sure the fade-in transition starts
      this.root.classList.add('is-open');
      this.panel.focus({ preventScroll: true });
      this.animator.refreshCursor();                    // the cursor still says "Open" from the card it left
      setTimeout(() => { if (seq === this.seq && this.ring) this.animateRing(this.ring, movie.rating); }, this.animator.reduced ? 0 : 420);

      this.colors.get(movie).then((c) => { if (seq === this.seq) this.background.setSelected(c); });
      this.load(movie, seq);
    }

    /** Arrow keys: show the next / previous movie of the list we came from. */
    step(direction) {
      if (!this.isOpen || !this.ctx) return;
      const index = this.ctx.index + direction;
      const movie = this.ctx.list[index];
      if (!movie) return;
      this.lastDir = direction;
      this.open(movie, { list: this.ctx.list, index });
    }

    // ------------------------------------------------------------------ close
    close() {
      if (!this.isOpen) return;
      const seq = ++this.seq;
      this.isOpen = false;
      this.api.abort('detail');
      this.background.setSelected(null);
      this.html.classList.remove('panel-open');
      this.cancelFlyer();

      const card = this.sourceCard;
      const slotRect = this.slot.getBoundingClientRect();
      const posterEl = card && card.isConnected ? card.querySelector('.card__poster') : null;
      const target = posterEl ? posterEl.getBoundingClientRect() : null;
      const visible = target && target.bottom > 0 && target.top < innerHeight && target.right > 0 && target.left < innerWidth;
      const slotShown = slotRect.bottom > 0 && slotRect.top < innerHeight;

      let delay = 360;
      if (visible && slotShown && !this.animator.reduced) {
        this.slot.style.visibility = 'hidden';
        this.flyer = this.makeFlyer(slotRect);
        const anim = this.animator.flipTo(this.flyer, target);
        delay = 480;
        if (anim) anim.finished.then(() => { if (seq === this.seq) this.cancelFlyer(); }).catch(() => {});
      }
      this.root.classList.remove('is-open');

      this.closeTimer = setTimeout(() => {
        if (seq !== this.seq) return;                  // the panel was opened again meanwhile
        this.cancelFlyer();
        this.slot.style.visibility = '';
        if (card) card.classList.remove('is-source');
        this.sourceCard = null;
        this.root.hidden = true;
        this.root.inert = true;
        this.root.setAttribute('aria-hidden', 'true');
        this.content.textContent = '';
        this.animator.hideCursor(false);
        this.animator.refreshCursor();
      }, delay);

      const back = this.trigger && this.trigger.isConnected ? this.trigger : null;
      if (back && back.focus) back.focus({ preventScroll: true });
    }

    makeFlyer(rect) {
      const el = document.createElement('div');
      el.className = 'flyer';
      el.style.left = rect.left + 'px';
      el.style.top = rect.top + 'px';
      el.style.width = rect.width + 'px';
      el.style.height = rect.height + 'px';
      el.innerHTML = this.slot.innerHTML;
      el.querySelectorAll('img').forEach((i) => i.classList.add('is-loaded'));
      this.layer.appendChild(el);
      return el;
    }
    cancelFlyer() {
      if (this.flyer) { this.flyer.remove(); this.flyer = null; }
    }

    // ------------------------------------------------------------------ rendering
    renderBase(movie) {
      const y = year(movie.date);
      const genres = (movie.genreIds || []).map((id) => Cards.genres.get(id)).filter(Boolean);

      this.slot.innerHTML = Cards.posterHtml(movie);
      Cards.finish(this.slot, movie.title);
      this.backdrop.classList.remove('is-loaded');
      if (movie.backdropPath) this.backdrop.src = img.backdrop(movie.backdropPath); else this.backdrop.removeAttribute('src');

      this.content.innerHTML =
        `<h2 class="dtitle reveal" id="detail-title">${esc(movie.title)}${y ? `<small>(${y})</small>` : ''}</h2>` +
        `<p class="dtagline reveal" data-fill="tagline" hidden></p>` +
        `<div class="meta reveal" data-fill="meta">${y ? `<span>${y}</span>` : ''}</div>` +
        `<div class="tags reveal" data-fill="tags">${genres.map((g) => `<span class="tag">${esc(g)}</span>`).join('')}</div>` +
        `<div class="score reveal">${this.ringHtml(movie.rating)}<div class="score__text"><strong>${movie.rating ? 'User score' : 'Not rated yet'}</strong>` +
        `<span>${movie.votes ? movie.votes.toLocaleString() + ' votes on TMDB' : 'No votes yet'}</span></div></div>` +
        `<p class="overview reveal">${esc(movie.overview) || 'No overview available yet.'}</p>` +
        `<dl class="crew reveal" data-fill="crew"></dl>` +
        `<div data-fill="sections"><div class="dsec dsec--skeleton reveal"><div class="sk"></div><div class="sk"></div></div></div>`;
      this.content.querySelectorAll('.reveal').forEach((el, i) => el.style.setProperty('--i', i));
      this.ring = this.content.querySelector('.ring');
      this.syncButtons();
    }

    ringHtml(rating) {
      const label = rating ? `User score ${rating.toFixed(1)} out of 10` : 'Not rated yet';
      return `<div class="ring" data-tier="${tier(rating)}" role="img" aria-label="${label}">` +
        `<span class="ring__track"></span><span class="ring__half ring__half--r"><span class="ring__fill"></span></span>` +
        `<span class="ring__half ring__half--l"><span class="ring__fill"></span></span><span class="ring__value">${rating ? '0.0' : 'NR'}</span></div>`;
    }

    /** Sweep the ring with two rotating half-rings (transform only) and count the number up. */
    animateRing(ring, rating) {
      if (!rating || !ring.isConnected) return;
      const value = ring.querySelector('.ring__value');
      if (this.animator.reduced) { value.textContent = rating.toFixed(1); ring.classList.add('ring--go'); ring.style.setProperty('--r1', `${Math.min(rating * 36, 180) - 225}deg`); ring.style.setProperty('--r2', `${Math.max(0, rating * 36 - 180) - 45}deg`); return; }
      const deg = clamp(rating / 10, 0, 1) * 360;
      const total = 0.5 + (deg / 360) * 0.9;                       // seconds
      const first = Math.min(deg, 180), second = Math.max(0, deg - 180);
      const d1 = total * (first / deg);
      ring.style.setProperty('--r1', `${first - 225}deg`);
      ring.style.setProperty('--r2', `${second - 45}deg`);
      ring.style.setProperty('--d1', `${d1.toFixed(3)}s`);
      ring.style.setProperty('--d2', `${(total - d1).toFixed(3)}s`);
      ring.classList.add('ring--go');
      const t0 = performance.now();
      const tick = (now) => {
        const p = Math.min(1, (now - t0) / (total * 1000));
        value.textContent = (rating * p).toFixed(1);
        if (p < 1 && ring.isConnected) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }

    async load(movie, seq) {
      try {
        const details = await this.api.details(movie.id);
        if (seq !== this.seq) return;
        this.fill(movie, details);
      } catch (err) {
        if (err.name === 'AbortError' || seq !== this.seq) return;
        if (err.kind === 'auth' && this.onAuthError) this.onAuthError(err);
        this.fillError(movie, err, seq);
      }
    }

    fillError(movie, err, seq) {
      const holder = this.content.querySelector('[data-fill="sections"]');
      if (!holder) return;
      const offline = err.kind === 'offline' || err.kind === 'network';
      holder.innerHTML = `<div class="state state--inline"><span class="state__icon">${offline ? '📡' : '🎞️'}</span>` +
        `<h3>${offline ? 'You seem to be offline' : 'Could not load the full details'}</h3>` +
        `<p>${offline ? 'The basics are shown above. Reconnect to see cast, trailer and more.' : esc(err.message)}</p>` +
        `<button class="btn" type="button" data-retry>Try again</button></div>`;
      holder.querySelector('[data-retry]').addEventListener('click', () => {
        holder.innerHTML = '<div class="dsec dsec--skeleton"><div class="sk"></div><div class="sk"></div></div>';
        this.load(movie, seq);
      });
    }

    /** Replace the placeholders with the real details. */
    fill(movie, d) {
      const c = this.content;
      const tag = c.querySelector('[data-fill="tagline"]');
      if (d.tagline) { tag.textContent = d.tagline; tag.hidden = false; }

      const meta = [year(d.date), formatRuntime(d.runtime), d.language ? d.language.toUpperCase() : '', d.status && d.status !== 'Released' ? d.status : ''].filter(Boolean);
      c.querySelector('[data-fill="meta"]').innerHTML = meta.map((m) => `<span>${esc(m)}</span>`).join('');
      if (d.genres.length) c.querySelector('[data-fill="tags"]').innerHTML = d.genres.map((g) => `<span class="tag">${esc(g)}</span>`).join('');
      if (d.overview) c.querySelector('.overview').textContent = d.overview;
      if (!this.backdrop.getAttribute('src') && d.backdropPath) this.backdrop.src = img.backdrop(d.backdropPath);

      const crew = [];
      if (d.directors.length) crew.push([d.directors.length > 1 ? 'Directors' : 'Director', d.directors.join(', ')]);
      if (d.writers.length) crew.push(['Writing', d.writers.join(', ')]);
      c.querySelector('[data-fill="crew"]').innerHTML = crew.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('');

      const holder = c.querySelector('[data-fill="sections"]');
      holder.innerHTML = this.sectionsHtml(d);
      let n = c.querySelectorAll('.reveal').length - holder.querySelectorAll('.reveal').length;
      holder.querySelectorAll('.reveal').forEach((el) => el.style.setProperty('--i', n++));

      this.wireTrailer(holder, d);
      this.wireCast(holder);
      this.wireSimilar(holder, d);
    }

    sectionsHtml(d) {
      const out = [];
      // Trailer: a poster with a play button; the YouTube player is only created when you click it.
      if (d.trailers.length) {
        const first = d.trailers[0];
        const others = d.trailers.slice(1).map((t, i) => `<button class="link" type="button" data-trailer="${esc(t.key)}">${esc(t.type)}${i ? ' ' + (i + 1) : ''}</button>`).join('');
        out.push(`<section class="dsec reveal"><h3>Trailer</h3><div class="trailer" data-trailer-box>` +
          `${d.backdropPath ? `<img class="trailer__poster" src="${img.backdrop(d.backdropPath)}" alt="" draggable="false">` : ''}` +
          `<button class="trailer__play" type="button" data-trailer="${esc(first.key)}" aria-label="Play ${esc(first.type.toLowerCase())}"><span class="trailer__btn"><svg class="ico"><use href="#i-play"/></svg></span></button></div>` +
          `<div class="trailer__alt"><a class="link" href="https://www.youtube.com/watch?v=${encodeURIComponent(first.key)}" target="_blank" rel="noopener noreferrer">Watch on YouTube</a>${others}</div></section>`);
      } else {
        out.push('<section class="dsec reveal"><h3>Trailer</h3><p class="muted">No trailer available for this movie yet.</p></section>');
      }
      if (d.cast.length) {
        out.push(`<section class="dsec reveal"><h3>Cast</h3><div class="carousel carousel--tight" data-cast><div class="carousel__viewport"><div class="carousel__track">` +
          d.cast.map((p) => `<div class="person"><div class="person__photo">${p.photo ? `<img src="${img.profile(p.photo)}" alt="" loading="lazy" draggable="false">` : esc(initials(p.name))}</div>` +
            `<div class="person__name">${esc(p.name)}</div><div class="person__role">${esc(p.character)}</div></div>`).join('') +
          `</div></div></div></section>`);
      }
      out.push(this.providersHtml(d.providers));
      if (d.recommendations.length) {
        out.push(`<section class="dsec reveal"><h3>Similar movies</h3><div class="carousel carousel--tight carousel--cards" data-similar><div class="carousel__viewport"><div class="carousel__track"></div></div></div></section>`);
      }
      return out.join('');
    }

    providersHtml(p) {
      let html = '<section class="dsec reveal"><h3>Where to watch</h3>';
      if (p.available) {
        html += p.groups.map((g) => `<div class="prov-group"><span class="prov-group__label">${g.label}</span>` +
          g.items.slice(0, 8).map((i) => `<span class="prov" title="${esc(i.name)}">${i.logo ? `<img src="${img.logo(i.logo)}" alt="${esc(i.name)}" loading="lazy">` : esc(initials(i.name))}</span>`).join('') + '</div>').join('');
        if (p.link) html += `<a class="link" href="${esc(p.link)}" target="_blank" rel="noopener noreferrer">See all options (${esc(p.region)})</a>`;
      } else {
        html += `<p class="muted">No streaming information for ${esc(p.region)} right now.</p>`;
      }
      return html + '<p class="attrib">Streaming data provided by JustWatch.</p></section>';
    }

    wireTrailer(holder, d) {
      const box = holder.querySelector('[data-trailer-box]');
      if (!box) return;
      const play = (key) => {
        box.textContent = '';
        const frame = document.createElement('iframe');
        frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(key)}?autoplay=1&rel=0&modestbranding=1&playsinline=1`;
        frame.title = `${this.movie.title} trailer`;
        // "fullscreen" in `allow` is enough; adding the older allowfullscreen attribute too makes Chrome warn.
        frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
        frame.referrerPolicy = 'strict-origin-when-cross-origin';
        frame.addEventListener('mouseenter', () => this.animator.hideCursor(true));
        frame.addEventListener('mouseleave', () => this.animator.hideCursor(false));
        box.appendChild(frame);
      };
      holder.querySelectorAll('[data-trailer]').forEach((b) => b.addEventListener('click', () => play(b.dataset.trailer)));
    }

    wireCast(holder) {
      const el = holder.querySelector('[data-cast]');
      if (el) new Carousel(el, { arrows: false });
    }

    wireSimilar(holder, d) {
      const el = holder.querySelector('[data-similar]');
      if (!el) return;
      const track = el.querySelector('.carousel__track');
      d.recommendations.forEach((m) => track.appendChild(Cards.card(m)));
      Cards.syncMarks(el, this.store);
      this.animator.decorate(el);
      new Carousel(el);
    }

    // ------------------------------------------------------------------ buttons + focus
    toggle(list) {
      if (!this.movie) return;
      const now = this.store.toggle(list, this.movie);
      const name = list === 'watchlist' ? 'Watchlist' : 'Favorites';
      this.toasts.show(now ? `Saved to ${name}` : `Removed from ${name}`);
    }
    syncButtons() {
      if (!this.movie) return;
      const w = this.store.has('watchlist', this.movie.id), f = this.store.has('favorites', this.movie.id);
      this.btnWatch.setAttribute('aria-pressed', String(w));
      this.btnWatch.querySelector('span').textContent = w ? 'In watchlist' : 'Watchlist';
      this.btnFav.setAttribute('aria-pressed', String(f));
      this.btnFav.querySelector('span').textContent = f ? 'Favorited' : 'Favorite';
    }
    trapFocus(e) {
      if (e.key !== 'Tab') return;
      const items = Array.from(this.panel.querySelectorAll('button:not([disabled]):not([tabindex="-1"]), a[href], [tabindex="0"], iframe'))
        .filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === this.panel)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  CF.DetailPanel = DetailPanel;
})(window.CineFloat);
