# Wildling Trails — Architecture & Module Contracts

An **original** cozy 3D creature-companion RPG starter town that runs in the browser.
Tile-based overworld, diorama camera, NPCs, signs, doors into interiors, a researcher's
greenhouse lab where you choose a partner creature ("wildling"), a real-clock day/night
cycle, original chiptune audio, and touch controls.

> **Originality rule (hard requirement).** Everything here is original. Do not use any
> names, characters, creatures, places, items, dialogue, music, map layouts or visual
> designs from any existing game franchise — in particular nothing from Pokémon
> HeartGold/SoulSilver or any other Pokémon title. Genre mechanics (grid movement,
> ledges, tall grass, a starter choice, a following companion, day/night) are fine;
> their specific expressions in existing games are not.

## Tech rules (all modules)

- Plain ES modules, **no build step**, no frameworks. Only dependency: `three` (0.170.0),
  imported as `import * as THREE from 'three'` and `three/addons/...` (import map in
  `index.html`; `node_modules/three` is installed so Node tests resolve the same names).
- **No DOM/window access at module top level.** Touch `document`/`window`/`AudioContext`
  only inside functions called at runtime. This keeps every module importable from Node
  tests (`node --test "tests/**/*.test.mjs"`).
- JSDoc on every export. Small files, one concern each.
- Never cache `state.flags` / `state.party` references across calls — `resetState()`
  replaces them. Always read through `state.flags[...]` or the helpers.
- Tests live in `tests/<area>.test.mjs` and use `node:test` + `node:assert/strict`.
- Each module group owns its files. Do not edit files owned by another group. If a
  contract is insufficient, implement the closest thing that satisfies the contract and
  report the gap.

## File ownership

| Owner | Files |
| --- | --- |
| core (lead) | `index.html`, `server.mjs`, `package.json`, `src/main.js`, `src/config.js`, `src/core/events.js`, `src/core/loop.js`, `src/core/state.js`, `src/world/tiles.js`, `src/world/map-utils.js`, `src/world/map-registry.js`, `src/data/wildlings.js`, `docs/ARCHITECTURE.md` |
| render+world | `src/render/renderer.js`, `src/render/daynight.js`, `src/render/camera-rig.js`, `src/render/palette.js`, `src/render/materials.js`, `src/world/build-map.js`, `src/world/builders/*.js`, `tests/world.test.mjs` |
| actors | `src/actors/humanoid.js`, `src/actors/wildlings.js`, `src/actors/emote.js`, `src/actors/*.js`, `tests/actors.test.mjs` |
| systems | `src/systems/*.js` (entry: `world-session.js`), `tests/systems.test.mjs` |
| ui+input | `src/core/input.js`, `src/core/gamepad.js`, `src/ui/*.js` (entry: `register.js`), `styles/tokens.css`, `styles/app.css`, `tests/input.test.mjs` |
| audio | `src/audio/*.js` (entry: `audio.js`), `tests/audio.test.mjs` |
| content | `src/world/maps/*.js`, `tools/validate-maps.mjs`, `tests/maps.test.mjs` |

## Coordinates & scale

- 1 tile = 1 world unit. Tile `(x, y)` has its **center** at world `(x, 0, y)`;
  it spans `[x-0.5, x+0.5] × [y-0.5, y+0.5]`.
- Row 0 of a map is **north** (−z). Column 0 is **west** (−x). The camera sits south
  (+z) and above, looking north-ish, so "up" on screen = north = −z.
- Elevation: `heights` digit `L` → walking surface at `y = L * LEVEL_HEIGHT` (0.5).
  Stairs tiles add half a level (`surfaceY`).
- Facing is one of `'up' | 'down' | 'left' | 'right'`. Models face **+z** at rotation 0
  (= `'down'`, toward the camera). `FACING_ANGLE` in `config.js` gives `rotation.y`.
- Character scale: adults ≈ 1.05 units tall (chibi, head ≈ 40% of height), kids ≈ 0.8,
  wildlings ≈ 0.45–0.6. One story of wall ≈ 1.5 units; roofs add ≈ 1.
- Shared constants/helpers: `src/config.js` (`DIRS`, `OPPOSITE`, `FACING_ANGLE`,
  `LEVEL_HEIGHT`, step timings, `PLAYER_LOOK`).

## Map format (`src/world/maps/<id>.js`, default export)

```js
export default {
  id: 'fernhollow',            // must equal the registry key
  name: 'Fernhollow',          // shown in the location banner
  kind: 'outdoor',             // 'outdoor' | 'indoor'
  music: 'town',               // audio music id; optional musicNight: 'town-night'
  tiles: [ '...', ... ],       // rows N→S, one char per tile (legend in tiles.js)
  heights: [ '000', ... ],     // optional, same dims, digits 0-9 (missing → all 0)
  spawn: { x, y, facing },     // used for new games / when no position is known
  onEnter: 'scriptId',         // optional script run after every load of this map
  objects: [ ... ],            // see Objects
  npcs: [ ... ],               // see NPCs
  warps: [ { x, y, to: 'home', tx, ty, facing: 'up' } ],
  triggers: [ { x, y, script: 'id', showIf?, hideIf? } ], // run on arriving at tile
  scripts: { id: async (api) => { ... } },
};
```

### Tile legend (`src/world/tiles.js`)

| char | meaning | walkable |
| --- | --- | --- |
| `.` grass · `,` dirt path · `:` cobblestone · `_` sand · `f` flowers | ground | yes |
| `"` tall grass (rustles, wild encounters) | ground | yes |
| `~` water · `=` bridge over water | water | no · yes |
| `T` tree · `h` hedge · `R` rock/boulder · `F` fence · `#` generic blocker | blockers | no |
| `v` `<` `>` ledge (hop over it moving down / left / right, landing 2 tiles away) | ledge | no |
| `S` stone stairs (connects its level L with a neighbour at L+1) | stairs | yes |
| `D` building door tile (inside a building footprint, bottom row) | door | yes |
| `o` wood floor · `t` lab tile floor · `E` exit mat (indoor) | indoor floor | yes |
| `W` wall (indoor) · ` ` (space) void | — | no |

### Objects

Common fields: `{ type, id?, x, y, w?, h?, variant?, color?, facing?, text?, script?, showIf?, hideIf? }`.
`x, y` is the **north-west** tile of the footprint. `text` (string or string[] pages) or
`script` makes a solid object interactable. `showIf` / `hideIf` take a flag name or an
array; a leading `!` negates (`'!has_partner'`). `showIf`: all must hold; `hideIf`: any
hides. Hidden objects are invisible and not solid.

| type | default w×h | solid | notes |
| --- | --- | --- | --- |
| `building` | (required) | yes, except its door tile | `variant: 'cottage' \| 'house' \| 'greenhouse' \| 'mill'`, `wall`, `roof` (hex), `door: {x, y}` (absolute tile on the bottom row, char `D`) |
| `bigtree` | 2×2 | yes | landmark tree |
| `sign` `mailbox` `lamp` `barrel` `crate` `flowerpot` `stump` `statue` | 1×1 | yes | `lamp` glows at night; `statue` may take `species` |
| `well` | 2×2 | yes | |
| `bench` `logpile` | 2×1 | yes | |
| `waterwheel` | 1×2 | yes | sits on water beside a mill, animated |
| `lilypad` | 1×1 | no | on water |
| `bed` | 1×2 | yes | indoor |
| `table` `bookshelf` `desk` `planter` `fireplace` | 2×1 | yes | indoor |
| `counter` | w×1 | yes | NPCs can be talked to across it |
| `chair` `stool` `stove` `cupboard` `plant` `radio` `terminal` `machine` `sink` | 1×1 | yes | indoor |
| `pedestal` | 1×1 | yes | `species`, `emptyIf` (flag/array, any → no creature shown) |
| `rug` | w×h | no | decorative |

Unknown types must render as a neutral placeholder and log a warning, never crash.

### NPCs

```js
{ id: 'posy', name: 'Posy', x, y, facing: 'down',   // name = dialog speaker label
  look: { skin, hair, hairStyle, hat?, shirt, pants, shoes, outfit?, outfitColor?, build, accessory?, accessoryColor? },
  behavior: 'stand' | 'turn' | 'wander', radius: 2,      // wander stays within radius of home
  text: '...' | ['page', 'page'],  // or script: 'id'
  noTurn?: true,                    // don't auto-face the player when talked to
  showIf?, hideIf? }
```

`look` vocabulary — `hairStyle`: `short | long | ponytail | bun | spiky | bald | bob | cap | beanie`
(`hat` colours `cap`/`beanie`); `outfit`: `null | labcoat | apron | overalls | jacket | dress`;
`build`: `adult | kid | elder`; `accessory`: `null | glasses | scarf | backpack | fishing-rod | cane | watering-can`.

### Movement rules (`map-utils.js → canStep`, authoritative)

- Out of bounds → blocked. Target tile not walkable (static) or covered by an active
  solid object (except a building's own door tile) → blocked.
- Ledge tile whose direction equals the move direction → **hop** over it, landing 2
  tiles away if that tile is walkable.
- Levels must match, except stairs: a stairs tile at level L connects to neighbours at
  L and L+1.
- Actor occupancy (NPCs, player) is checked by systems on top of `canStep`. The
  follower never blocks the player.

## Module contracts

### core (lead) — already implemented

- `config.js` — constants above + `tileToWorld(x, y)`.
- `core/events.js` — `bus.on(type, fn) → off`, `bus.emit(type, detail)`. Events:
  `flag {name, value}`, `party`, `seen {species}`, `saved`, `map {id}`.
- `core/loop.js` — `createLoop(update(dt, elapsed)) → { start, stop }` (dt seconds, ≤ 0.1).
- `core/state.js` — `state` `{ mapId, x, y, facing, flags, party:[{species,name}], seen:[], playTime }`,
  `prefs { muted }`, `resetState() loadState() saveState() hasSave() getFlag(n) setFlag(n, v=true)
  addPartner(species) markSeen(species) loadPrefs() savePrefs()`.
- `world/tiles.js` — `TILE_TYPES[char]`, `VOID_TYPE`, `tileType(char)`.
- `world/map-utils.js` — `createMapModel(def) → MapModel`:
  `{ def, id, name, kind, width, height, objects, npcs, warps, triggers, scripts,
  inBounds, charAt, typeAt, levelAt, surfaceY, objectsAt, activeObjectAt(x,y,flags),
  doorBuildingAt, warpAt, triggerAt(x,y,flags), isWalkableStatic(x,y,flags),
  canStep(x,y,dir,flags) → {ok, x, y, hop, reason}, isActive(entity, flags) }`.
  Objects are normalised with `w`, `h`, `solid`, `index`.
- `world/map-registry.js` — `getMapDef(id)`, `MAP_IDS`.
- `data/wildlings.js` — `WILDLINGS[id] = { id, name, element, starter, blurb }` for
  `emberkit, brookling, mossbun, pipwing, dewsnail`; `STARTERS`, `WILD_SPECIES`.

### render+world

```js
// src/render/renderer.js
createRenderer(canvas) → { renderer, scene, camera, resize(), render() }
//   PerspectiveCamera (fov≈38), sRGB output, ACES or neutral tone mapping, PCFSoft shadows,
//   pixelRatio = min(devicePixelRatio, 2) (1.5 when (pointer: coarse)). resize() reads canvas client size.

// src/render/daynight.js
getTimePhase(date = new Date()) → 'morning'|'day'|'evening'|'night'   // 5–10, 10–17, 17–20, 20–5
createDayNight({ scene, renderer }) → {
  update(dt, focus /* THREE.Vector3 */),   // owns sun DirectionalLight (shadow camera follows focus),
                                            // hemisphere light, scene.background, scene.fog; smooth transitions
  setIndoor(bool),                          // warm fixed interior lighting, no fog, dark background
  setOverride(phase | null),                // null = live clock
  get override, get phase, get nightFactor /* 0 day … 1 night, smoothed */, get isNight
}

// src/render/camera-rig.js
createCameraRig(camera) → {
  focus /* THREE.Vector3, smoothed look-at point (read it, don't replace it) */,
  setMode(mode /* 'outdoor'|'indoor'|'title' */, opts? /* { center?: Vector3, bounds?: {minX,maxX,minZ,maxZ} } */),
  setTarget({ x, y, z }), snap(), update(dt)
}
//   outdoor: follows target from south-above (offset ≈ (0, 8.5, 7.5)); indoor: frames the room
//   using bounds (center if it fits, else follow clamped); title: slow orbit around opts.center.

// src/world/build-map.js
buildMap(model /* MapModel */, { flags, createWildlingModel }) → MapView {
  group,                                       // THREE.Group, add to scene
  update(dt, elapsed, { nightFactor, focus, playerPos }),
  applyFlags(flags),                           // re-evaluate showIf/hideIf/emptyIf
  rustleGrass(x, y),                           // tall-grass rustle animation at tile
  dispose()
}
```

The builder renders terrain (per-tile ground by type and level, cliff faces between
levels, sunken water with banks, bridges, stairs, ledges), nature (trees by `T`, hedges,
rocks, flowers, swaying tall grass), fences (auto-connecting rails), buildings (with a
door aligned to `door.x`, lit windows at night), all object types, and an outdoor
"skirt" of forest/ground ≥ 10 tiles beyond the map bounds so the camera never sees the
void. Indoor maps: walls from `W` tiles (tall back wall with windows on the top row,
low cut-away walls on the sides/bottom so the camera sees in), void stays dark.
Pedestal creatures use the injected `createWildlingModel(species)` and are animated in
`update`. Performance: merge static geometry per material, instance repeated props;
target < 150 draw calls outdoors, 60 fps on mid-range phones. Lamps/windows glow with
emissive materials + additive sprites, at most 2–3 real point lights.

### actors

```js
// src/actors/humanoid.js
createHumanoid(look) → ActorModel
// src/actors/wildlings.js
createWildlingModel(speciesId) → ActorModel
// ActorModel
{
  group,                         // THREE.Group; origin at feet; faces +z at rotation 0
  height,                        // approx. top of head (for emotes)
  setFacing(dir, instant = false),  // smooth turn toward FACING_ANGLE[dir]
  setMoving(moving, running = false), // walk/run cycle on/off
  hop(),                          // squash/stretch accent; systems drive the y arc
  emote(kind /* '!'|'?'|'…'|'♥'|'♪' */, ms = 1100) → Promise<void>, // bubble above head; resolves after ms
  update(dt),                     // advance animations (walk, idle breathing, blink, turn lerp)
  dispose()
}
```

Style: chunky low-poly chibi, `MeshToonMaterial` (shared 3-step gradient), subtle
inverted-hull outline, a soft blob shadow plus `castShadow`. Wildling designs (original):

- **Emberkit** — fox kit; warm orange body, cream muzzle/belly, big ears with dark tips,
  fluffy tail whose tip is a glowing, flickering ember.
- **Brookling** — axolotl-like newt; pale aqua body, three frilly coral-pink gill fronds
  per side, stubby legs, flat finned tail, big dark eyes.
- **Mossbun** — round sage-green rabbit; long ears with pale insides, a fern sprout on
  its back, tiny pink flower by one ear, cotton tail.
- **Pipwing** (wild) — plump blue-grey songbird with a butter-yellow chest, tiny wings, hops.
- **Dewsnail** (wild) — lavender snail with a glassy teal shell that glows softly.

### ui+input

```js
// src/core/input.js — singleton
input.init(target = window)       // attach keyboard/blur listeners (idempotent); tests pass an EventTarget
input.isDown(action) → bool       // actions: up down left right a b start run time
input.heldDirection() → dir|null  // most recently pressed direction still held
input.pressed(action) → bool      // polled edge; returns true once per unconsumed press
input.onPress(action, fn) → off   // fn() may return true to CONSUME the press: later
                                  // listeners and the polled buffer don't see it.
                                  // Listeners run newest-registered first.
input.setVirtual(action, down)    // from <touch-pad>
input.setSource(action, src, down)// any named source, e.g. 'pad0:b0' (setVirtual = source 'virtual')
input.isHeldBy(action, src) → bool
input.clear()                     // release everything (window blur / tab hidden). Not called on
                                  // map loads: a held direction keeps walking through doors.
input.endFrame()                  // drop unconsumed polled presses; call once per frame
```

```js
// src/core/gamepad.js — Gamepad API has no events, so main.js polls each frame
const pads = createGamepadPoller(input, { getGamepads? })  // tests inject getGamepads
pads.poll()        // first thing in the frame; each button/stick is its own input source
pads.connected     // pads seen on the last poll
pads.reset()
```

Gamepad (standard mapping): d-pad/left stick → directions; A → a; B → b; X, LB, RB, LT, RT → run;
Menu/Y → start; View → time. A pad that disappears releases what it held; after `input.clear()`
a held stick resumes walking but a held button is never replayed as a new press.

Keys: arrows/WASD → directions; `Z`/`Space`/`J` → a; `X`/`Backspace`/`K` → b;
`Enter`/`Escape` → start; `Shift` → run; `T` → time. Holding **b** while walking also runs.

Web components (Shadow DOM, one per file, tag = file name, styles via CSS tokens).
They react to input through `input.onPress` (returning `true` while they own focus) and
also support click/tap. For sounds they dispatch
`new CustomEvent('ui-sfx', { detail: { id }, bubbles: true, composed: true })`.

| element | API |
| --- | --- |
| `<dialog-box>` | `say(pages: string\|string[], { speaker? }) → Promise<void>` (typewriter; a = finish page / next), `choose(prompt, options) → Promise<number>` (−1 on b), `get isOpen` |
| `<location-banner>` | `show(text, ms = 2200)` |
| `<fade-overlay>` | `fadeOut(ms = 220) → Promise`, `fadeIn(ms = 220) → Promise` |
| `<story-card>` | `show({ title, body, cta? }) → Promise<void>` (closes on a/tap) |
| `<title-screen>` | attrs `loading`, `has-save`, `pad` (shows controller hints); `hide()`, `show()`; events `title-wake` (first press/tap; used to unlock audio) and `title-start` `{ detail: { mode: 'new'\|'continue' } }` |
| `<pause-menu>` | `open()`, `close()`, `get isOpen`, `setParty([{species,name,element,blurb}])`, `setJournal({ seen:[ids], all:[{id,name,element,blurb}] })`, `setSound(on)`, `setClock(label)`; events `menu-action` `{ action: 'save'\|'sound'\|'clock'\|'close' }`, `menu-close` |
| `<touch-pad>` | auto-shows on coarse pointers / first touch; d-pad (slide between directions), A, B, START → `input.setVirtual` |

`src/ui/register.js` imports every component. `styles/tokens.css` holds all design
tokens on `:root` (+ dark-friendly game palette); `styles/app.css` lays out the stage
(full-viewport canvas, `.hud` overlay, safe-area insets, mobile-first).

### audio

```js
// src/audio/audio.js — singleton facade; every call is a safe no-op without Web Audio
audio.unlock() → Promise<void>     // create/resume AudioContext on a user gesture
audio.playMusic(id, { fadeMs = 600 } = {})  // loops; same id keeps playing
audio.stopMusic({ fadeMs })
audio.sfx(id)    // step bump door confirm cancel cursor text ledge grass save fanfare encounter menu
audio.cry(speciesId)
audio.setMuted(bool); audio.muted
```

Music ids: `title`, `town`, `town-night`, `home`, `lab`. All compositions original
(handheld-style square/triangle/noise voices, lookahead scheduler). Suspend when the tab
is hidden.

### systems

```js
// src/systems/world-session.js
createWorldSession({ scene, cameraRig, dayNight, ui, audio, input, deps? }) → {
  preview(mapId) → Promise,        // build map without player; cameraRig 'title' mode
  start() → Promise,               // load state.mapId at state.x/y (map spawn if null); runs onEnter
  loadMap(mapId, x?, y?, facing?, { fade = true } = {}) → Promise,
  update(dt, elapsed),
  setPaused(bool),
  get busy, get mapModel, get playerTile /* {x, y, facing} */,
  runScript(idOrFn) → Promise
}
// deps (optional, for tests): { buildMap, createHumanoid, createWildlingModel, getMapDef, random }
// NPC `text` is spoken with { speaker: npc.name }.
// ui = { dialog, banner, fade, card, menu, title, touch } (the elements above)
```

Responsibilities: grid movement for player/NPCs/follower (turn-in-place on a short tap,
walk/run, ledge hop arc, stairs), collision (`canStep` + actor occupancy with
reservations while moving), interaction (a → NPC/object in front; across counters;
facing the follower → affection), NPC AI (`stand`/`turn`/`wander`), the follower
(walks into the player's previous tile, hops ledges, appears behind the player after a
warp), warps (fade, door sfx), triggers, tall-grass rustle + flavour encounters (with a
partner: occasionally a wild Pipwing/Dewsnail peeks out, cries, gets marked seen, and
leaves — no battles), music per map (`musicNight` at night), location banner on
outdoor entry, keeping `state.mapId/x/y/facing` current, autosave on map change.

**Script API** passed to `scripts[id](api)`:

```js
api.say(pages, { speaker? }) → Promise        api.choose(prompt, options) → Promise<number>
api.confirm(prompt) → Promise<boolean>        api.wait(ms) → Promise
api.flag(name) → bool                         api.setFlag(name, value = true)
api.hasPartner() → bool                       api.partner() → {species, name} | null
api.givePartner(speciesId)                    // adds to party, fanfare, spawns follower, saves
api.markSeen(speciesId)
api.npc(id) → { face(dir), facePlayer(), walk(dirs[]) → Promise, emote(kind) → Promise,
                hide(), show(), x, y }        // scripted walks ignore collision
api.player → { face(dir), walk(dirs[]) → Promise, emote(kind) → Promise, x, y, facing }
api.follower → { emote(kind) → Promise, hop() } | null
api.sfx(id)  api.music(id)  api.cry(speciesId)  api.banner(text)
api.card({ title, body, cta? }) → Promise     api.warp(mapId, x, y, facing) → Promise
api.save()
```

A script runs with the player frozen (`busy`). Errors are caught, logged, and leave the
game playable.

## Frame order (`src/main.js`)

`session.update(dt) → cameraRig.update(dt) → dayNight.update(dt, cameraRig.focus) → render() → input.endFrame()`.

## Art direction

Warm, hand-built diorama: chunky low-poly forms (rounded boxes, cylinders, icosahedron
foliage), toon shading with soft shadows, gentle animation everywhere (swaying grass,
flickering lamps, drifting clouds' shadows optional, rippling water). Original palette:

| token | hex | | token | hex |
| --- | --- | --- | --- | --- |
| meadow | `#86b86a` | | meadow-dark | `#5e9a4f` |
| path | `#d9bb8c` | | cobble | `#b9b1a3` |
| sand | `#ead9a8` | | water | `#4fa7a8` / deep `#2c7a86` |
| foliage | `#3f7d4a` / light `#69a85a` | | bark | `#7a5236` |
| roof terracotta | `#c8643b` | | roof slate | `#4f6d8f` |
| roof moss | `#6b8f4e` | | roof plum | `#7d5a7a` |
| wall cream | `#f2e6cf` | | timber | `#8a5a3b` |
| lamp glow | `#ffc56b` | | night ambient | `#1d2440` |

Tone of writing: warm, gently funny, short lines (≤ 2 lines / ~70 chars per page).
