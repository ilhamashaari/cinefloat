/* ==========================================================================
   carousel.js — Carousel: a row you can drag / swipe with momentum.

   The row is NOT a normal scrolling box. Its "track" is moved with a CSS
   transform, so we fully control the physics:
     * dragging follows the pointer (with a rubber-band at the ends)
     * letting go keeps the speed and slows down (friction)
     * going past an end springs back
     * Shift + wheel (or a sideways wheel / trackpad swipe) eases the row along
     * the arrow buttons and keyboard focus ease it too
   A plain vertical wheel is NOT captured, so the page always scrolls normally.
   ========================================================================== */
(function (CF) {
  'use strict';
  const { clamp } = CF.utils;
  const gesture = CF.gesture;

  class Carousel {
    /**
     * @param {HTMLElement} root  an element containing .carousel__viewport > .carousel__track
     * @param {object} opts       { arrows: true } add prev / next buttons
     */
    constructor(root, { arrows = true } = {}) {
      this.root = root;
      this.viewport = root.querySelector('.carousel__viewport');
      this.track = root.querySelector('.carousel__track');
      this.x = 0;            // current offset of the track (0 = start, negative = scrolled)
      this.min = 0;          // furthest offset (negative); recalculated on resize
      this.v = 0;            // velocity in px/s (used for momentum)
      this.target = 0;       // destination for "ease" mode
      this.mode = 'idle';    // 'idle' | 'inertia' | 'ease'
      this.raf = 0;
      this.last = 0;
      this.down = null;
      root.dataset.carousel = '1';
      root.__carousel = this;

      if (arrows) this.buildArrows();
      this.onMove = (e) => this.move(e);
      this.onUp = (e) => this.up(e);
      this.viewport.addEventListener('pointerdown', (e) => this.onDown(e));
      this.viewport.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
      this.viewport.addEventListener('dragstart', (e) => e.preventDefault());   // no native image dragging
      // Focusing an off-screen poster makes browsers scroll this overflow:hidden box. We move the
      // track with transform instead, so undo the browser's scroll and let reveal() do the work.
      this.viewport.addEventListener('scroll', () => { this.viewport.scrollLeft = 0; this.viewport.scrollTop = 0; });
      this.viewport.addEventListener('focusin', (e) => {                        // keyboard focus scrolls the row
        const item = e.target.closest && e.target.closest('.card, .chip');
        if (item && e.target.matches(':focus-visible')) this.reveal(item);
      });
      if ('ResizeObserver' in window) {
        this.ro = new ResizeObserver(() => this.measure());
        this.ro.observe(this.viewport);
        this.ro.observe(this.track);
      }
      this.measure();
    }

    buildArrows() {
      const make = (dir, icon, label) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `carousel__nav carousel__nav--${dir < 0 ? 'prev' : 'next'}`;
        b.setAttribute('aria-label', label);
        b.tabIndex = -1;
        b.innerHTML = `<svg class="ico"><use href="#${icon}"/></svg>`;
        b.addEventListener('click', () => this.by(dir));
        this.root.appendChild(b);
        return b;
      };
      this.prev = make(-1, 'i-left', 'Scroll left');
      this.next = make(1, 'i-right', 'Scroll right');
    }

    /** Recalculate how far the track can move. Call after adding or removing items. */
    measure() {
      this.min = Math.min(0, this.viewport.clientWidth - this.track.offsetWidth);
      if (this.mode === 'idle') this.x = clamp(this.x, this.min, 0);
      this.render();
    }

    render() {
      this.track.style.transform = `translate3d(${Math.round(this.x * 100) / 100}px, 0, 0)`;
      const atStart = this.x > -2, atEnd = this.x < this.min + 2;
      if (this.prev) {
        if (this.prev.disabled !== atStart) this.prev.disabled = atStart;
        if (this.next.disabled !== atEnd) this.next.disabled = atEnd;
      }
      // Tell CSS which ends are hidden (the genre chip row fades those ends out). Only write on change.
      const s = String(atStart), e = String(atEnd);
      if (this.root.dataset.atStart !== s) this.root.dataset.atStart = s;
      if (this.root.dataset.atEnd !== e) this.root.dataset.atEnd = e;
    }

    // ---------------------------------------------------------------- drag / swipe
    onDown(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (gesture.owner || this.down) return;
      if (e.target.closest('input, select, textarea')) return;
      const wasMoving = this.mode !== 'idle' && Math.abs(this.v) > 60;
      this.stopMotion();
      this.down = {
        id: e.pointerId, type: e.pointerType, x0: e.clientX, y0: e.clientY, t0: e.timeStamp,
        startX: this.x, claimed: false, wasMoving, onCard: !!e.target.closest('.card'),
        samples: [{ x: e.clientX, t: e.timeStamp }]
      };
      window.addEventListener('pointermove', this.onMove);
      window.addEventListener('pointerup', this.onUp);
      window.addEventListener('pointercancel', this.onUp);
    }

    move(e) {
      const d = this.down;
      if (!d || e.pointerId !== d.id) return;
      const dx = e.clientX - d.x0, dy = e.clientY - d.y0;

      if (!d.claimed) {
        if (gesture.owner && gesture.owner !== 'pan') return this.cleanup();     // a poster was picked up instead
        if (Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy)) {
          // mouse: press-and-hold on a poster means "pick it up", not "swipe"
          if (d.type !== 'touch' && d.onCard && e.timeStamp - d.t0 > 300) return this.cleanup();
          gesture.owner = 'pan';
          d.claimed = true;
          d.x0 = e.clientX;            // start from here so the row does not jump
          d.startX = this.x;
          this.root.classList.add('is-panning');
        } else if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
          return this.cleanup();       // a vertical gesture: not ours
        } else return;
      }

      let nx = d.startX + (e.clientX - d.x0);
      if (nx > 0) nx *= 0.35;                                  // rubber band at the start
      else if (nx < this.min) nx = this.min + (nx - this.min) * 0.35;   // ... and at the end
      this.x = nx;
      d.samples.push({ x: e.clientX, t: e.timeStamp });
      while (d.samples.length > 2 && e.timeStamp - d.samples[0].t > 100) d.samples.shift();
      this.render();
    }

    up(e) {
      const d = this.down;
      if (!d || e.pointerId !== d.id) return;
      this.cleanup();
      if (!d.claimed) {
        if (d.wasMoving) gesture.endMoved();      // the tap only stopped a moving row: do not click a poster
        return;
      }
      this.root.classList.remove('is-panning');
      gesture.endMoved();
      const a = d.samples[0], b = d.samples[d.samples.length - 1];
      const dt = Math.max((b.t - a.t) / 1000, 0.016);
      this.v = e.type === 'pointercancel' ? 0 : clamp((b.x - a.x) / dt, -4500, 4500);
      this.mode = 'inertia';
      this.kick();
    }

    cleanup() {
      window.removeEventListener('pointermove', this.onMove);
      window.removeEventListener('pointerup', this.onUp);
      window.removeEventListener('pointercancel', this.onUp);
      this.down = null;
    }

    // ---------------------------------------------------------------- wheel, arrows, focus
    onWheel(e) {
      if (!e.shiftKey && Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;      // mostly vertical: page scrolls
      let dx = e.shiftKey ? (e.deltaX || e.deltaY) : e.deltaX;
      if (!dx) return;
      if (e.deltaMode === 1) dx *= 32; else if (e.deltaMode === 2) dx *= this.viewport.clientWidth;
      const base = this.mode === 'ease' ? this.target : this.x;
      const t = clamp(base - dx, this.min, 0);
      if (t === base) return;                                                  // already at the end: let it pass
      e.preventDefault();
      this.goTo(t);
    }

    by(direction) {
      const base = this.mode === 'ease' ? this.target : this.x;
      this.goTo(base - direction * this.viewport.clientWidth * 0.85);
    }

    goTo(x) {
      this.target = clamp(x, this.min, 0);
      this.mode = 'ease';
      this.v = 0;
      this.kick();
    }

    /** Slide just enough to show `el` completely. */
    reveal(el) {
      const pad = 24, vw = this.viewport.clientWidth;
      const left = el.offsetLeft, right = left + el.offsetWidth;
      const cur = this.mode === 'ease' ? this.target : this.x;
      let t = cur;
      if (left + cur < pad) t = pad - left;
      else if (right + cur > vw - pad) t = vw - pad - right;
      if (t !== cur) this.goTo(t);
    }

    // ---------------------------------------------------------------- animation loop
    stopMotion() {
      this.mode = 'idle';
      this.v = 0;
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    kick() {
      if (this.raf) return;
      this.last = performance.now();
      this.raf = requestAnimationFrame((t) => this.tick(t));
    }
    tick(now) {
      this.raf = 0;
      const dt = Math.min((now - this.last) / 1000, 0.032);
      this.last = now;
      let busy = true;

      if (this.mode === 'inertia') {
        const edge = this.x > 0 ? 0 : this.x < this.min ? this.min : null;
        if (edge !== null) {                                   // past an end: spring back
          this.v += (-170 * (this.x - edge) - 24 * this.v) * dt;
          this.x += this.v * dt;
          if (Math.abs(this.x - edge) < 0.3 && Math.abs(this.v) < 8) { this.x = edge; this.v = 0; busy = false; }
        } else {                                               // free coasting with friction
          this.x += this.v * dt;
          this.v *= Math.exp(-dt * 3.2);
          if (Math.abs(this.v) < 8) { this.v = 0; busy = false; }
        }
      } else if (this.mode === 'ease') {
        this.x += (this.target - this.x) * (1 - Math.exp(-dt * 11));
        if (Math.abs(this.target - this.x) < 0.4) { this.x = this.target; busy = false; }
      } else busy = false;

      this.render();
      if (busy) this.raf = requestAnimationFrame((t) => this.tick(t));
      else this.mode = 'idle';
    }
  }

  CF.Carousel = Carousel;
})(window.CineFloat);
