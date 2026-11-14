/* ==========================================================================
   colors.js — ColorExtractor: finds the dominant colours of a poster.

   How: draw a tiny (24x36) copy of the poster on a <canvas>, group the pixels
   into 12 hue "buckets" (weighted towards vivid, bright pixels) and take the
   biggest two buckets. If the image host does not allow reading pixels (CORS)
   or the image fails to load, we fall back to a stable colour made from the
   movie id, so the background still changes.
   ========================================================================== */
(function (CF) {
  'use strict';
  const { hash, img } = CF.utils;
  const SAVE_KEY = 'cinefloat:colors:v1';

  const rgbToHsv = (r, g, b) => {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return [h, max ? d / max : 0, max];
  };
  const hsvToRgb = (h, s, v) => {
    const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  };

  class ColorExtractor {
    constructor() {
      this.cache = new Map();    // key -> { a:[r,g,b], b:[r,g,b] }
      this.pending = new Map();  // key -> Promise (so one poster is never analysed twice at once)
      try {
        const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
        Object.keys(saved).forEach((k) => this.cache.set(k, saved[k]));
      } catch (e) { /* ignore */ }
    }

    /** Resolves to { a:[r,g,b], b:[r,g,b] } for a movie. Never rejects. */
    get(movie) {
      const key = movie.posterPath ? movie.posterPath : 'id' + movie.id;
      if (this.cache.has(key)) return Promise.resolve(this.cache.get(key));
      if (this.pending.has(key)) return this.pending.get(key);

      const job = (movie.posterPath ? this.sample(img.poster(movie.posterPath, 'w92')) : Promise.reject(new Error('no poster')))
        .then((colors) => { this.remember(key, colors, true); return colors; })
        .catch(() => { const colors = this.fallback(movie.id || key); this.remember(key, colors, false); return colors; })
        .finally(() => this.pending.delete(key));
      this.pending.set(key, job);
      return job;
    }

    /** Synchronous peek (returns null when we have not analysed this poster yet). */
    peek(movie) {
      return this.cache.get(movie.posterPath ? movie.posterPath : 'id' + movie.id) || null;
    }

    remember(key, colors, persist) {
      this.cache.set(key, colors);
      if (!persist) return;
      try {
        const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
        saved[key] = colors;
        const keys = Object.keys(saved);
        if (keys.length > 400) keys.slice(0, 100).forEach((k) => delete saved[k]); // keep it small
        localStorage.setItem(SAVE_KEY, JSON.stringify(saved));
      } catch (e) { /* ignore */ }
    }

    /** Stable pseudo-random colours from an id. */
    fallback(seed) {
      const hue = hash(seed) % 360;
      return { a: hsvToRgb(hue, 0.65, 0.95), b: hsvToRgb((hue + 55) % 360, 0.6, 0.85) };
    }

    sample(url) {
      return new Promise((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = 'anonymous'; // needed to read pixels; display <img> tags do NOT use it
        const timer = setTimeout(() => reject(new Error('timeout')), 5000);
        image.onload = () => {
          clearTimeout(timer);
          try { resolve(this.analyse(image)); } catch (e) { reject(e); } // tainted canvas -> fallback
        };
        image.onerror = () => { clearTimeout(timer); reject(new Error('load')); };
        image.src = url;
      });
    }

    analyse(image) {
      const W = 24, H = 36;
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(image, 0, 0, W, H);
      const data = ctx.getImageData(0, 0, W, H).data; // throws if the canvas is tainted

      const buckets = Array.from({ length: 12 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
      let sr = 0, sg = 0, sb = 0, n = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue;
        const [h, s, v] = rgbToHsv(data[i], data[i + 1], data[i + 2]);
        sr += data[i]; sg += data[i + 1]; sb += data[i + 2]; n++;
        if (v < 0.14 || s < 0.16) continue;            // skip near-black and grey pixels
        const weight = s * s * v;                        // vivid + bright pixels count more
        const bucket = buckets[Math.floor(h / 30) % 12];
        bucket.w += weight; bucket.r += data[i] * weight; bucket.g += data[i + 1] * weight; bucket.b += data[i + 2] * weight;
      }
      const ranked = buckets.map((b, i) => ({ ...b, i })).filter((b) => b.w > 0).sort((x, y) => y.w - x.w);
      if (!ranked.length) {                              // grey / black-and-white poster
        const avg = n ? [sr / n, sg / n, sb / n].map(Math.round) : [110, 110, 140];
        const [h, s, v] = rgbToHsv(...avg);
        return { a: hsvToRgb(h, Math.max(s, 0.25), Math.max(v, 0.7)), b: hsvToRgb((h + 40) % 360, 0.35, 0.6) };
      }
      const toRgb = (b) => this.vivid([b.r / b.w, b.g / b.w, b.b / b.w].map(Math.round));
      const first = ranked[0];
      const second = ranked.find((b) => {
        const gap = Math.abs(b.i - first.i);
        return b !== first && Math.min(gap, 12 - gap) >= 2; // a clearly different hue
      });
      const a = toRgb(first);
      if (second) return { a, b: toRgb(second) };
      const [h, s, v] = rgbToHsv(...a);
      return { a, b: hsvToRgb((h + 45) % 360, s, v) };
    }

    /** Lift dull colours a little so the background glows. */
    vivid(rgb) {
      const [h, s, v] = rgbToHsv(...rgb);
      return hsvToRgb(h, Math.min(1, Math.max(s, 0.45) * 1.1), Math.min(1, Math.max(v, 0.7)));
    }
  }

  CF.ColorExtractor = ColorExtractor;
})(window.CineFloat);
