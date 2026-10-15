# Patch notes

Newest first. Play at https://ycgnem.github.io/pixel-rts/

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
