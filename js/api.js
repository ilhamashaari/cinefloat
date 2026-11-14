/* ==========================================================================
   api.js — ApiService: the ONLY file that talks to TMDB.

   What it does for you:
   * sends the v4 Read Access Token in an  Authorization: Bearer  header
   * caches every answer in memory AND localStorage (with a time-to-live)
   * cancels stale requests with AbortController ("channels": a new request on a
     channel aborts the previous one, e.g. typing a new search letter)
   * turns failures into friendly ApiError kinds: auth, offline, network,
     ratelimit, notfound, server
   * serves expired cache entries when you are offline ("stale if error")
   ========================================================================== */
(function (CF) {
  'use strict';
  const { hash, sleep } = CF.utils;

  const MIN = 60 * 1000;
  const DAY = 24 * 60 * MIN;
  const TTL = { list: 10 * MIN, search: 5 * MIN, detail: 30 * MIN, genres: 7 * DAY };
  const KEEP_STALE = 7 * DAY; // expired entries stay this long as an offline fallback

  class ApiError extends Error {
    constructor(kind, message, status = 0) {
      super(message);
      this.name = 'ApiError';
      this.kind = kind; // 'auth' | 'offline' | 'network' | 'ratelimit' | 'notfound' | 'server' | 'client'
      this.status = status;
    }
  }

  class ApiService extends EventTarget {
    constructor(config = {}) {
      super();
      this.base = 'https://api.themoviedb.org/3';
      this.token = String(config.TMDB_READ_TOKEN || '').trim();
      this.language = config.LANGUAGE || 'en-US';
      this.region = String(config.REGION || this.language.split('-')[1] || 'US').toUpperCase();
      this.includeAdult = !!config.INCLUDE_ADULT;

      this.memory = new Map();        // cache key -> { exp, data }
      this.controllers = new Map();   // channel name -> AbortController
      this.prefix = 'cinefloat:cache:v1:';
      this.index = this.loadIndex();  // hash -> expiry time (small, so we can evict cheaply)
      this.purgeOld();
    }

    /** True when config.js contains something that looks like a real token. */
    get hasToken() {
      return this.token.length > 20 && !/PASTE_YOUR/i.test(this.token);
    }

    // ------------------------------------------------------------------
    // Core request: memory cache -> localStorage cache -> network
    // ------------------------------------------------------------------
    /**
     * @param {string} path     e.g. '/movie/popular'
     * @param {object} params   query-string parameters
     * @param {object} opts     ttl (ms), channel (abort group), transform (shrink the JSON before caching)
     */
    async request(path, params = {}, { ttl = TTL.list, channel = null, transform = null } = {}) {
      if (!this.hasToken) throw new ApiError('auth', 'No TMDB token is configured.');

      const query = new URLSearchParams({ language: this.language, ...params });
      query.sort(); // stable key order -> identical requests share one cache entry
      const key = `${path}?${query}`;

      // 1) memory, 2) localStorage
      const mem = this.memory.get(key);
      if (mem && mem.exp > Date.now()) return mem.data;
      const saved = this.readStorage(key);
      if (saved && saved.exp > Date.now()) {
        this.memory.set(key, saved);
        return saved.data;
      }

      // 3) network (a new request on the same channel cancels the previous one)
      let controller = null;
      if (channel) {
        const previous = this.controllers.get(channel);
        if (previous) previous.abort();
        controller = new AbortController();
        this.controllers.set(channel, controller);
      }
      try {
        const json = await this.fetchJson(`${this.base}${path}?${query}`, controller && controller.signal);
        const data = transform ? transform(json) : json;
        const entry = { exp: Date.now() + ttl, data };
        this.memory.set(key, entry);
        this.writeStorage(key, entry);
        return data;
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        const stale = mem || saved; // expired copy? better than nothing when the network fails
        if (stale && ['offline', 'network', 'server'].includes(err.kind)) {
          this.dispatchEvent(new CustomEvent('stale'));
          return stale.data;
        }
        throw err;
      } finally {
        if (controller && this.controllers.get(channel) === controller) this.controllers.delete(channel);
      }
    }

    /** Cancel whatever request is running on a channel. */
    abort(channel) {
      const c = this.controllers.get(channel);
      if (c) c.abort();
      this.controllers.delete(channel);
    }

    async fetchJson(url, signal, attempt = 0) {
      let res;
      try {
        res = await fetch(url, {
          signal,
          headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' }
        });
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        throw new ApiError(navigator.onLine === false ? 'offline' : 'network', 'The network request failed.');
      }
      if (res.status === 429 && attempt < 2) {            // rate limited: wait politely, then retry
        await sleep(Math.min((Number(res.headers.get('Retry-After')) || 1) * 1000, 4000));
        return this.fetchJson(url, signal, attempt + 1);
      }
      if (res.ok) return res.json();

      let message = '';
      try { message = (await res.json()).status_message || ''; } catch (e) { /* body was not JSON */ }
      const kind = res.status === 401 || res.status === 403 ? 'auth'
        : res.status === 404 ? 'notfound'
        : res.status === 429 ? 'ratelimit'
        : res.status >= 500 ? 'server' : 'client';
      throw new ApiError(kind, message || `TMDB answered with HTTP ${res.status}.`, res.status);
    }

    // ------------------------------------------------------------------
    // localStorage cache (with a tiny index so eviction never parses big entries)
    // ------------------------------------------------------------------
    loadIndex() {
      try { return JSON.parse(localStorage.getItem(this.prefix + 'index') || '{}'); } catch (e) { return {}; }
    }
    saveIndex() {
      try { localStorage.setItem(this.prefix + 'index', JSON.stringify(this.index)); } catch (e) { /* storage full or blocked */ }
    }
    readStorage(key) {
      try {
        const raw = localStorage.getItem(this.prefix + hash(key));
        if (!raw) return null;
        const entry = JSON.parse(raw);
        return entry.k === key ? entry : null; // guards against (very unlikely) hash collisions
      } catch (e) { return null; }
    }
    writeStorage(key, entry) {
      const id = hash(key);
      const text = JSON.stringify({ k: key, exp: entry.exp, data: entry.data });
      if (text.length > 250000) return; // never let one response eat the quota
      const put = () => { localStorage.setItem(this.prefix + id, text); this.index[id] = entry.exp; this.saveIndex(); };
      try { put(); } catch (e) {
        this.evict(0.4);                 // quota hit: drop the oldest 40 % and try once more
        try { put(); } catch (e2) { /* give up silently, the memory cache still works */ }
      }
    }
    evict(fraction) {
      const ids = Object.keys(this.index).sort((a, b) => this.index[a] - this.index[b]);
      ids.slice(0, Math.max(1, Math.ceil(ids.length * fraction))).forEach((id) => {
        try { localStorage.removeItem(this.prefix + id); } catch (e) { /* ignore */ }
        delete this.index[id];
      });
      this.saveIndex();
    }
    purgeOld() {
      const limit = Date.now() - KEEP_STALE;
      let changed = false;
      Object.keys(this.index).forEach((id) => {
        if (this.index[id] < limit) {
          try { localStorage.removeItem(this.prefix + id); } catch (e) { /* ignore */ }
          delete this.index[id];
          changed = true;
        }
      });
      if (changed) this.saveIndex();
    }

    // ------------------------------------------------------------------
    // Normalisers: keep only the fields the UI needs (small = fast + cacheable)
    // ------------------------------------------------------------------
    static movie(m) {
      return {
        id: m.id,
        title: m.title || m.name || 'Untitled',
        posterPath: m.poster_path || null,
        backdropPath: m.backdrop_path || null,
        rating: Math.round((m.vote_average || 0) * 10) / 10,
        votes: m.vote_count || 0,
        date: m.release_date || '',
        overview: m.overview || '',
        genreIds: m.genre_ids || (m.genres || []).map((g) => g.id),
        popularity: m.popularity || 0
      };
    }
    static page(raw) {
      return {
        page: raw.page || 1,
        totalPages: Math.min(raw.total_pages || 1, 500), // TMDB never serves pages above 500
        totalResults: raw.total_results || 0,
        results: (raw.results || []).map(ApiService.movie)
      };
    }

    // ------------------------------------------------------------------
    // Public endpoints
    // ------------------------------------------------------------------
    trending(page = 1) { return this.request('/trending/movie/week', { page }, { ttl: TTL.list, transform: ApiService.page }); }
    popular(page = 1) { return this.request('/movie/popular', { page }, { ttl: TTL.list, transform: ApiService.page }); }
    topRated(page = 1) { return this.request('/movie/top_rated', { page }, { ttl: TTL.list, transform: ApiService.page }); }
    nowPlaying(page = 1) { return this.request('/movie/now_playing', { page }, { ttl: TTL.list, transform: ApiService.page }); }

    async genres() {
      const list = await this.request('/genre/movie/list', {}, { ttl: TTL.genres, transform: (r) => r.genres || [] });
      return list;
    }

    /** Text search. `channel` lets suggestions and full results cancel each other independently. */
    search(query, page = 1, channel = 'search') {
      return this.request('/search/movie', { query, page, include_adult: this.includeAdult }, { ttl: TTL.search, channel, transform: ApiService.page });
    }

    /**
     * Browse with filters. (The search endpoint cannot filter, so this uses /discover/movie.)
     * filters: { genres: [id], genreMode: 'and'|'or', yearFrom, yearTo, minRating, sort, minVotes }
     */
    discover(filters = {}, page = 1, channel = 'results') {
      const sort = filters.sort || 'popularity.desc';
      const params = { page, sort_by: sort, include_adult: this.includeAdult, include_video: false };
      if (filters.genres && filters.genres.length) params.with_genres = filters.genres.join(filters.genreMode === 'or' ? '|' : ',');
      if (filters.yearFrom) params['primary_release_date.gte'] = `${filters.yearFrom}-01-01`;
      if (filters.yearTo) params['primary_release_date.lte'] = `${filters.yearTo}-12-31`;
      if (filters.minRating) params['vote_average.gte'] = filters.minRating;
      // Without a vote floor, "highest rated" would show obscure films with a single 10/10 vote.
      params['vote_count.gte'] = filters.minVotes != null ? filters.minVotes : sort.startsWith('vote_average') ? 300 : sort.startsWith('revenue') ? 200 : 25;
      return this.request('/discover/movie', params, { ttl: TTL.list, channel, transform: ApiService.page });
    }

    /** Full movie details in ONE request (videos, credits, recommendations, watch providers). */
    details(id) {
      const lang = this.language.slice(0, 2);
      return this.request(
        `/movie/${id}`,
        { append_to_response: 'videos,credits,recommendations,watch/providers', include_video_language: `${lang},en,null` },
        { ttl: TTL.detail, channel: 'detail', transform: (raw) => this.normalizeDetails(raw) }
      );
    }

    normalizeDetails(d) {
      const crew = (d.credits && d.credits.crew) || [];
      const unique = (list) => [...new Set(list)];
      const videos = ((d.videos && d.videos.results) || [])
        .filter((v) => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser'))
        .sort((a, b) =>
          (b.official ? 1 : 0) - (a.official ? 1 : 0) ||
          (a.type === 'Trailer' ? 0 : 1) - (b.type === 'Trailer' ? 0 : 1) ||
          String(b.published_at).localeCompare(String(a.published_at)))
        .slice(0, 4)
        .map((v) => ({ key: v.key, name: v.name, type: v.type }));

      return {
        ...ApiService.movie(d),
        tagline: d.tagline || '',
        runtime: d.runtime || 0,
        status: d.status || '',
        language: d.original_language || '',
        genres: (d.genres || []).map((g) => g.name),
        imdbId: d.imdb_id || '',
        directors: unique(crew.filter((c) => c.job === 'Director').map((c) => c.name)).slice(0, 3),
        writers: unique(crew.filter((c) => ['Writer', 'Screenplay', 'Story'].includes(c.job)).map((c) => c.name)).slice(0, 3),
        cast: ((d.credits && d.credits.cast) || []).slice(0, 20).map((c) => ({ id: c.id, name: c.name, character: c.character || '', photo: c.profile_path || null })),
        trailers: videos,
        recommendations: ((d.recommendations && d.recommendations.results) || []).slice(0, 18).map(ApiService.movie),
        providers: this.pickProviders(d['watch/providers'])
      };
    }

    /** Streaming data is per country; we show the one set in config.js (REGION). */
    pickProviders(block) {
      const entry = block && block.results && block.results[this.region];
      if (!entry) return { region: this.region, available: false, link: '', groups: [] };
      const pack = (label, list) => ({
        label,
        items: (list || []).map((p) => ({ id: p.provider_id, name: p.provider_name, logo: p.logo_path || null }))
      });
      const groups = [pack('Stream', entry.flatrate), pack('Free', [...(entry.free || []), ...(entry.ads || [])]), pack('Rent', entry.rent), pack('Buy', entry.buy)]
        .filter((g) => g.items.length);
      return { region: this.region, available: groups.length > 0, link: entry.link || '', groups };
    }
  }

  CF.ApiError = ApiError;
  CF.ApiService = ApiService;
})(window.CineFloat);
