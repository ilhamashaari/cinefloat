/* ==========================================================================
   background.js — Background: the colour-shifting backdrop.

   The page has TWO background layers (see index.html). To change colour we
   write the new colours into the hidden layer and fade it in while the other
   fades out, so only `opacity` is ever animated.

   Priority: hovered poster  >  selected movie (detail panel open)  >  default.
   ========================================================================== */
(function (CF) {
  'use strict';

  const css = (rgb) => `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`;
  const mix = (a, b) => [0, 1, 2].map((i) => Math.round((a[i] + b[i]) / 2));

  class Background {
    constructor(root) {
      this.layers = Array.from(root.querySelectorAll('.bg__layer'));
      this.active = 0;
      this.base = { a: [99, 91, 255], b: [255, 79, 163] };  // default indigo + pink
      this.hover = null;
      this.selected = null;
      this.key = '';
      this.timer = 0;
      this.paint(this.base, true);
    }

    /** Called when the pointer enters (colors) / leaves (null) a poster. Slightly delayed to avoid flicker. */
    setHover(colors) {
      this.hover = colors;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.refresh(), colors ? 90 : 220);
    }
    /** Called when the detail panel opens (colors) / closes (null). */
    setSelected(colors) {
      this.selected = colors;
      this.refresh();
    }

    refresh() {
      this.paint(this.hover || this.selected || this.base);
    }

    paint(colors, first = false) {
      const key = colors.a.join() + '|' + colors.b.join();
      if (key === this.key) return;
      this.key = key;
      const next = first ? this.active : 1 - this.active;
      const layer = this.layers[next];
      layer.style.setProperty('--c1', css(colors.a));
      layer.style.setProperty('--c2', css(colors.b));
      layer.style.setProperty('--c3', css(mix(colors.a, colors.b)));
      if (first) return;
      layer.classList.add('is-on');
      this.layers[this.active].classList.remove('is-on');
      this.active = next;
    }
  }

  CF.Background = Background;
})(window.CineFloat);
