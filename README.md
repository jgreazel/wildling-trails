# Wildling Trails — Fernhollow

An **original** cozy 3D creature-companion adventure for the browser. It starts in
the creek-side village of **Fernhollow**: wake up at home, cross the village, climb to
Dr. Ilse Marrow's greenhouse lab, and choose your first partner wildling: Emberkit,
Brookling or Mossbun. Your partner then follows you around the village.

It has no build step and no game engine: plain ES modules, [three.js](https://threejs.org) 0.170 from a CDN,
and native web components for the UI.

> Everything here is original: names, characters, creatures, dialogue, map layout,
> music and art. It's a genre homage (grid movement, ledges, tall grass, a starter
> choice, a following companion, day/night), not a remake of any existing game.

## Run it

```bash
npm install   # only needed for the Node tests (installs three for headless use)
npm start     # → http://localhost:5173
```

Any static file server works too (the game is just files). Tests and the map validator:

```bash
npm test
npm run validate
```

## Controls

| Action | Keyboard | Controller (Xbox layout) | Touch |
| --- | --- | --- | --- |
| Move (free, 360°) | Arrows / WASD (8 directions) | Left stick (tilt = speed) or d-pad | D-pad |
| Talk / confirm | Z, Space, J | A | A |
| Cancel / hold to run | X, Backspace, K (or Shift to run) | B (hold X, bumpers or triggers to run) | B |
| Menu (partner, journal, save, sound, clock) | Enter / Esc | Menu or Y | START |
| Cycle the clock (live → morning → day → evening → night) | T | View | Menu → Clock |

Movement is free and analog: the map is still a grid of tiles underneath (walls, cliffs,
stairs, ledges, doors), but you walk at any angle, slide along walls, and a partial stick
tilt walks slower. Your partner follows the exact path you walked.

Any controller the browser reports with the standard mapping works (Xbox, PlayStation,
Switch Pro, most USB/Bluetooth pads). Browsers only expose a controller after you press
one of its buttons with the game focused. Browsers also don't count a controller press as
a user gesture, so if the music stays silent, click the page or press a key once.

The day/night cycle follows your device clock: lamps and windows light up at night,
and the village music switches to a quieter night theme.

## How it's built

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the module contracts. In short:

| Folder | Concern |
| --- | --- |
| `src/core` | events, frame loop, input, save state |
| `src/world` | tile legend, map model & movement rules, map data, the diorama builder |
| `src/render` | renderer, day/night lighting, camera rig |
| `src/actors` | procedural chibi characters, wildlings, emote bubbles |
| `src/systems` | world session: movement, NPC AI, follower, interaction, scripts, warps, encounters |
| `src/ui` | web components: dialog, menus, title, touch pad, banners |
| `src/audio` | procedural chiptune music, sound effects and creature cries (Web Audio) |

### Make your own town

Maps are plain JS modules in `src/world/maps/`. Each map has ASCII `tiles`, optional
`heights`, `objects`, `npcs`, `warps`, `triggers` and async `scripts`:

```js
scripts: {
  greet: async (api) => {
    await api.say(['Morning!', 'The creek is singing today.'], { speaker: 'Posy' });
    if (await api.confirm('Water the flowers?')) api.setFlag('watered');
  },
},
```

Run `npm run validate` after editing: it checks reachability, doors, flags and scripts.

## Why this exists (P3)

- **Person:** indie and hobbyist game makers, and game-dev club teachers, who want to
  make a cozy creature-RPG for the web without learning an engine or a build pipeline.
- **Problem:** the overworld foundation (grid movement with elevation, doors, scripted
  dialogue, day/night, touch controls, audio) takes weeks before any of the fun parts,
  and engine web exports are heavy on phones.
- **Promise:** fork a charming, playable 3D village that runs in any phone browser,
  then build your own town by editing ASCII maps and dialogue scripts, with no build step.

Monetisation path: a free playable demo (this) plus a paid starter kit (source, docs,
extra modules such as a map editor, battles and asset packs) on itch.io or Gumroad.
