# Patch notes

Newest first. Play at https://ycgnem.github.io/pixel-rts/

## 2026-10-21: Mega units, work zones and a rocket that ends the world

- **Two mega units**, each $1,000 + 1,500 oil. You can have **at most 2 of each** at a time,
  counting any still in training. Both can attack any unit (land, sea or air) and any building.
  - **Mega Tank** (Factory, after Composite Armor): a land dreadnought on six treads, twice a
    Heavy Tank's size. 3,440 HP, a triple cannon, machine guns and flak. **Steamroller** (E): 40%
    faster for 8 seconds, and enemy infantry under its tracks get crushed.
  - **Mega Plane** (Airfield, after Jet Engines): a black flying wing with eight glowing jets.
    2,000 HP, 200-damage bombs, and missiles for aircraft. **Carpet Bomb** (E): for 4 seconds a
    bomb falls under it every 0.4 s, wherever you fly it.
- **A harsher economy.** Buying oil at the HQ costs **$1,250 for 100** (five times the old price);
  each buy still makes the next one 10% dearer, and prices cool off as before. Oil comes from
  Derricks now. The **Launch Site costs $100,000 + 5,000 oil.**
- **Balance:** every ground unit, infantry and vehicles alike, has **7.5% more HP and damage**.
  **Bombers deal 10% less.**
- **Builder work zones.** Select Builders, press **Zone (G)** and click a spot (or drag to size
  it). They build and repair only inside that zone, come back if something pulls them away, and
  walk its edge when there's nothing to do. No more Builders sprinting across the map. A Move or
  Stop order frees them. The zone shows as a dashed green circle.
- **Sell hotkey: Z.** Press it twice to sell the selected units or buildings (Delete and Backspace
  still work). Selling several selected buildings sells them all.
- **The rocket can't be missed.** A big countdown clock sits under the top bar for every player,
  green for your side's rocket and red for a rival's. It blinks in the last 30 seconds and beeps
  through the last 10. Click it to look at the pad, which pulses with a beacon. When the countdown
  ends, the rocket lifts off and **the whole island it stood on blows up**: a white flash, a
  shockwave, and a firestorm that sweeps the land and leaves it scorched. Any key skips it.
- **Maps without a river:** the setup has **River: On/Off** for Pangaea and Lakes maps.
- **Sandbox mode:** the **Sandbox** button on the title screen (or **Start money: Infinite** in a
  skirmish) gives you endless cash, oil, science and Command Points. Research finishes at once, so
  you can unlock and build anything, mega units included, and try it against an Easy AI.
- **Smoother games.** Online matches send about two-thirds less data, so 4-player games stop
  lagging. Scrolling onto ground that hasn't been drawn yet no longer stutters: it's painted over
  a few frames instead of all at once.

## 2026-10-14: Rivers, busy Builders and slower tanks

- **A river now winds across Pangaea and Lakes maps,** from one edge through the middle to the
  other, splitting the players into two sides. **Two stone bridges** cross it, one on each side of
  the middle, and roads lead over both. They are the only way across on foot, so hold them.
  Boats can sail up the river and under the bridges.
- **Maps are a bit bigger:** Small 144, Medium 224, Large 288 tiles across.
- **Builders never stand around while there's work.** An idle Builder walks over to any of your
  unfinished buildings by itself, and every project gets one Builder before any gets two. With
  several Builders selected, a new building takes just one of them; Shift-placing a row of
  buildings hands each to a different Builder.
- **Tanks come later:** the Factory needs a finished Barracks first and costs $700. A Light Tank
  costs $300 + 55 oil and takes 18 s (it's a little tougher, 380 HP). You start with 100 oil,
  enough for one tank; after that you need an Oil Derrick.
- **Oil explains itself:** the top bar says "oil" and shows "build a Derrick" in gold while you
  pump none. Buttons show their oil price in the top-right corner, in red when you're short.
  Hover an oil well or ore field on the map to see what to build there. If you can't afford
  something, the message says exactly what's missing.
- **City specialties are easy to spot:** when a city grows into a Town, a panel lists every
  specialty and what it does; one click picks it. The city also blinks "pick a specialty!" on
  the map.
- Large groups no longer give up halfway when they have to queue for a bridge or detour around
  water.

## 2026-10-14: First orders

- **New players get step-by-step orders in any match,** not just Boot Camp. A card at the top
  left tells you the very next thing to click, and it changes as you go. Pick a Builder, then
  Build, then the Mine, then the ore. A gold arrow marks the spot on the map ("Ore", "Builder",
  the city's name), and a blinking frame marks the button to press.
- **Research is no longer a mystery:** the orders open the tech tree with you, point at a good
  first tech (Deep Mining) and say that it finishes by itself while you play.
- **The orders cover the opening:** mine ore, start research, take a city with your starting
  Riflemen, pump oil, raise a Barracks and build a Factory. Each one says why it matters.
- They go away for good once you have finished them. Click **Hide** to stop them early, or turn
  them back on from **Menu > First orders**.
- **Boot Camp** uses the same smarter steps and no longer has a separate "pick a Builder" step.
- **Esc** now closes an open window (Research, Stats, Help) before anything behind it.
- The in-match menu no longer cuts off its last button.

## 2026-10-14: A map worth looking at

### Camera
- **WASD now scrolls the map.** The arrow keys, screen edges, middle-drag and the minimap all
  still work.
- **New command-card hotkeys**, so W, A, S and D only ever move the camera:

  | Action | Old key | New key |
  |---|---|---|
  | Attack-move | A | **Q** |
  | Stop | S | **X** |
  | Ability (second ability stays on F) | D | **E** |
  | Drop partisans | D | **V** |
  | Build Airfield | A | **E** |
  | Build Dock | D | **N** |
  | Train Scout Car | S | **C** |
  | Train Artillery | A | **R** |
  | Train Destroyer | D | **R** |
  | Train Submarine | S | **U** |

- **Smoother zoom.** The view now slides between zoom levels instead of jumping. One mouse-wheel
  click is one zoom step, and a trackpad swipe no longer skips several levels at once.

### The map
- **No more square tiles.** The ground is painted pixel by pixel, so coastlines, forest edges and
  roads curve naturally instead of stepping. Gameplay doesn't change: units move on the same tiles
  as before.
- **Water** runs from pale shallows to deep blue, with foam on the beaches, waves rolling up the
  shore and sunlight glinting on the open sea.
- **Grass** has clumps with sunlit tips, single blades, wildflowers, and lush and dry meadows.
- **Dirt roads** have wheel ruts, a grassy strip down the middle, pebbles and tufts at the edges.
- **Forests** are dense woods of individual trees, broadleaf and pine (more pines near
  mountains).
- **Mountains** are walls of rock crowded with peaks: snow caps in the middle of a range, bare
  rock on its edges, cliffs on the south side and loose stones around the base. Even a thin ridge
  reads as impassable.
- **Hills** are pale raised plateaus with a shaded edge, so you can spot the high ground that
  gives extra sight.
- **Rich ore** ground is dark earth scattered with rocks and glinting ore.
- **Farmland:** every town is surrounded by fields. Wheat, young green crops, rows of vegetables,
  ploughed earth, a little lavender, and pastures where sheep and cows graze, with dirt tracks and
  hedges between them. Bigger towns farm more land.
- **Scenery everywhere:**
  - haybales, carts, wells and beehives between the fields
  - palms, driftwood, shells and rowboats on the beaches
  - reeds and lily pads in calm shallows
  - stumps, logs, ferns, mushrooms and foxes at forest edges
  - rocks and cairns below the mountains
  - old war relics (tank wrecks, sandbags, barbed wire, craters) out in the open

  Animals turn around now and then.
- **Ambience:** faint cloud shadows drift across the map by day, and flocks of birds fly over now
  and then (gulls over the sea), casting shadows on the ground.
- **Nothing overlaps:** scenery never covers a road, a town, an ore deposit, a building, a crop
  field or another prop.

### Under the hood
- 112 new pieces of art: 32 trees, 16 mountain peaks and 64 decorations.
- Frame rate unchanged.
