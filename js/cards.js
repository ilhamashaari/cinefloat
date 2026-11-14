/* ==========================================================================
   cards.js — Cards: builds poster cards, small thumbnails, the "no poster"
   placeholder and skeleton loaders. Pure rendering, no business logic.

   Note: the page has a strict Content Security Policy, so we never write
   style="..." into HTML strings. Dynamic styles are set from JS instead.
   ========================================================================== */
(function (CF) {
  'use strict';
  const { esc, hash, year, img, tier } = CF.utils;

  const Cards = {
    genres: new Map(),   // genre id -> name (filled once /genre/movie/list arrives)

    /** Remember genre names and refresh the subtitle of cards that are already on screen. */
    setGenres(list) {
      Cards.genres = new Map(list.map((g) => [g.id, g.name]));
      document.querySelectorAll('.card').forEach((card) => {
        const sub = card.querySelector('.card__sub');
        if (sub && card.cfMovie) sub.textContent = Cards.subtitle(card.cfMovie);
      });
    },

    subtitle(movie) {
      const first = (movie.genreIds || []).map((id) => Cards.genres.get(id)).find(Boolean);
      return [year(movie.date), first].filter(Boolean).join(' · ');
    },

    // ---- poster pieces --------------------------------------------------
    placeholderHtml(title) {
      const letter = (String(title).trim()[0] || '?').toUpperCase();
      // data-h picks one of 36 hues in cards.css (no inline style, see the note at the top of this file)
      return `<div class="ph" data-h="${hash(title) % 36}"><i class="ph__film ph__film--l"></i><i class="ph__film ph__film--r"></i>` +
        `<span class="ph__letter">${esc(letter)}</span><span class="ph__title">${esc(title)}<span class="ph__sub">No poster</span></span></div>`;
    },
    posterHtml(movie, size = 'w500') {
      if (!movie.posterPath) return Cards.placeholderHtml(movie.title);
      return `<img class="card__img" src="${img.poster(movie.posterPath, size)}" alt="" loading="lazy" decoding="async" draggable="false">`;
    },

    /** After inserting HTML: fade posters in (or swap a broken image for the placeholder). */
    finish(root, title) {
      root.querySelectorAll('img.card__img').forEach((image) => {
        const show = () => image.classList.add('is-loaded');
        if (image.complete && image.naturalWidth) show();
        else {
          image.addEventListener('load', show, { once: true });
          image.addEventListener('error', () => {
            const holder = document.createElement('div');
            holder.innerHTML = Cards.placeholderHtml(title || 'Poster');
            image.replaceWith(holder.firstChild);
            Cards.finish(root, title);
          }, { once: true });
        }
      });
    },

    // ---- the poster card ------------------------------------------------
    card(movie) {
      const el = document.createElement('article');
      const y = year(movie.date);
      el.className = 'card';
      el.tabIndex = 0;
      el.dataset.id = movie.id;
      el.dataset.cursor = 'Open';
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', `${movie.title}${y ? ` (${y})` : ''}${movie.rating ? `, rated ${movie.rating} out of 10` : ''}`);
      el.innerHTML =
        `<div class="card__float"><div class="card__tilt"><div class="card__poster">` +
          Cards.posterHtml(movie) +
          `<span class="card__shine"></span>` +
          `<span class="card__rate" data-tier="${tier(movie.rating)}"><svg class="ico"><use href="#i-star"/></svg>${movie.rating ? movie.rating.toFixed(1) : 'NR'}</span>` +
          `<span class="card__marks"><span class="mark mark--watch" title="In your watchlist"><svg class="ico"><use href="#i-bookmark"/></svg></span>` +
          `<span class="mark mark--fav" title="Favorite"><svg class="ico"><use href="#i-heart"/></svg></span></span>` +
        `</div></div></div>` +
        `<div class="card__meta"><h3 class="card__title">${esc(movie.title)}</h3><p class="card__sub">${esc(Cards.subtitle(movie))}</p></div>`;
      el.cfMovie = movie;               // the drag-and-drop code and the click handler read the movie from here
      Cards.finish(el, movie.title);
      return el;
    },

    /** HTML for the small poster used in suggestions, the library drawer and the like. */
    thumb(movie) {
      return movie.posterPath
        ? `<img src="${img.poster(movie.posterPath, 'w92')}" alt="" loading="lazy" decoding="async" draggable="false">`
        : Cards.placeholderHtml(movie.title);
    },

    skeleton(count) {
      const frag = document.createDocumentFragment();
      for (let i = 0; i < count; i++) {
        const el = document.createElement('div');
        el.className = 'card card--skeleton';
        el.setAttribute('aria-hidden', 'true');
        el.innerHTML = '<div class="card__float"><div class="card__poster sk"></div></div><div class="card__meta"><div class="sk sk--line"></div><div class="sk sk--line"></div></div>';
        frag.appendChild(el);
      }
      return frag;
    },

    /** Mark cards that are in the watchlist / favorites (shows a small badge). */
    syncMarks(root, store) {
      root.querySelectorAll('.card').forEach((card) => {
        const id = Number(card.dataset.id);
        card.toggleAttribute('data-watch', store.has('watchlist', id));
        card.toggleAttribute('data-fav', store.has('favorites', id));
      });
    }
  };

  CF.Cards = Cards;
})(window.CineFloat);
