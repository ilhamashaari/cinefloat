/* ==========================================================================
   animator.js — Animator: every "feel good" effect except drag-and-throw.

   * idle floating   : random speed / phase / depth per poster (CSS does the motion)
   * cursor parallax : posters at different depths shift by different amounts
   * 3D tilt + shine : the poster under the pointer leans towards it
   * magnetic buttons: buttons lean towards the cursor
   * custom cursor   : a dot + ring that follows the mouse
   * FLIP helpers    : shared-element transitions (used by the detail panel)
   * reduced motion  : one switch that turns the decorative motion off

   Everything writes `transform` / `translate` / `opacity` only.
   ========================================================================== */
(function (CF) {
  'use strict';
  const { clamp, rand, hash } = CF.utils;

  const MAX_TILT = 13;                 // degrees
  const HOVER_SELECTOR = 'a, button, [role="button"], [role="option"], [role="radio"], [role="tab"], label, .card, .lib-item, .carousel__viewport';

  class Animator {
    /** @param {HTMLElement} view  the <main> element: parallax variables are written onto it */
    constructor(view) {
      this.view = view;
      this.root = document.documentElement;
      this.reduced = this.root.dataset.motion === 'reduced';
      this.fine = matchMedia('(pointer: fine)').matches && matchMedia('(hover: hover)').matches; // mouse / trackpad
      this.onHover = null;             // callbacks set by the UI: (card) => void
      this.onLeave = null;

      // Posters that are off-screen get paused (saves battery and keeps scrolling smooth).
      this.io = 'IntersectionObserver' in window
        ? new IntersectionObserver((entries) => entries.forEach((e) => {
            if (e.isIntersecting) e.target.dataset.visible = '1'; else delete e.target.dataset.visible;
          }), { rootMargin: '160px' })
        : null;

      this.par = { x: 0, y: 0, tx: 0, ty: 0, raf: 0 };
      this.tilts = new Map();          // card -> tilt state
      this.tiltRaf = 0;
      this.hoverCard = null;
      this.magnets = [];
      this.mouse = null;
      this.magRaf = 0;

      this.initParallax();
      this.initTilt();
      this.initMagnetic();
      this.initCursor();
    }

    /** Turn decorative motion on / off (also called when the OS setting changes). */
    setReduced(flag) {
      this.reduced = !!flag;
      this.root.dataset.motion = this.reduced ? 'reduced' : 'full';
      if (this.reduced) {
        this.view.style.setProperty('--par-x', 0);
        this.view.style.setProperty('--par-y', 0);
        this.tilts.forEach((st, card) => { st.tilt.style.transform = ''; card.classList.remove('is-hover'); });
        this.tilts.clear();
        this.magnets.forEach((m) => { m.el.style.translate = ''; m.x = m.y = 0; });
      }
    }

    // ------------------------------------------------------------------
    // 1) Idle float: give every new poster its own random speed, phase and depth
    // ------------------------------------------------------------------
    decorate(root = document) {
      root.querySelectorAll('.card:not([data-fx]), .floaty:not([data-fx]), .fl:not([data-fx])').forEach((el) => {
        el.dataset.fx = '1';
        const depth = Number(el.dataset.depth) || 1 + (hash(el.dataset.id || Math.random()) % 3); // 1 = far ... 3 = near
        el.dataset.depth = depth;
        const k = [0, 0.6, 0.85, 1.1][depth];
        const target = el.classList.contains('card') ? el : el;
        target.style.setProperty('--float-dur', rand(6, 11).toFixed(2) + 's');
        target.style.setProperty('--float-delay', (-rand(0, 11)).toFixed(2) + 's');   // negative = start mid-cycle (random phase)
        target.style.setProperty('--float-y', (-rand(5, 11) * k).toFixed(1) + 'px');
        target.style.setProperty('--float-x', (rand(-5, 5) * k).toFixed(1) + 'px');
        target.style.setProperty('--float-rot', (rand(0.3, 1.2) * (Math.random() < 0.5 ? -1 : 1)).toFixed(2) + 'deg');
        if (el.classList.contains('card')) {
          if (this.io) this.io.observe(el); else el.dataset.visible = '1';
        }
      });
      root.querySelectorAll('[data-magnetic]:not([data-mag])').forEach((el) => {
        el.dataset.mag = '1';
        this.magnets.push({ el, x: 0, y: 0, tx: 0, ty: 0 });
      });
    }

    // ------------------------------------------------------------------
    // 2) Parallax: the pointer position becomes two CSS variables (-1 ... 1)
    // ------------------------------------------------------------------
    initParallax() {
      if (!this.fine) return;
      window.addEventListener('pointermove', (e) => {
        if (this.reduced || e.pointerType === 'touch') return;
        this.par.tx = (e.clientX / innerWidth - 0.5) * 2;
        this.par.ty = (e.clientY / innerHeight - 0.5) * 2;
        if (!this.par.raf) this.par.raf = requestAnimationFrame(() => this.tickParallax());
      }, { passive: true });
    }
    tickParallax() {
      const p = this.par;
      p.raf = 0;
      p.x += (p.tx - p.x) * 0.08;
      p.y += (p.ty - p.y) * 0.08;
      this.view.style.setProperty('--par-x', p.x.toFixed(3));
      this.view.style.setProperty('--par-y', p.y.toFixed(3));
      if (Math.abs(p.tx - p.x) > 0.002 || Math.abs(p.ty - p.y) > 0.002) p.raf = requestAnimationFrame(() => this.tickParallax());
    }

    // ------------------------------------------------------------------
    // 3) 3D tilt + moving shine
    // ------------------------------------------------------------------
    initTilt() {
      document.addEventListener('pointerover', (e) => {
        if (this.reduced || !e.target.closest) return;
        const card = e.target.closest('.card');
        if (!card || card.classList.contains('card--skeleton') || card.classList.contains('is-lifted')) return;
        this.tiltStart(card, e.clientX, e.clientY);
      }, { passive: true });

      document.addEventListener('pointermove', (e) => {
        if (!this.hoverCard) return;
        this.tiltAim(this.hoverCard, e.clientX, e.clientY);
      }, { passive: true });

      document.addEventListener('pointerout', (e) => {
        if (!e.target.closest) return;
        const card = e.target.closest('.card');
        if (card && !card.contains(e.relatedTarget)) this.tiltEnd(card);
      }, { passive: true });
      document.addEventListener('pointercancel', () => this.hoverCard && this.tiltEnd(this.hoverCard), { passive: true });
    }

    tiltStart(card, x, y) {
      if (this.hoverCard === card) return;
      if (this.hoverCard) this.tiltEnd(this.hoverCard);
      const tilt = card.querySelector('.card__tilt');
      const poster = card.querySelector('.card__poster');
      const shine = card.querySelector('.card__shine');
      if (!tilt || !poster) return;
      const st = this.tilts.get(card) || { rx: 0, ry: 0, sc: 1, tilt, poster, shine };
      Object.assign(st, { tx: 0, ty: 0, tsc: 1.045, px: 0.5, py: 0.5, w: poster.offsetWidth, h: poster.offsetHeight, hover: true });
      this.tilts.set(card, st);
      this.hoverCard = card;
      card.classList.add('is-hover');
      this.tiltAim(card, x, y);
      if (this.onHover) this.onHover(card);
    }
    tiltAim(card, x, y) {
      const st = this.tilts.get(card);
      if (!st) return;
      const r = card.getBoundingClientRect();           // the layout box does not move while the poster tilts
      st.px = clamp((x - r.left) / st.w, 0, 1);
      st.py = clamp((y - r.top) / st.h, 0, 1);
      st.ty = (st.px - 0.5) * 2 * MAX_TILT;             // rotateY: left/right
      st.tx = -(st.py - 0.5) * 2 * MAX_TILT;            // rotateX: up/down
      this.kickTilt();
    }
    tiltEnd(card) {
      const st = this.tilts.get(card);
      if (this.hoverCard === card) this.hoverCard = null;
      card.classList.remove('is-hover');
      if (st) { st.hover = false; st.tx = st.ty = 0; st.tsc = 1; this.kickTilt(); }
      if (this.onLeave) this.onLeave(card);
    }
    kickTilt() {
      if (!this.tiltRaf) { this.last = performance.now(); this.tiltRaf = requestAnimationFrame((t) => this.tickTilt(t)); }
    }
    tickTilt(now) {
      this.tiltRaf = 0;
      const dt = Math.min((now - this.last) / 1000, 0.05);
      this.last = now;
      const k = 1 - Math.exp(-dt * 14);                 // frame-rate independent smoothing
      let moving = false;
      this.tilts.forEach((st, card) => {
        st.rx += (st.tx - st.rx) * k;
        st.ry += (st.ty - st.ry) * k;
        st.sc += (st.tsc - st.sc) * k;
        const still = Math.abs(st.tx - st.rx) < 0.02 && Math.abs(st.ty - st.ry) < 0.02 && Math.abs(st.tsc - st.sc) < 0.001;
        if (!st.hover && still) {                       // fully settled: remove our inline styles
          st.tilt.style.transform = '';
          this.tilts.delete(card);
          return;
        }
        st.tilt.style.transform = `perspective(900px) rotateX(${st.rx.toFixed(2)}deg) rotateY(${st.ry.toFixed(2)}deg) scale(${st.sc.toFixed(3)})`;
        if (st.shine) st.shine.style.transform = `translate3d(${(st.px * st.w - st.w).toFixed(1)}px, ${(st.py * st.h - st.w).toFixed(1)}px, 0)`;
        if (!still) moving = true;
      });
      if (moving) this.tiltRaf = requestAnimationFrame((t) => this.tickTilt(t));
    }

    // ------------------------------------------------------------------
    // 4) Magnetic buttons: elements with [data-magnetic] lean towards the cursor
    // ------------------------------------------------------------------
    initMagnetic() {
      if (!this.fine) return;
      window.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'touch' || this.reduced) return;
        this.mouse = { x: e.clientX, y: e.clientY };
        if (!this.magRaf) this.magRaf = requestAnimationFrame(() => this.tickMagnetic());
      }, { passive: true });
    }
    tickMagnetic() {
      this.magRaf = 0;
      const m = this.mouse;
      const panelOpen = this.root.classList.contains('panel-open');
      let moving = false;
      this.magnets = this.magnets.filter((s) => s.el.isConnected);
      for (const s of this.magnets) {
        const r = s.el.getBoundingClientRect();
        if (!r.width) continue;                          // hidden element
        const cx = r.left + r.width / 2 - s.x;           // home centre = current centre minus our own offset
        const cy = r.top + r.height / 2 - s.y;
        const near = m && !this.reduced && !(panelOpen && !s.el.closest('.detail')) &&
          Math.hypot(m.x - cx, m.y - cy) < Math.max(r.width, r.height) * 0.5 + 36;
        s.tx = near ? clamp((m.x - cx) * 0.32, -16, 16) : 0;
        s.ty = near ? clamp((m.y - cy) * 0.32, -16, 16) : 0;
        s.x += (s.tx - s.x) * 0.2;
        s.y += (s.ty - s.y) * 0.2;
        if (!s.tx && !s.ty && Math.abs(s.x) < 0.05 && Math.abs(s.y) < 0.05) {
          if (s.x || s.y || s.el.style.translate) { s.el.style.translate = ''; s.x = s.y = 0; }
        } else {
          s.el.style.translate = `${s.x.toFixed(2)}px ${s.y.toFixed(2)}px`;   // `translate` composes with CSS transforms
          moving = true;
        }
      }
      if (moving) this.magRaf = requestAnimationFrame(() => this.tickMagnetic());
    }

    // ------------------------------------------------------------------
    // 5) Custom cursor (only for mouse / trackpad; touch screens keep their normal behaviour)
    // ------------------------------------------------------------------
    initCursor() {
      const el = document.getElementById('cursor');
      if (!this.fine || !el) return;
      const ring = el.querySelector('.cursor__ring');
      const dot = el.querySelector('.cursor__dot');
      const label = el.querySelector('.cursor__label');
      const c = { x: -100, y: -100, rx: -100, ry: -100, s: 1, ts: 1, seen: false, raf: 0 };
      this.cursor = c;

      const tick = () => {
        c.raf = 0;
        const follow = this.reduced ? 1 : 0.22;
        c.rx += (c.x - c.rx) * follow;
        c.ry += (c.y - c.ry) * follow;
        c.s += (c.ts - c.s) * 0.2;
        ring.style.transform = `translate3d(${c.rx.toFixed(1)}px, ${c.ry.toFixed(1)}px, 0) scale(${c.s.toFixed(3)})`;
        ring.style.setProperty('--s', c.s.toFixed(3));
        dot.style.transform = `translate3d(${c.x}px, ${c.y}px, 0)`;
        if (Math.abs(c.x - c.rx) > 0.2 || Math.abs(c.y - c.ry) > 0.2 || Math.abs(c.ts - c.s) > 0.005) c.raf = requestAnimationFrame(tick);
      };
      const kick = () => { if (!c.raf) c.raf = requestAnimationFrame(tick); };
      const retarget = (target) => {
        const dragging = this.root.classList.contains('is-dragging');
        const hit = target && target.closest && target.closest(HOVER_SELECTOR);
        c.ts = dragging ? 1.4 : hit ? 1.6 : 1;
        const text = !dragging && hit && hit.closest('[data-cursor]') ? hit.closest('[data-cursor]').dataset.cursor : '';
        label.textContent = text;
        el.classList.toggle('has-label', !!text);
      };

      window.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'touch') return;
        c.x = e.clientX; c.y = e.clientY;
        if (!c.seen) { c.seen = true; c.rx = c.x; c.ry = c.y; this.root.classList.add('has-cursor'); }
        retarget(e.target);
        kick();
      }, { passive: true });
      window.addEventListener('pointerdown', () => { c.ts = 0.8; kick(); }, { passive: true });
      window.addEventListener('pointerup', (e) => { retarget(e.target); kick(); }, { passive: true });
      // Browsers send no pointermove when the page changes under a still mouse (a panel opens, a card moves),
      // so UI code calls refreshCursor() to look again at what is under the pointer.
      this.cursorRefresh = () => {
        if (!c.seen) return;
        retarget(document.elementFromPoint(c.x, c.y));
        kick();
      };
      this.root.addEventListener('pointerleave', () => this.root.classList.add('cursor-hidden'));
      this.root.addEventListener('pointerenter', () => this.root.classList.remove('cursor-hidden'));
    }
    /** The YouTube iframe swallows pointer events, so the panel hides our cursor while the mouse is over it. */
    hideCursor(flag) { this.root.classList.toggle('cursor-hidden', !!flag); }
    /** Re-check what is under a pointer that has not moved (does nothing on touch screens). */
    refreshCursor() { if (this.cursorRefresh) this.cursorRefresh(); }

    // ------------------------------------------------------------------
    // 6) FLIP helpers (First, Last, Invert, Play) for shared-element transitions
    // ------------------------------------------------------------------
    /** Animate `el` from where `fromRect` was on screen to where it is now. */
    flipFrom(el, fromRect, duration = 580) {
      const to = el.getBoundingClientRect();
      if (this.reduced || !fromRect || !to.width || !to.height) return Promise.resolve();
      el.style.transformOrigin = '0 0';
      const anim = el.animate(
        [{ transform: `translate(${fromRect.left - to.left}px, ${fromRect.top - to.top}px) scale(${fromRect.width / to.width}, ${fromRect.height / to.height})` },
         { transform: 'translate(0px, 0px) scale(1, 1)' }],
        { duration, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards' }
      );
      return anim.finished.catch(() => {});
    }
    /** Animate `el` from its place to `toRect` (the reverse). Returns the Animation so the caller can cancel it. */
    flipTo(el, toRect, duration = 460) {
      const from = el.getBoundingClientRect();
      if (this.reduced || !toRect || !from.width || !from.height) return null;
      el.style.transformOrigin = '0 0';
      return el.animate(
        [{ transform: 'translate(0px, 0px) scale(1, 1)' },
         { transform: `translate(${toRect.left - from.left}px, ${toRect.top - from.top}px) scale(${toRect.width / from.width}, ${toRect.height / from.height})` }],
        { duration, easing: 'cubic-bezier(0.5, 0, 0.2, 1)', fill: 'forwards' }
      );
    }
  }

  CF.Animator = Animator;
})(window.CineFloat);
