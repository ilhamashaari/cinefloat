/* ==========================================================================
   dragthrow.js — DragThrow: pick a poster up, throw it, watch it spring back,
   or drop it on the Watchlist / Favorites zone.

   How it works (read top to bottom):
   1. pointerdown on a card starts a "candidate" (we do not know yet if the
      user wants to click, drag the poster, or swipe a carousel).
   2. The candidate becomes a real drag ("claim") when:
        mouse : the pointer moves > 8 px (in a carousel: mostly vertically, or after holding 0.3 s)
        touch : the finger is held still for 0.26 s (moving first means "scroll / swipe")
   3. A "ghost" copy of the poster is placed in a fixed layer on top of the page
      (so no carousel can clip it) and the real poster is hidden (opacity 0).
   4. While dragging, the ghost follows the pointer and leans with its speed.
   5. On release we either fly into a drop zone, or run a SPRING simulation
      that starts with the release velocity (so it is "thrown") and pulls the
      ghost back home. When it settles, the ghost is removed.
   ========================================================================== */
(function (CF) {
  'use strict';
  const { clamp } = CF.utils;
  const gesture = CF.gesture;

  const LONG_PRESS = 260;       // ms (touch)
  const HOLD_FOR_DRAG = 300;    // ms (mouse in a carousel: hold, then move = pick up)
  const SLOP = 8;               // px
  const MAX_SPEED = 3600;       // px/s, release velocity cap

  class DragThrow {
    /**
     * @param {object} o
     * @param {Animator} o.animator
     * @param {(zone:string, movie:object) => void} o.onDrop   called when a poster lands on a zone
     */
    constructor({ animator, onDrop }) {
      this.animator = animator;
      this.onDrop = onDrop;
      this.layer = document.getElementById('ghost-layer');
      this.root = document.documentElement;
      this.cand = null;     // a pointer is down on a card but we have not decided yet
      this.drag = null;     // an active drag / throw
      this.raf = 0;

      document.addEventListener('pointerdown', (e) => this.onDown(e), true);
      window.addEventListener('pointermove', (e) => this.onMove(e));
      window.addEventListener('pointerup', (e) => this.onUp(e));
      window.addEventListener('pointercancel', (e) => this.onUp(e, true));
      // Once a drag has begun on a touch screen, stop the browser from scrolling the page.
      document.addEventListener('touchmove', (e) => { if (gesture.owner === 'drag') e.preventDefault(); }, { passive: false });
      document.addEventListener('contextmenu', (e) => { if (this.cand || this.drag) e.preventDefault(); });
    }

    // ---------------------------------------------------------- 1. pointer down
    onDown(e) {
      if (this.cand || this.drag || gesture.owner) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const card = e.target.closest && e.target.closest('.card');
      if (!card || card.classList.contains('card--skeleton') || !card.cfMovie) return;
      if (e.target.closest('button, a, input, select')) return;

      const c = this.cand = {
        card, id: e.pointerId, type: e.pointerType, t0: performance.now(),
        x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY,
        inCarousel: !!card.closest('[data-carousel]'), timer: 0
      };
      if (c.type === 'touch') c.timer = setTimeout(() => this.claim(), LONG_PRESS); // hold = pick up
    }

    // ---------------------------------------------------------- 2. pointer move
    onMove(e) {
      const d = this.drag;
      if (d && e.pointerId === d.id && d.mode === 'drag') {
        d.x = e.clientX; d.y = e.clientY;
        d.samples.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
        while (d.samples.length > 2 && e.timeStamp - d.samples[0].t > 110) d.samples.shift();
        return;
      }
      const c = this.cand;
      if (!c || e.pointerId !== c.id) return;
      c.x = e.clientX; c.y = e.clientY;
      if (gesture.owner && gesture.owner !== 'drag') return this.dropCandidate(); // a carousel is panning
      const dx = c.x - c.x0, dy = c.y - c.y0;
      if (Math.hypot(dx, dy) < SLOP) return;
      clearTimeout(c.timer);

      if (c.type === 'touch') return this.dropCandidate();        // moved before the long-press: it is a scroll / swipe
      const held = performance.now() - c.t0 > HOLD_FOR_DRAG;
      if (!c.inCarousel || held || Math.abs(dy) > Math.abs(dx) * 1.1) this.claim();
      // otherwise a horizontal move inside a carousel: the carousel claims it and we step aside
    }

    // ---------------------------------------------------------- 3. claim = start the drag
    claim() {
      const c = this.cand;
      if (!c || gesture.owner) return;
      clearTimeout(c.timer);
      gesture.owner = 'drag';
      const poster = c.card.querySelector('.card__poster');
      const rect = poster.getBoundingClientRect();

      const ghost = document.createElement('div');
      ghost.className = 'ghost';
      ghost.style.width = rect.width + 'px';
      ghost.style.height = rect.height + 'px';
      ghost.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`;
      ghost.appendChild(poster.cloneNode(true));
      const glow = c.card.style.getPropertyValue('--glow');
      if (glow) ghost.style.setProperty('--glow', glow);
      this.layer.appendChild(ghost);
      c.card.classList.add('is-lifted');
      c.card.classList.remove('is-hover');
      this.root.classList.add('is-dragging');

      this.drag = {
        card: c.card, movie: c.card.cfMovie, id: c.id, ghost, mode: 'drag',
        x0: c.x0, y0: c.y0, x: c.x, y: c.y,
        grabX: c.x - rect.left, grabY: c.y - rect.top, w: rect.width, h: rect.height,
        px: rect.left, py: rect.top, vx: 0, vy: 0, rot: 0, vrot: 0, scale: 1, opacity: 1,
        samples: [{ x: c.x, y: c.y, t: performance.now() }], zone: null, last: performance.now()
      };
      this.cand = null;
      this.loop();
    }

    dropCandidate() {
      if (this.cand) clearTimeout(this.cand.timer);
      this.cand = null;
    }

    // ---------------------------------------------------------- 4. pointer up = release
    onUp(e, cancelled = false) {
      const d = this.drag;
      if (!d || e.pointerId !== d.id) {
        if (this.cand && e.pointerId === this.cand.id) this.dropCandidate(); // it was just a click / tap
        return;
      }
      if (d.mode !== 'drag') return;
      const moved = Math.hypot(d.x - d.x0, d.y - d.y0);
      if (moved < SLOP && !cancelled) {                      // pressed and released without moving = a click
        this.finish(d, false);
        gesture.owner = null;
        return;
      }
      gesture.endMoved();                                    // swallow the click that follows a real drag

      const zone = cancelled ? null : this.zoneAt(e.clientX, e.clientY);
      if (zone) {
        d.mode = 'drop';
        d.zone = zone;
        d.t = 0;
        d.fromX = d.px; d.fromY = d.py; d.fromScale = d.scale;
        const r = zone.el.getBoundingClientRect();
        d.toX = r.left + r.width / 2 - d.w / 2;
        d.toY = r.top + r.height / 2 - d.h / 2;
      } else {
        // release velocity from the last ~100 ms of pointer samples
        const s = d.samples;
        const a = s[0], b = s[s.length - 1];
        const dt = Math.max((b.t - a.t) / 1000, 0.016);
        const speed = Math.hypot(b.x - a.x, b.y - a.y) / dt;
        const k = speed > MAX_SPEED ? MAX_SPEED / speed : 1;
        d.vx = cancelled ? 0 : ((b.x - a.x) / dt) * k;
        d.vy = cancelled ? 0 : ((b.y - a.y) / dt) * k;
        d.mode = 'spring';
      }
      this.root.classList.remove('is-dragging');
      document.querySelectorAll('.dock__zone.is-over').forEach((z) => z.classList.remove('is-over'));
      this.loop();
    }

    /** Which drop zone (if any) is under the pointer? A little padding makes it easier to hit. */
    zoneAt(x, y) {
      for (const el of document.querySelectorAll('[data-dropzone]')) {
        const r = el.getBoundingClientRect();
        if (x > r.left - 18 && x < r.right + 18 && y > r.top - 18 && y < r.bottom + 18) return { el, name: el.dataset.dropzone };
      }
      return null;
    }

    // ---------------------------------------------------------- 5. animation loop
    loop() {
      if (this.raf) return;
      this.raf = requestAnimationFrame((t) => this.tick(t));
    }

    tick(now) {
      this.raf = 0;
      const d = this.drag;
      if (!d) return;
      const dt = Math.min((now - d.last) / 1000, 0.05);
      d.last = now;
      let done = false;

      if (d.mode === 'drag') {
        // Follow the pointer with a little weight, lean with horizontal speed.
        const tx = d.x - d.grabX, ty = d.y - d.grabY;
        const k = 1 - Math.exp(-dt * 26);
        const nx = d.px + (tx - d.px) * k, ny = d.py + (ty - d.py) * k;
        const vx = dt ? (nx - d.px) / dt : 0;
        d.px = nx; d.py = ny;
        d.rot += (clamp(vx * 0.012, -16, 16) - d.rot) * (1 - Math.exp(-dt * 12));
        d.scale += (1.08 - d.scale) * (1 - Math.exp(-dt * 14));
        const zone = this.zoneAt(d.x, d.y);
        document.querySelectorAll('[data-dropzone]').forEach((el) => el.classList.toggle('is-over', !!zone && zone.el === el));
      } else if (d.mode === 'spring') {
        // Damped spring pulling the ghost back to its home. Starts with the release velocity = "throw".
        const reduced = this.animator.reduced;
        const K = reduced ? 320 : 150, C = reduced ? 36 : 15;   // reduced motion: critically damped, no bounce
        if (reduced) { d.vx = d.vy = 0; }
        const home = d.card.querySelector('.card__poster').getBoundingClientRect();
        const homeX = home.left, homeY = home.top;
        const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
        const h = dt / steps;
        for (let i = 0; i < steps; i++) {
          d.vx += (-K * (d.px - homeX) - C * d.vx) * h;
          d.vy += (-K * (d.py - homeY) - C * d.vy) * h;
          d.px += d.vx * h; d.py += d.vy * h;
          d.vrot += (-220 * d.rot - 18 * d.vrot) * h;
          d.rot += d.vrot * h;
          d.scale += (1 - d.scale) * Math.min(1, h * 14);
        }
        // keep the ghost on screen
        d.px = clamp(d.px, -d.w * 0.4, innerWidth - d.w * 0.6);
        d.py = clamp(d.py, -d.h * 0.4, innerHeight - d.h * 0.6);
        done = Math.hypot(d.px - homeX, d.py - homeY) < 0.5 && Math.hypot(d.vx, d.vy) < 8 && Math.abs(d.rot) < 0.2;
      } else if (d.mode === 'drop') {
        d.t = Math.min(1, d.t + dt / 0.42);
        const e = d.t * d.t * (3 - 2 * d.t);                    // smoothstep
        d.px = d.fromX + (d.toX - d.fromX) * e;
        d.py = d.fromY + (d.toY - d.fromY) * e;
        d.scale = d.fromScale * (1 - 0.85 * e);
        d.rot += (0 - d.rot) * 0.2;
        d.opacity = 1 - Math.max(0, (d.t - 0.55) / 0.45);
        done = d.t >= 1;
      }

      d.ghost.style.transform = `translate3d(${d.px.toFixed(1)}px, ${d.py.toFixed(1)}px, 0) rotate(${d.rot.toFixed(2)}deg) scale(${d.scale.toFixed(3)})`;
      d.ghost.style.opacity = d.opacity;
      if (done) this.finish(d, d.mode === 'drop');
      else this.loop();
    }

    /** Remove the ghost and bring the real poster back. */
    finish(d, dropped) {
      d.ghost.remove();
      d.card.classList.remove('is-lifted');
      this.root.classList.remove('is-dragging');
      document.querySelectorAll('.dock__zone.is-over').forEach((z) => z.classList.remove('is-over'));
      if (this.drag === d) this.drag = null;
      if (gesture.owner === 'drag') gesture.owner = null;
      if (dropped && d.zone) {
        this.onDrop(d.zone.name, d.movie);
        const poster = d.card.querySelector('.card__poster');
        if (poster && !this.animator.reduced) {                // the poster "pops" back in
          poster.animate([{ transform: 'scale(0.82)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 420, easing: 'cubic-bezier(0.3, 1.5, 0.5, 1)' });
        }
      }
    }
  }

  CF.DragThrow = DragThrow;
})(window.CineFloat);
