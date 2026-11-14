# CineFloat

A movie search app where posters float in space. Built with **Electron + vanilla HTML, CSS and JavaScript** (no framework, no build step). It also runs in any normal browser, so you can test quickly.

Data comes from the free [TMDB API](https://developer.themoviedb.org/docs/getting-started).

## 1. Get a TMDB key (2 minutes)

1. Create a free account at <https://www.themoviedb.org/signup>.
2. Open <https://www.themoviedb.org/settings/api> and request an API key (choose "Personal / non-commercial" and fill in the short form).
3. On that page copy the long **API Read Access Token** (it starts with `eyJ...`). This is the v4 token. You do **not** need the short v3 "API Key".

## 2. Add the token to the app

```bash
cp config.example.js config.js      # Windows: copy config.example.js config.js
```

Open `config.js` and replace `PASTE_YOUR_V4_READ_ACCESS_TOKEN_HERE` with your token.
`config.js` is listed in `.gitignore`, so the token is never committed. Only `config.example.js` is committed.

## 3. Run it

**Desktop app (Electron)**

```bash
npm install
npm start
```

**Normal browser (quick testing)**

```bash
npm run web          # then open http://localhost:5173
```

You can also just double-click `index.html`. Everything works that way except YouTube trailers: YouTube refuses to play embeds on `file://` pages. Use `npm run web` (or the Electron app) to test trailers.

## What you can do

| Area | Details |
| --- | --- |
| Search | Floating search bar, 400 ms debounce, live suggestions with mini posters, recent-search chips |
| Browse | Trending, Popular, Top Rated, Now Playing carousels |
| Filter | Genre chips, year range, minimum rating, sort order, mood picker, "Surprise me" |
| Details | Backdrop, tagline, animated rating ring, runtime, genres, overview, cast, trailer, where to watch, similar movies |
| Library | Watchlist and Favorites (saved in `localStorage`), export to JSON |
| Themes | Dark, Light, AMOLED, plus a "Reduce motion" switch (follows your OS setting until you change it) |

### Gestures

* **Hover / touch a poster**: 3D tilt with a shine that follows your cursor or finger.
* **Click / tap a poster**: it expands into the detail panel (shared-element transition).
* **Drag a poster** (mouse) or **press and hold, then drag** (touch): throw it around. It springs back. Drop it on the **Watchlist** or **Favorites** zone that appears at the bottom to save it.
* **Carousels**: drag or swipe with momentum. Use the arrow buttons, a horizontal scroll gesture, or `Shift` + mouse wheel. (Plain vertical wheel always scrolls the page, so the page never "sticks" while the pointer is over a row.)
* Inside a carousel with a mouse: drag sideways to scroll the row; drag up/down, or press and hold for a moment and then drag, to pick up a poster.

### Keyboard

| Key | Action |
| --- | --- |
| `/` | Focus the search bar |
| `Esc` | Close suggestions, then the detail panel / drawer / dialogs |
| Arrow keys | Move between posters (on the page); previous / next movie (inside the detail panel) |
| `Enter` | Open the focused poster or search |

## Project structure

```
cinefloat/
├── package.json          npm scripts + Electron dependency
├── main.js               Electron main process (window + security rules)
├── preload.js            tiny, safe bridge exposed as window.desktop
├── index.html            the whole UI shell
├── config.example.js     copy to config.js and add your token (config.js is git-ignored)
├── css/                  base (themes) · layout · cards · panel
├── assets/               optional local copy of the TMDB logo (see its README)
├── js/
│   ├── boot.js           applies theme / motion before first paint
│   ├── utils.js          small helpers + image URL builder
│   ├── api.js            ApiService: TMDB calls, caching, abort, errors
│   ├── store.js          Store: watchlist, favorites, history, settings
│   ├── colors.js         ColorExtractor: dominant colour of a poster
│   ├── background.js     Background: animated colour-shifting backdrop
│   ├── animator.js       Animator: float, parallax, tilt + shine, magnetic buttons, cursor, FLIP
│   ├── dragthrow.js      DragThrow: drag, throw and spring physics, drop zones
│   ├── carousel.js       Carousel: drag/swipe with momentum, wheel, arrows
│   ├── cards.js          Cards: builds poster cards, placeholders, skeletons
│   ├── toast.js          Toasts
│   ├── library.js        LibraryDrawer: watchlist / favorites + JSON export
│   ├── panel.js          DetailPanel: FLIP expansion + movie details
│   ├── search.js         SearchBox: debounced search, live suggestions, recent-search chips
│   ├── explore.js        Explorer: filters, mood picker, Surprise me, results grid
│   ├── ui.js             UIController: wires everything together
│   ├── keyboard.js       Keyboard shortcuts and arrow-key navigation
│   └── app.js            start-up
└── scripts/serve.js      zero-dependency static server for browser testing
```

The scripts are plain classic `<script>` files (no bundler, no ES-module imports) so the app also opens straight from `file://`. Each file adds its class to one global object, `window.CineFloat`.

## How the animation stays at 60 fps

Only `transform` and `opacity` are animated. Each poster is a few nested layers so effects never fight each other:

```
.card
  └ .card__float   idle drift (CSS keyframes) + cursor parallax
      └ .card__tilt  3D tilt (JS)
          └ .card__poster  image + moving shine
```

Dragged posters are lifted into a floating "ghost" layer (so no carousel can clip them), moved with a small spring simulation, and removed when they settle. The animated background cross-fades between two colour layers (opacity only).

## Assumptions

* The listed endpoints cannot filter by genre, year or rating, so the filters, the Mood Picker and Surprise Me also use TMDB's `/discover/movie`.
* When you type a search, filters narrow the search results on your device (the search endpoint has no filters). Clear the search box to browse the whole catalogue with filters.
* "Where to watch" uses `REGION` from `config.js` (default `US`). If a title has no data for that region, the section says so.
* Dominant colours are read from a small canvas copy of the poster. If the image host does not allow that, the app falls back to a stable colour derived from the movie id, so the background still shifts.
* No web fonts are used, so the app works offline and under a strict Content Security Policy.

## Troubleshooting

* **"Add your TMDB token" screen**: `config.js` is missing or still contains the placeholder.
* **"TMDB did not accept the token"**: you probably pasted the short v3 API key. Use the long *API Read Access Token*.
* **Trailer shows "Error 153"** when opened from `file://`: run `npm run web` instead. In Electron, `main.js` adds the `Referer` header YouTube asks for (edit `EMBED_REFERER` to your own site if you have one).
* **TMDB logo missing**: download an official logo from <https://www.themoviedb.org/about/logos-attribution> and save it as `assets/tmdb-logo.svg`. The app tries it automatically.

## Credits

This product uses the TMDB API but is not endorsed or certified by TMDB.
Streaming availability data is provided by JustWatch.
