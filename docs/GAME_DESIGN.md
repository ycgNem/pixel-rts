# Game Design — Pixel RTS (working title)

A top-down pixel-art real-time strategy game for the browser, for 1–6 players. It combines the
real-time base building and combined-arms battles of **The Conquerors 3** with the strategic layer
of **Strategema**: a tech tree, cities that grow, and several ways to win. Friends play together
online peer to peer (co-op against AI, teams, or free-for-all) straight from a web page.

Both Roblox games are inspiration only. All names, art, and sound in this game are original.

The numbers below match `src/data/` at the time of writing. **The data files win** when they
differ: that is where balancing happens. This document describes the rules.

---

## 1. Pillars

1. **Readable chaos.** With 300+ units on screen you can still tell whose they are and what they are.
2. **Cities are the map.** You expand by taking and growing cities, not only by placing mines.
3. **More than one way to win.** Military, science, or holding cities. Every win attempt is
   visible to everyone, so other players can always respond.
4. **Easy to play with friends.** Open a link, share a code, play. No accounts, no installs.
5. **Balance lives in data.** Units, buildings, techs, and costs are all tunable without code changes.

### What comes from where, and what we added

Everything borrowed gets a twist of our own.

| From The Conquerors 3 | Our twist |
|---|---|
| Start with an HQ; lose it and you lose | **Government in exile** (§9): your biggest city carries on as the capital, with partisans and fortress guns. **Insurgency** (§9): even a knocked-out player fights on with partisan drops, and can come back. **Home Front** (§7): the land around your cities and HQ is yours, and your units heal on it |
| Mines and oil | **Rich ore** veins in the contested middle; the **exchange** (§4) trades spare cash and oil |
| Barracks, factories, airfields, docks | Unit **abilities** (dig in, smoke, flare, barrage, afterburner, sonar), **veterancy**, and named **aces** (§6) that make the units near them fight harder |
| Capture neutral cities with infantry | Cities have **militia** that shoot back (§7) and pick a **specialty** when they grow; a city taken from a living player **resists** (§7) until you garrison it; cities post **contracts** (§7): win a city's tender and it joins you peacefully, hold one for a reward, or take a bounty city from the runaway leader |
| Islands and naval invasions | Island maps give **every player a home island** around a neutral middle island (§3); coastal cities send **merchant convoys** (§7) for navies to escort and raid |

| From Strategema | Our twist |
|---|---|
| Tech tree with eras | **Doctrines** (§8): one of three choices per era, some of which change how units behave |
| Cities that grow | Specialties (industry, university, fortress, market, harbor) |
| Several win conditions | A **victory tracker** on screen; supremacy can't start before 15:00 (later with more teams); a **coalition** (§9) forms against whoever starts a countdown; a launch can be **scrubbed** (§9) by infantry at the site |

| Our own |
|---|
| **Command Points and Powers** (§10): recon, lend-lease supply drop, field repairs, rally cry, artillery strike, paradrop, and **Call for Help**, a team flare that allied AIs answer |
| An end-of-match **chronicle** (the key moments and an MVP) with **Rematch** and **New map** |
| **Supply crates** parachute into the open map; they grow with match time |
| **Weather and day/night**: rain slows ground units, storms ground aircraft, night cuts sight |
| 1–6 players over browser peer-to-peer, with AI takeover when someone drops |

---

## 2. Core loop

**Moment to moment:** select → order → watch → react.

**Economy loop:**

```
 mines + oil + cities ──► cash, oil, science ──► buildings ──► units ──► take and hold cities
        ▲                                │                                       │
        │                                └──► research ──► better units,         │
        │                                                  bigger cities,        │
        └────────────────────── more and larger cities ◄─────────────────────────┘
```

**Arc of a match** (target 30–45 minutes for 4–6 players, at least 20 for 1v1):

| Phase | Time | What happens |
|---|---|---|
| Opening | 0–6 min | HQ trains Builders. Mines on the nearest ore, an oil derrick, barracks. Riflemen capture the nearest villages (whose militia shoot back). First research. |
| Expansion | 6–15 min | Era II and the first doctrine. Factory and tanks. Fights over the cities between bases. Cities grow into towns and pick specialties. |
| Mid game | 15–25 min | Era III, air and naval units, raids on mines and derricks. Supremacy becomes possible at 15:00 in a 1v1 (later with more teams or players: a 2v2 at 20:00). AIs leave enemy bases alone until 20:00 (Normal). |
| Endgame | 25+ min | Era IV. Someone pushes for an HQ kill, starts a launch, or holds most of the cities. A player whose HQ falls fights on from a capital in exile. |

---

## 3. The map

- **Tile grid, 32 × 32 px tiles** (art drawn in a high top-down ¾ view). Sizes: Small 144²,
  Medium 224², Large 288² (recommended for 5–6 players).
- **Generated from a seed.** The same seed and settings always give the same map, so online
  clients rebuild it instead of downloading it. Map types:
  - **Pangaea**: one landmass; every start can walk to every other (guaranteed).
  - **Lakes**: mostly land broken up by lakes; starts connected by land (guaranteed).
  - **The river** (Pangaea and Lakes): a winding river runs from the map edge through the middle
    and out again, splitting the players into two sides (2 v 2, 3 v 3; 2 v 1 and 3 v 2 with odd
    counts). Each half runs along the gap between two neighbouring starts, so no start sits on
    it. **Two bridges** cross it, one on each half and the same distance from the middle, and a
    road leads over each. They are the only ways across on foot: chokepoints worth holding.
    Boats sail the river and pass under the bridges.
  - **Continents** and **Islands**: every start gets **its own landmass**, separated from the
    others and from a **neutral middle island** by sea channels (continents: narrow straits;
    islands: wide, deep channels). Each home has 2 villages, 2 ore and 1 oil. The capital city and
    the rich ore sit on the middle island, so you need ships or aircraft to expand.
- **Fair starts.** Starts sit on a ring, evenly spaced (a start may shift at most 4 tiles toward
  better land). Each gets the same layout: 2 ore deposits, 1 oil well, and 2 villages, turned to
  face the middle. The neutral cities follow one pattern repeated around every start, so each
  player has about as many cities nearest them (tested over 30 seeds per map type). The extra ore
  and oil sit beside each start's own neutral cities in the same turned pattern, so every side of
  the map holds the same deposits (3 extra ore and 2 extra oil per player).
- **Map features:** ore deposits (Mines), oil wells (Derricks), **rich ore** in the middle (twice
  the output; contested), a level-3 capital city in the middle, about 3 more neutral cities per
  player (bigger toward the middle), and roads linking cities and starts. Trees, bushes, boulders,
  farm fields around cities, ruins and snowy peaks dress the land (scenery only: they never block
  anything).

| Terrain | Ground units | Ships | Aircraft | Notes |
|---|---|---|---|---|
| Grass / plains | normal | — | ✓ | buildable |
| Road | faster | — | ✓ | links cities; buildable |
| Forest | slower | — | ✓ | not buildable; blocks vision for ground units |
| Hills | slower | — | ✓ | extra sight for units on them |
| Mountains | blocked | — | ✓ | |
| Sand / shore | normal | — | ✓ | docks must touch water; transports land here |
| Bridge | faster | ✓ (underneath) | ✓ | crosses the river; not buildable |
| Water, deep water | blocked | ✓ | ✓ | |

---

## 4. Resources

| Resource | Comes from | Spent on |
|---|---|---|
| **Cash ($)** | Mines, cities, a small HQ trickle | Everything |
| **Oil** | Oil Derricks on oil wells | Vehicles, aircraft, ships, advanced buildings |
| **Science** | HQ, cities, Research Labs | Research. It flows into the current tech automatically. |
| **Supply** (a cap, not a stockpile) | HQ (20), cities (more per level), Logistics | Limits army size. Hard cap 200 per player. |
| **Command Points** | HQ (1/min), cities (more per level) | Command Powers (§10). Bank up to 10. |

- **Extractors work on their own.** A Mine on an ore deposit produces cash forever; no workers
  carry anything. Mines and derricks are targets to raid and defend. A destroyed derrick burns.
- Deposits never run out. The pressure to expand comes from cities.
- **Start:** HQ, 2 Builders, 4 Riflemen, $1,000, 100 oil (one tank's worth: more takes a
  Derrick), 2 Command Points.
- **Oil is explained where you need it:** the top bar shows "N oil" and, while no oil comes in,
  "build a Derrick" in gold; every button that costs oil shows its oil price (the oil drop and a
  number) in its top-right corner, red when you are short; hovering an open oil well or ore field
  says what to build there and how; and "not enough" messages say what is missing ("need 20 more
  oil (Oil Derricks on oil wells make oil)").

| Source | Output |
|---|---|
| HQ | $2/s, 0.5 science/s, 20 supply, 1 CP/min |
| Mine | $3.5/s (rich ore: double) |
| Oil Derrick | 1 oil/s |
| Research Lab | 1.5 science/s |
| Cities | see §7 |

### The exchange (our twist)

The HQ's command card has three trades: **Buy Oil** ($250 → 100 oil), **Sell Oil** (100 oil →
$150) and **Fund Research** ($400 → 100 science; needs a finished Lab). Each trade makes the next
of its kind 10% dearer; prices cool back down over a few minutes. It turns a lopsided economy
(lots of cash, no oil; a maxed-out army and money in the bank) into something useful without
becoming a second income. Mercantilism and Global Markets make trades pay more.

---

## 5. Buildings

Builders construct buildings. A Builder places a foundation and the building rises over time.
More Builders on one building build it faster. **One Builder per project, and no idle crews:**
placing a building with several Builders selected sends one of them (an idle one first, then
one whose building already has company, nearest first); the rest join only if they had nothing
to do, and Shift-queued buildings each go to a different Builder. A human player's idle Builder
(no orders, not on hold) walks by itself to the nearest unfinished building within 60 tiles that
has the fewest Builders, so every project gets one before any gets a second. (The AI places its
own crews.) Builders also repair, for 30% of the cost: at most
three count, each heals at most 40 HP/s, and **nobody can patch a building with an armed enemy
within 6 tiles**. A building cancelled during construction refunds 75%; a finished one can be sold
(click twice). With no rally point, new ground units walk a few tiles clear of the door.

| Building | Tiles | HP | Cost | Unlocked by | What it does |
|---|---|---|---|---|---|
| **HQ** | 4×4 | 9,000 | (start only) | — | Trains Builders. Income, science, supply, CP. Has a machine gun and a cannon. Runs the exchange. |
| Mine | 2×2, on ore | 600 | $250 | start | $3.5/s |
| Oil Derrick | 2×2, on oil | 600 | $300 | start | 1 oil/s |
| Barracks | 3×3 | 1,000 | $300 | start | Trains infantry |
| Factory | 4×3 | 1,500 | $700 | a finished Barracks | Trains vehicles |
| Research Lab | 2×2 | 600 | $400 | start | +1.5 science/s |
| Gun Turret | 1×1 | 500 | $200 | Fortification | Defense against ground units |
| Airfield | 4×5 | 1,800 | $800 + 100 oil | Flight | Trains aircraft |
| Dock | 3×3, touching water | 1,500 | $600 | Shipbuilding | Trains ships |
| AA Gun | 1×1 | 450 | $250 | Anti-Air | Defense against aircraft |
| Coastal Battery | 2×2 | 900 | $500 | Naval Doctrine | Long-range defense against ships |
| Radar | 2×2 | 700 | $500 | Radar | Large sight radius |
| Launch Site | 5×5 | 4,000 | $3,000 + 500 oil | Space Program | Science victory (§9) |

Production buildings hold a queue of 5 orders (shift-click adds 5 at a time) and a rally point.
Selecting several buildings of one kind spreads orders across their queues.

---

## 6. Units

Every unit moves on one of three **layers**: ground (land), naval (water), or air (anywhere).
Every weapon says which layers it can hit.

| Unit | Built at | Unlocked by | Cost | Supply | Role |
|---|---|---|---|---|---|
| Builder | HQ (or a capital in exile) | start | $100 | 1 | Builds and repairs. Unarmed. |
| Rifleman | Barracks, or a level 3+ city | start | $60 | 1 | Cheap all-rounder. **Captures cities.** Can dig in. |
| Rocket Trooper | Barracks | Rocketry | $130 | 1 | Anti-vehicle: beats Light Tanks cost for cost. Captures. |
| Flak Trooper | Barracks | Anti-Air | $100 | 1 | Anti-air infantry |
| Scout Car | Factory | start | $150 + 10 oil | 1 | Fast, long sight, light gun. Recon flare. |
| Light Tank | Factory | start | $300 + 55 oil | 2 | Main battle unit early on: cannon plus a machine gun. 380 HP, 18 s to build. Smoke screen. |
| Heavy Tank | Factory | Heavy Armor | $500 + 100 oil | 3 | Breaks defensive lines. Cannon plus a machine gun. 820 HP: beats Light Tanks cost for cost; Rocket Troopers beat it. |
| Artillery | Factory | Artillery | $400 + 70 oil | 3 | Long range, splash. Barrage. |
| Flak Truck | Factory | Anti-Air | $250 + 30 oil | 2 | Mobile anti-air |
| Fighter | Airfield | Flight | $300 + 80 oil | 2 | Hunts aircraft. Afterburner. |
| Bomber | Airfield | Bombers | $600 + 120 oil | 4 | Heavy damage to ground targets and buildings |
| Attack Helicopter | Airfield | Rotorcraft | $450 + 100 oil | 3 | Anti-armor |
| Patrol Boat | Dock, or a Harbor city | Shipbuilding | $200 + 20 oil | 2 | Fast, light |
| Transport Ship | Dock | Shipbuilding | $250 + 30 oil | 2 | Carries land units. 600 HP. |
| Destroyer | Dock | Naval Doctrine | $550 + 110 oil | 4 | All-rounder with flak. Sonar finds submarines; depth charges sink them. |
| Submarine | Dock | Submarines | $450 + 60 oil | 3 | Hidden until detected. Torpedoes sink battleships. |
| Merchant Ship | a coastal city (convoys) | needs a Dock | free | 0 | Unarmed trade ship; pays at your Dock |
| Battleship | Dock | Dreadnoughts | $1,000 + 200 oil | 6 | Long-range shore bombardment. 2,400 HP: outguns destroyers. |

**The naval triangle:** destroyers beat submarines (depth charges), battleships beat destroyers
(armor and big guns), submarines beat battleships (torpedoes). A patrol boat and destroyer
together beat a submarine. Measured with equal-value fleets (scripts in the sixth critic pass):
battleship vs destroyer 83% of its value left vs 0%, destroyer vs submarine 40% vs 0%,
submarine vs battleship 57% vs 0%.

**Aircraft** fly over everything and can't fly in storms. No fuel or ammo limits.

**Veterancy:** a unit earns a star each time it destroys 1×, 3× and 6× its own cost in enemies.
Each star gives +10% damage and +10% HP. A supply crate can also give a star. Ground and sea units
earn half the usual veterancy from hurting aircraft (otherwise flak stars up on cheap planes).

**Wanted aces (our twist):** each player has at most **one ace**: their most experienced unit
with all three stars. It gets a name from a list of 24 (for example "Iron Maud" or "Lucky Pip")
that no other ace in the match wears and the player hasn't used before. It keeps the title until
it falls; then the next unit in line steps up. Allied units within 5 tiles of an ace deal +15%
damage; the ace itself does not get this bonus, and two aces don't stack. There is a price on
its head: whoever kills an ace is paid **$300 and 2 CP**. Everyone is told when an ace is made
and when one falls (and who collects), and the end-of-match chronicle records it. Selecting or
hovering an ace shows its name and a gold ring for its reach. A new ace gets a **field
promotion**: it is healed to full and has +25% HP while it is the ace. Its gold star is drawn at
twice the size of the veteran pips. An ace is a hero worth hunting and a unit worth keeping
alive (the AI pulls its ace home to heal under 40% HP).

### Damage

Damage = weapon damage × the multiplier below for the target's armor class. 0 means the weapon
can't target that class.

| Weapon ↓ / Armor → | Infantry | Light vehicle | Heavy vehicle | Aircraft | Ship | Submarine | Structure |
|---|---|---|---|---|---|---|---|
| Gun (rifles, MGs) | 1.0 | 0.5 | 0.15 | 0 | 0.2 | 0.2 | 0.1 |
| Cannon (tanks) | 0.5 | 1.0 | 1.0 | 0 | 0.7 | 0.4 | 0.5 |
| Rocket | 0.3 | 1.2 | 1.35 | 0 | 0.8 | 0.8 | 0.4 |
| Flak | 0.6 | 0.4 | 0 | 1.5 | 0 | 0 | 0 |
| Shell (artillery, naval guns; splash) | 1.0 | 0.8 | 0.6 | 0 | 1.0 | 1.0 | 1.25 |
| Bomb | 0.8 | 1.0 | 1.0 | 0 | 1.0 | 1.0 | 1.5 |
| Air-to-air missile | 0 | 0 | 0 | 1.5 | 0 | 0 | 0 |
| Torpedo | 0 | 0 | 0 | 0 | 1.5 | 1.0 | 0 |
| Depth charge (destroyers) | 0 | 0 | 0 | 0 | 0 | 1.6 | 0 |

Dug-in infantry take 40% less damage. Units standing in smoke take half damage from range.

**Unit orders:** move, attack, attack-move, stop, hold position, patrol, waypoints (shift), load
and unload (transports), build and repair (Builders), abilities. Units fire automatically at
enemies in range.

---

## 7. Cities

Cities are where the Strategema side of the game lives. They are the main economic engine past the
opening.

- Every map has a level-3 capital in the middle and about 3 neutral cities per player besides the
  two villages near each start, bigger toward the middle.
- **Merchant convoys (our twist):** every coastal city you own sends an unarmed Merchant Ship to
  your nearest Dock every 90 s (a Harbor city every 45 s), up to 4 at sea per player. Each pays
  $150 and 25 oil when it docks; whoever sinks one (a ship, a plane or a coastal gun) takes half.
  The sea gets traffic worth escorting and raiding.
- **Neutral cities keep growing (our twist):** a city nobody owns, other than the home villages
  (within 22 tiles of a start), gains a level every 4 minutes up to level 4 while no army stands
  in it. Waiting buys a richer prize, guarded by a stronger militia.
- **Capture:** only **infantry** capture. Stand inside the city's capture circle (4 tiles for a
  village, a quarter tile more per level up to 5 for a metropolis) with no
  enemy ground units in it. One infantry takes 30 s for a village, +12 s per level; each extra
  infantry (up to 5) adds 40% speed. Enemy ground units in the circle freeze progress; when the
  capturers leave, progress decays.
- **Assault ring:** a group ordered onto a city takes spots around it, at least 2 tiles from the
  middle (0.4 more per level, up to 3.6 for a metropolis, since bigger cities are drawn bigger)
  and inside the capture circle, so the city and the fight stay readable.
- **Home Front (our twist):** every owned city claims the land within 8 + 2 × its level tiles, and
  an HQ within 12. Each tile belongs to the claim it is deepest inside, so borders fall between
  rivals. On your team's ground your units regain 1% of their HP a second: a defender's edge after
  a lost battle. Where two teams' claims meet, the frontier shows as dashed team-colored lines
  over a dark shadow (each side's line just inside its own ground, so both colors show; fainter
  zoomed in); a claim ending in open country has no line. The strategic view tints all claimed land. (Idle infantry digging in at home was tried and is off: dug-in garrisons ignored raids.)
- **Militia (our twist):** every city shoots back. A neutral city shoots only at whoever is
  capturing it; an owned city that isn't in unrest shoots enemy ground units within 5 tiles.
  Damage grows with level (7 at a village, 19 at a megacity, every 1.5 s), so taking a big city
  needs a real squad, and small raids on your cities hurt.
- **A city taken from a player drops one level** (minimum 1) and is in **unrest** for 30 s: no
  income, no militia. Holding cities pays off more than trading them back and forth. (Taking a
  neutral city costs no level and causes no unrest.)
- **Resistance (our twist):** a city taken from a player who is still in the game resists for
  2 minutes. Every 20 s, while the occupier keeps fewer than 2 infantry in the capture ring, a
  partisan Rifleman rises there for the former owner (at most 3). Partisans capture like any
  infantry, so an unguarded conquest can be lost again. Taking back your own city is a
  liberation and doesn't resist you. Conquest needs garrisons, the loser gets play behind the
  lines, and one won battle no longer flips a whole region.
- **City contracts (our twist, a lobby option, on by default):** from 5:00, a city posts a
  public job whenever none is open (2:30 after the last one closed), open for 3 minutes. It is one
  of the three neutral cities most evenly placed between the players still in: the distances to
  their homes may differ by at most a quarter of the average, so no job lands on one player's
  doorstep. Everyone sees it: a gold line in the tracker (click it to look there), a gold label and
  clock under the city (also when zoomed out), a blinking gold frame on the minimap (even under
  fog), a message and a chime; Space jumps the camera there. Three kinds:
  - **Supply (a tender, a real auction):** it takes bids from the moment it is posted, for 90 s.
    A player with a ground unit inside the city's ring, or whose borders (Home Front, §7) reach the
    city, bids (Bid, P). The first bid must be at least 2 minutes of the city's cash income ($180
    for a Village, $600 for a Metropolis); each later bid must top the last by 15%. A bid with less
    than 15 s left pushes the close back to 15 s away, so a last-second snipe can always be
    answered. When it closes, the highest bid that can still pay buys the city, which joins
    peacefully; nobody else pays. While a city takes bids it can't be captured (its militia holds
    fire). AIs within 90 tiles bid up to twice the floor, so a player who wants the city badly can
    outbid them.
  - **Hold** (Villages up to Cities, level 4): the first player to hold the city for 60 s (capture
    it, then keep it) earns $400 plus $100 per level over 1 (+$15 per minute of match time) and 2
    CP, and keeps the city. A change of hands restarts the clock, and a hold under way may run past
    the deadline.
  - **Bounty (liberation):** when no neutral city fits (the map has filled up) and at least three
    teams are still in, a city of a runaway leader (a team whose public score is over 1.3 times the
    average) carries a bounty for 4 minutes (with two teams the leader is already everyone's
    target, and bounties went unclaimed): whoever takes it from them earns $500 (+$15 per minute) and 3 CP, and the city keeps
    the size it had (no level lost to the capture). It's the one nearest the other players on
    average, and never an exiled capital.
  Contracts give a free-for-all a place to fight over, a new player a clear goal, and the late game
  an answer to a snowball. AIs bid on a tender near home, send capture squads to a hold job, and
  prefer a bounty city when picking what to attack.
- **Growth:** cities you own grow while no enemies are in the circle.
- Cities can't be destroyed, only captured. They give sight around them.
- **Level 3+ cities train Riflemen.**
- **Specialties:** at level 2 a city picks one. It keeps it until the city changes hands (the new
  owner picks again). The choice is put in front of the player: a panel at the top left ("Redcliff
  is now a Town! Choose its specialty") lists every specialty with what it does, one click picks
  it (no need to find and select the city; **Show** looks at it), and the city blinks "pick a
  specialty!" on the map until then:

| Specialty | Effect |
|---|---|
| Industrial District | +25% production speed for your buildings within 10 tiles |
| University Town | Double science from this city |
| Fortress City | Heavy guns (replace the militia); capture takes twice as long |
| Market Town | +60% cash from this city, +1 CP/min |
| Harbor | Coastal only. Trains Patrol Boats, +30% cash |

| Level | Name | Cash/s | Science/s | Supply | CP/min | Time to next level |
|---|---|---|---|---|---|---|
| 1 | Village | 1.5 | 0.2 | 4 | 0.25 | 150 s |
| 2 | Town | 2.5 | 0.35 | 8 | 0.5 | 270 s |
| 3 | City | 3.5 | 0.6 | 12 | 0.75 | 420 s |
| 4 | Metropolis | 5 | 0.9 | 16 | 1 | 600 s |
| 5 | Megacity | 7 | 1.3 | 20 | 1.25 | — |

---

## 8. Tech tree and doctrines

- Each player researches separately, from the research panel (F2; no building needed). One tech
  at a time plus a queue. Science flows into the current tech automatically.
- **Four eras.** To enter the next era, research **any 4 techs** of the current one. A tech costs
  200 / 600 / 1,400 / 2,800 science by era, and **each tech you already have from that era makes
  the next one 20% dearer**, so finishing an era is a choice, not a queue. Space Program costs 6,000.
- Techs an ally already knows cost you 25% less.
- Bonuses to the same stat **add up** (two +25% bonuses give +50%), so stacks can't run away.

| Era | Economy & civic | Land | Air | Naval | Science |
|---|---|---|---|---|---|
| **I — Industrial** | Deep Mining (mines +25%) · Oil Refining (derricks +25%) · Urban Planning (growth +25%) | Rocketry (Rocket Trooper) · Fortification (Gun Turret, buildings +25% HP) | Flight (Airfield, Fighter) | Shipbuilding (Dock, Patrol Boat, Transport) | Schooling (city science +50%) |
| **II — Mechanized** | Banking (city cash +25%) · Logistics (+20 supply, production +10%) | Heavy Armor · Artillery · Anti-Air (Flak Trooper, Flak Truck, AA Gun) | Bombers | Naval Doctrine (Destroyer, Coastal Battery) | Radar |
| **III — Modern** | Mass Transit (growth +25%, +4 supply per city) · Industrial Robotics (production +20%) | Composite Armor (vehicles +20% HP) | Rotorcraft (Attack Helicopter) · Jet Engines (aircraft +30% speed) | Submarines · Dreadnoughts (Battleship) | Computing (science +25%) |
| **IV — Future** | Global Markets (cash +20%, better trades) | Precision Guidance (artillery and battleship range +25%) | Advanced Avionics (aircraft +25% HP) | | Satellites (reveal the map 10 s every 90 s) · **Space Program** (Launch Site) |

### Doctrines (our twist)

Entering eras II, III and IV offers three doctrines; you keep one for the match. Two players with
the same techs still play differently. Every doctrine has a **perk** (in bold) that changes how
you play, not just a number:

| Era | Doctrine | Effect |
|---|---|---|
| II | Blitzkrieg | Vehicles 15% faster, +10% damage, **ignore rain**. Buildings −10% HP. |
| II | Entrenchment | **Idle infantry dig in by themselves.** Buildings +30% HP, infantry +15% HP. Vehicles 5% slower. |
| II | Mercantilism | Cities +30% cash, CP +25%, **exchange trades give 30% more**. Units cost 5% more. |
| III | Air Power | Aircraft 20% cheaper and 10% faster, and **fly and fight in storms** |
| III | Mass Production | Production 25% faster, **every 4th unit you train is free**. Vehicles −8% HP |
| III | Scientific Method | All science +25%; **taking a rival's city steals a quarter of their current research** |
| IV | Total War | Infantry and vehicles +15% damage; every unit **heals 15% when it makes a kill**. Science −15% |
| IV | Urbanism | Cities +4 supply, grow 50% faster, capture 50% faster; **level 3+ cities train Rocket Troopers** |
| IV | Networked Warfare | Sight +20%, artillery range +15%, CP +25%; **every power costs 1 CP less** |

---

## 9. Win conditions

The host picks which win conditions are on: conquest is always on (so every match can end), and
supremacy and science can be switched off. By default all three are on. The **victory tracker**
under the top bar shows the cities each team holds and any win that is counting down; hovering it
explains the conditions.

- **Conquest:** be the last team standing. A player is out when they have **neither an HQ nor a
  city of level 2+**. Their units and buildings are removed and their cities go neutral. Allies
  win together.
- **Government in exile (our twist):** when your HQ falls but you own a city of level 2 or more,
  your largest one with no enemy within 10 tiles becomes the **capital** (the government flees the
  attackers; if every such city is under attack, the largest, farthest from them). A crown goes on
  its flag and everyone is told. After 60 s it trains Builders, runs the exchange and pays the HQ's
  Command Points. The capital fights like a fortress, takes 2.5× as long to capture, and raises a
  free partisan Rifleman every 15 s while fewer than 6 are near it. Lose it and the next city takes over; lose them all and you
  are out. A comeback is possible; a crushed player still goes down.
- **Last Stand (our twist):** the mirror image of exile. A player who held cities and has lost
  every one, but still has the HQ, fights at the gates: their supply limit never drops below 40,
  the HQ trains Riflemen and Rocket Troopers, and every 30 s it rallies a free Rifleman while
  fewer than 6 stand within 8 tiles. Retaking any city ends it. Everyone is told when a last stand
  begins, and the HQ's panel says so. The **siege rule** goes with it: from 15:00 (Hard: 8:00,
  Easy: never before its 25:00), the AI's early-raid restraint (§15) no longer protects the base
  of a player in a last stand, so a beaten player can be finished instead of lingering. A player
  who never took a city, or who lost their first cities early, keeps the protection.
- **Insurgency (our twist, a lobby option, on by default):** a player who is out while the match
  goes on keeps fighting. 30 s after the knockout they bank a **squad of 3 partisan Riflemen**,
  and another every 90 s, up to 3 squads. A drop (select a neutral city or one they once held,
  press D) sends every banked squad at once, so a patient insurgent can strike with 9 men. The
  cash they were knocked out with becomes a **war chest**: each squad dropped brings a Rocket
  Trooper too, for $250, while it lasts. A cell lands **hidden** (like a submarine) for 15 s, or
  until it fires: no rival and no militia sees it, so its capture starts unopposed.
  City militia shoots capturers, so one squad takes a Village, and a bigger city needs a bigger
  bank; the city panel and the Drop button say how far the banked squads would get (counting the
  enemy units standing in the ring, which also cancel the hidden head start). The insurgent sees
  their own hidden partisans faded and pulsing until they show. Partisans capture like any infantry (a captured city pays the
  insurgent nothing), and an insurgent who holds a city of level 2+ for **3 minutes** re-founds
  their government there: they are back in the match, governing in exile from that city. That
  comeback happens once a match: a player knocked out a second time is out for good.
  Everyone is told when insurgents start holding a city, and the city shows a "rising" clock, so
  rivals know what to take back. A knocked-out player with no teammate left sees the whole map.
  Insurgents never stop a win: when one team is left in the match, it wins. Knocked-out AIs fight
  on too (they drop where their bank can take a city, or when the bank is full). A knocked-out player can surrender to stop.
- **Supremacy:** a team holds **most of the cities for 4 minutes in a row**: 70% with two teams
  (75% in a team game of 4+ players, where more hands take cities faster), 67% with three, 64%
  with four, 60% with five, 56% with six (with more rivals, a smaller share is already dominant).
  The clock can't start before **15:00**, plus 5 minutes for every team beyond two or 2.5 minutes
  for every player beyond two, whichever is later (a 2v2: 20:00; a 4-way free-for-all: 25:00), so
  the others have time to answer a runaway leader and teams time to coordinate. Everyone
  sees the countdown and gets an alert when it starts. AI players drop other plans to break a
  supremacy run or a launch, and in a free-for-all they gang up on a player whose public score is
  far ahead of the rest.
- **Science:** research Space Program, build a **Launch Site**, and keep it standing through a
  **4-minute countdown**. The launch is announced to everyone. If the site is destroyed, the
  countdown stops.
- **Scrub (our twist):** enemy infantry who hold the ground beside a Launch Site (within 3 tiles of
  its edge) for 10 s, with none of the owner's team's infantry there, push the countdown back 60 s,
  again and again until they are cleared out. Paradrops and landings become the answer to a launch
  across the water; AIs keep 6 infantry beside their own site and paradrop onto a rival's.
- **Coalition (our twist):** when a team starts a supremacy clock or a launch, the rest of the world
  turns on it: everyone else gets +4 CP at once and deals 15% more damage to that team until the
  countdown stops. The tracker shows it. Leaders must win under pressure, and free-for-alls stop
  ending with an unopposed launch.
- **Time limit:** when time runs out, the highest score wins (cities, techs, army value, and
  destroyed enemy value). The default is **Auto**: 45 minutes in a match of 5 or more players or
  on a Continents or Islands map (big free-for-alls and naval maps were stalling past an hour),
  none otherwise; the host can also pick none, 20, 30, 45 or 60 minutes. In the last 10 minutes
  the tracker shows the score race (who wins on time, and your score).
- **Surrender** from the menu. A hopeless AI surrenders too: after 12:00, with no city, no
  living ally and an army worth under a tenth of the strongest enemy's for a minute, it gives up
  instead of making everyone wait out a decided match.

---

## 10. Command Powers, crates and weather

**Command Points** come from the HQ and cities (bank up to 10). Powers (the strip above the
minimap, or Tab for hotkeys):

| Power | CP | Cooldown | Era | Effect |
|---|---|---|---|---|
| Recon Flight | 2 | 30 s | I | Reveal a wide area for 15 s |
| Supply Drop | 3 | 90 s | I | **Lend-lease (our twist):** $300 and 100 oil, plus 60 s of the gap between the richest enemy's cash income and yours, up to $2,500 in all. The leader gets the minimum; whoever is behind gets help catching up |
| Field Repairs | 2 | 45 s | I | Your units and buildings in the area heal 35% |
| Rally Cry | 3 | 60 s | II | Your units in the area: +30% speed, +15% damage for 20 s |
| Artillery Strike | 4 | 75 s | II | 8 shells land in the area after a 3 s warning everyone sees |
| Paradrop | 5 | 90 s | III | 5 Riflemen anywhere you can see |
| Call for Help | 1 | 20 s | I | **Team flare (our twist):** only with allies. A plume of signal smoke that only your team sees, for 30 s, with a message and a minimap ping. Allied AIs answer it: their wave turns to the flare if it is nearer than the wave's target, and most of their idle army marches there. AIs fire it themselves when a raid on their base is worth 1.5× their defenders (at most every 2 minutes) |

**Supply crates** parachute into the open map (mostly the middle) from 2:30, every 70–110 s,
up to 3 at a time. Everyone sees them on the minimap; the first ground unit to touch one takes it:
cash, oil, science (all worth 25% more per minute of match time), 2 CP, or a veteran star.

**Weather and day/night** (can be turned off): a 6-minute day and 2-minute night; night cuts
sight by a third. Rain fronts slow ground units by 15%; storms ground all aircraft.

---

## 11. Game modes and lobby

Up to 6 players. Each slot is a human or an AI (Easy / Normal / Hard, plus a personality), with a
team and a color.

| Preset | Setup |
|---|---|
| 1v1 | You against one Normal AI |
| 2v2 | You and an AI ally (yellow) against two AIs (red, purple) |
| FFA 4 | Four players, every one for themselves |
| Co-op | You and an ally against three Hard AIs |

**Boot Camp** (title screen): the tutorial. A small map picked for ore, oil and a city close to
your start, against an Easy AI. A card shows one step at a time (look around, mine, derrick,
barracks, riflemen, take a city, research, a tank, a Command Power, then "now win"). Each step
names the very next click for what the player has selected and open: with no Builder picked it
points at one, then it lights up the Build button, then the Mine, then arrows the ore. A labelled
arrow marks the spot on the map ("Ore", "Builder", the city's name), or sits at the screen edge
(click it to look there); a blinking frame and arrow mark the HUD button to press, with a word or
two beside it when a window covers the card. Steps done early tick off by themselves, and "Skip"
ends it. When a target is off screen or under the card, the camera goes to it once. Underneath it is an ordinary match (without city contracts, so the
lesson's goals are the only ones on screen). Until Boot Camp has been started
once, its title-screen button is gold and says "new? start here", and a first skirmish is set
against an Easy AI (the setup remembers what the player picks after that).

**First Orders** (any other match, skirmish or online): the same guide, for players who skip
Boot Camp. Six orders for the opening: mine ore, start research (it suggests Deep Mining), take a
city with the starting Riflemen, pump oil, raise a Barracks, build a Factory, then a closing card.
Each says why it matters in a dim line under the instruction. Once finished they never show again
in that browser; "Hide" turns them off for good, and Menu > "First orders" turns them back on.

**Field Guide** (title screen, G): every unit and building with its sprite turning through its
eight facings (infantry walking) in any team colour, its cost, numbers, weapons, ability and what
it beats or is countered by, all read from the data files so it never drifts from the balance. A
building's page shows what it trains; click one to open its page.

**Options:** map type, size, seed (shown, so a good map can be replayed), fog of war (On /
Explored / Off), win conditions, time limit (Auto by default, §9), weather, supply crates, city
contracts, insurgency, starting money. An AI's personality can be **Random** (the default for new
AI seats): it is settled from the seed when the match starts (so every machine and a replay agree),
kept secret, and revealed on the end screen.

**Allies** share vision and can send each other cash and oil (from the match stats window, F3).
They can't control each other's units, and each researches their own techs.

**Online** (peer to peer, no server): the host shares a room code or link. The host's browser
runs the match; clients send commands and receive snapshots.
- If a client drops, a Normal AI takes over their side so the team isn't a player short. If they
  reload the page or reconnect from the same tab, they get their side back. Each tab keeps a
  private rejoin token, so nobody else can claim a seat, and a seat whose player is still
  connected is never handed over.
- If the host leaves, the match ends for everyone.
- The host can pause for everyone.

**After a match** the end screen tells how it went: the key moments (first city, first into
each era, a supremacy clock, a coalition, a launch and its scrubs, an HQ falling, players
knocked out) and the MVP, the unit with the most veteran stars. Offline, **Rematch** plays the
same map and players again and **New map** the same players on a new seed.

**Saving:** one save slot in the browser. The host's match saves itself every minute of game
time, and "Save game" in the menu saves at once. "Continue" on the title screen resumes it as a
single-player match: any other human's seat is played by a Normal AI from then on. A finished
match clears the slot.

---

## 12. Controls

| Input | Action |
|---|---|
| Left click / drag | Select / box-select (boxes prefer army over Builders; Shift adds) |
| Double-click or Ctrl+click a unit | Select all of that type on screen |
| Right click | Smart order: move / attack / load / repair / unload / set rally |
| Shift + right click | Queue a waypoint |
| Q / X / H / P / E (F) / U | Attack-move / stop / hold / patrol / ability (a second ability) / unload |
| Ctrl + 1–9, 1–9 | Set / select a control group (twice: jump the camera to it) |
| , / . | Select the whole army / an idle Builder |
| WASD, arrows, screen edge, middle-drag | Pan the camera (W/A/S/D are never command-card keys) |
| Mouse wheel, + / − | Zoom (whole-number steps eased over a few frames, plus a zoomed-out strategic view; one step per wheel notch, trackpads too) |
| Minimap | Left click jumps the camera, right click gives an order there |
| B | Build menu (with a Builder selected); every button has a hotkey |
| O / L / J (HQ selected) | Exchange: buy oil / sell oil / fund research |
| Tab | Command Powers |
| Space / Home | Jump to the latest alert / to the HQ |
| F1 / F2 / F3 | Help / research / match stats |
| Pause or F9 | Pause |
| Esc | Back out one step, then the menu |

Keys can be rebound. Mouse and keyboard only; touch is out of scope for v1.

---

## 13. Vision and fog of war

- Every unit, building, and city has a sight radius. Tiles are **unexplored** (black), **explored**
  (terrain and the last-seen buildings, dimmed), or **visible**.
- Allies share vision. Aircraft see far. Hills add sight; forests block ground units' line of sight.
- Submarines stay hidden until they fire or a destroyer's sonar finds them.
- **Cities are public landmarks:** an unexplored city still shows a grey map pin and its name over
  the fog (and a grey dot on the minimap), and can be selected; its panel says only that it is
  unexplored (who holds it and how big it is are for scouts to find out). Any public job there
  shows too. The map reads as a set of named places to go from the first second.

---

## 14. Art direction

The main goal is that the game stays readable at scale.

- **32 px tiles, high top-down ¾ view. Integer zoom only**, with no image smoothing and no
  fractional pixel positions on screen. Zoomed far out, the **strategic view** draws units as
  team-colored icons, one shape per class (dot infantry, square vehicle, triangle aircraft, bar
  ship); four or more of one owner's units close together merge into a badge with their count.
  City names and capture bars are drawn above the units, so a fight never hides them.
- **One fixed palette** (Resurrect 64) for all art, with art snapped to it. Terrain uses the
  muted part of the palette so units stand out against it: grass gets sparse dark tufts, not
  bright patches.
- **Team colors** by palette swap: sprites paint team-colored parts with a reserved key ramp
  (palette 44–48), recolored per player. Six default colors are picked for clear separation,
  including for colorblind players; White comes last, so only a player who picks it gets it (it
  sits close to the neutral grey). Ships fly a pennant in their team color; merchant ships add a
  gold trade band under it, so they never read as transports.
- **Facings:** vehicles, aircraft, and ships have 8 directions; infantry have 8 directions and a
  4-frame walk.
- **Telling units apart:** the three infantry types differ by helmet, readable in every team
  color: the Rifleman's is team-colored, the Rocket Trooper's dark olive (with a bulky rocket
  pack), the Flak Trooper's light tan (with yellow goggles). The Heavy Tank is a size larger than
  the Light Tank, with skirts over its tracks and a long barrel with a muzzle brake.
- **Buildings** stand on a small packed-earth footing with a contact shadow, not a big flat pad.
- **Readability rules:** a dark outline on units, selection brackets in the team color, **health
  bars only when hit in the last 3 s, below half, selected, or hovered**. Gun tracers are short
  streaks that travel; smoke stays see-through (dithered pixel cells on the world grid, like the
  fog, with the bars of the units inside drawn on top); debris is earthy and brief. A destroyed vehicle or
  aircraft leaves a burnt hull (its own sprite snapped to the darkest palette shades) that smokes
  for 8 s and fades by 20 s; ships slide under in 5 s. The hull is broken (holes punched through)
  and sits on a scorch mark at 80% opacity, so it never reads as a unit of a dark team. Wrecks are
  render-only and never block anything. City names have a dark outline. Neutral cities' flags,
  names and rings are an earthy taupe that no team uses (they used to be near-white, like the
  White team's). Idle planes circle slowly over the spot they were
  sent to instead of hanging still (render only; helicopters hover), and a plane over ground units
  is drawn at 80% opacity, so a bomber never hides the fight under it.
- **Terrain** is painted pixel by pixel from the tile map (`src/render/painter.ts`), not laid as
  tiles: each terrain's edge follows its tiles but wanders with slow noise, so coasts, forest
  edges and roads curve instead of stepping. Water is shaded by depth (pale shallows, blue, dusky
  deeps) with a foam rim, waves that run up the beach and glints on open water. Higher ground
  shows its south face (¾ view): grass a dirt lip over the beach, hills a shaded slope, mountains a
  cliff, all inside their own tiles so what you see matches where units can walk. Hills are pale,
  dry plateaus with a contour and a shaded south lip (they give sight, so they must read). Grass
  has meadows (lush and dry patches of grass clumps), single blades and wildflowers; dirt roads
  have wheel ruts, a grassy crown, pebbles and tufted edges. Forests are packed with individual
  trees (broadleaf stands and conifer stands, more pines near mountains) that never hang over a
  road or the beach; every mountain cell is solid rock crowded with snowy peaks, so even a thin
  ridge reads as a wall, with a halo of scree on the grass around it. Rich-ore ground is dark earth
  strewn with rocks and glinting ore. Roads run right up to an HQ (tucked one tile under its edge).
- **Farmland** (`src/render/farmland.ts`): each city farms a belt of fields that widens with its
  level (a village a few plots, a metropolis a wide patchwork): wheat, young green crops, rows of
  vegetables, ploughed earth, lavender and pastures, with grass margins and some hedges. A plot is
  only tilled where all of it is plains, so roads and woods cut verges rather than crops.
- **Scenery** (render-only, never blocks): lone trees, bushes, rocks and flowers in meadows;
  sheep and cows in the pastures, hay, carts, wells and beehives between the fields; driftwood,
  palms and rowboats on beaches; reeds and lily pads in calm shallows; stumps, logs and foxes at
  forest edges; and old war relics (wrecks, sandbags, craters) far from towns. Animals turn around
  now and then. Nothing overlaps: each prop's sprite box is checked against the other props, the
  baked trees and peaks, the crops, roads, cities, deposits and buildings (`e2e/overlap.mjs`).
  Nothing humanoid (no scarecrows), so scenery never reads as a unit.
- **Ambience:** faint cloud shadows drift over the map by day (fainter in rain, none at night or
  in the strategic view), and now
  and then a flock of birds crosses the view (gulls over the sea), with shadows below.
- **Cities** look different at each of their 5 levels, so you can read a city's size at a glance.
- **HUD:** resources across the top, the victory tracker under it, the message feed in the middle
  (three lines on a dark plate; repeats are merged), a getting-started checklist for the first
  minutes, powers above the minimap, the command card only when something of yours is selected.
  A unit's train tooltip and selection panel say what it beats, what it can't hit and what
  counters it, worked out from the unit data and the damage table (a cost-for-cost duel estimate,
  `src/ui/counters.ts`), so they never drift from the balance. Home Front borders are drawn on
  land only, and only where rival claims meet.
- **Field Manual:** the first time one of the twists touches you (your first city, a rival's city
  resisting, a coalition, a launch, exile, convoys, a new era, an ally's flare, the first attack
  on your base, weather, a supply crate), a short card explains it. Each shows once per browser;
  "OK" or 25 s closes it (`src/ui/manual.ts`).
- **Sound:** synthesized effects with distance falloff and stereo panning, alert sounds, and
  music that follows the fighting. Contracts ring a bell of their own; losing an HQ, a player
  knocked out, unrest in your city and being outbid have their own sounds, heard wherever the
  camera is.
- **"Under attack" alerts** (message, sound, minimap ping; Space jumps there) fire only when one
  of your buildings is hit, or one of your units standing on your own team's ground is hit by
  another player, at most once per 20-tile area every 20 s: a fight you started in the field
  doesn't nag.

---

## 15. AI opponents

- AIs run on the host and play only through the same **commands** humans use.
- **Fair information:** start spots are public, but an AI only knows about enemy buildings it (or
  its team) has seen, and sends a scout to unchecked starts.
- Layers: economy (build orders from data), expansion (capture squads; sea landings on island
  maps), army (counters what it has seen), attacks (waves that retreat when beaten), defense
  (sends about 1.5× the threat, not everything), research (a path chosen by personality), the
  exchange (buys oil when short, funds research when its army is maxed out), powers.
- Island maps: the AI builds two docks and transports and ferries waves (and expeditions to neutral
  cities) across, shuttling back to load more. A loaded ferry waits (up to 1½ minutes) until there
  are two warships for every ferry at sea. Every boat of a landing uses one beach on the
  target's island, out of range of the enemy guns it knows about. The troops hold the beach until
  60% of the wave is ashore (or 2 minutes pass); its aircraft wait for that moment too. When fewer
  than 30% are left ashore, they fall back to the beach and wait for the next push.
- The AI remembers where it lost a building and doesn't build on a deposit near there for
  2½ minutes (no more rebuilding a derrick under enemy artillery).
- **Fighters stay home** unless there is an air raid: they are anti-air, so they don't join waves
  or answer flares, and the AI only buys extra fighters against enemy bombers (flak handles
  helicopters); otherwise fighters are a tenth of their usual share of its army.
- **Launch guard:** once its own launch site is counting down, the AI keeps a guard of infantry
  beside it, so a lone saboteur can't scrub the launch. Against an enemy launch it sends
  infantry (paradropping them beside the site when it can).
- **Raiders:** idle warships attack enemy merchant ships they can see within reach on the same
  sea. (This rarely fires in practice, since warships are usually busy in waves.)
- **Call for Help:** a heavily outgunned AI whose base is raided fires a flare (at most once
  every two minutes), and allied AIs send part of their army.
- **Early raids:** until 25 min (Easy), 20 min (Normal) or 8 min (Hard) an AI leaves enemy bases
  alone (nothing within 12 tiles of an HQ): it hits outlying mines and derricks first, then other
  buildings and cities, and with nothing else left it goes home. Until 15 min (Hard: 10) a wave takes at most $2,500 / $4,000 / $6,000 of
  army and gets no reinforcements past that. The first attacks hurt instead of ending the game,
  and a player who loses a battle keeps an HQ to rebuild from.
- **Free-for-all sense:** AIs gang up on a runaway leader (public score over 1.5 times the
  average), and before 20:00 they leave a struggling player (under 0.6 times the average) alone.
- **Personalities:** Balanced, Militarist, Expansionist, Scientist, or Random (one of the four,
  from the seed; the default for new AI seats, so matches differ).
- **Difficulty:** Easy (slow decisions, first attack after 15 min, at most 60 supply, slower
  production), Normal (fair), Hard (fast decisions, +15% production speed, +10% income: a
  measured +15% income made Hard win 19 of 24 against Normal, where speed alone won 12 of 28).
- **Big-ticket units:** a producer that picks a unit costing $800 or more (a battleship) that it
  can't pay for yet saves for it (it goes first, and the others leave its price alone) for up to
  2 minutes, so the AI's navy has battleships.
- **Its ace:** an AI pulls its ace home to heal when it drops under 40% HP.
- **Surrender:** see §9.

---

## 16. Out of scope for v1 (possible later)

Touch and mobile controls · ranked matchmaking and accounts · map editor · replays (cheap to add
later, since the simulation is deterministic) · host migration · offshore oil · walls ·
diplomacy between non-allied players.
