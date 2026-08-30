# HEM 1.21.5 clean-room parity ledger

HEM is a private, browser-native clean-room reproduction. It does **not** redistribute Mojang's client, textures, sounds, music, models, fonts, or other proprietary game assets. The server-side behavioral authority is Paper 1.21.5 where practical; browser presentation/input is implemented with open-source web tooling and original HEM assets.

**Evidence rule:** no subsystem may be marked `PASS` from version metadata alone. It must have an automated system test or a recorded two-browser/manual acceptance result against the pinned HEM build. `PARTIAL` means usable but not behaviorally complete. `TODO` marks a known compatibility gap; roadmap TODOs do not by themselves block the practical HEM 1.0.0 release, whose finite production blockers live in `RELEASE_BLOCKERS.md`. A zero-known-gap ledger is still required before claiming **full 1.21.5 parity**.

## Core world and simulation
- PARTIAL build-time 1.21.5 item/block/entity registries are fully name↔ID round-trip checked and live system acceptance includes modern blockstate sentinels; exhaustive runtime block/state behavior is still unproven
- PARTIAL browser-origin basic block placement is a named live gate; orientation-sensitive placement, replaceability and neighbor-update rules remain
- PARTIAL RC11 live acceptance accelerates random ticks, grows a real wheat crop and requires the browser to observe its age transition; exhaustive scheduled-tick families remain
- PARTIAL chest, furnace and hopper block-entity/container state paths are encoded in live two-browser acceptance; exhaustive block-entity NBT/data-component synchronization remains
- PARTIAL server-authoritative time, rain/clear weather and difficulty are named live gates in RC11; `doDaylightCycle` false/true plus frozen-time semantics are also live-gated, while exhaustive remaining gamerules/day/weather transitions remain
- PARTIAL HEM forwards render distance and RC11 certifies that setting transport plus a healthy rendered section working set; exhaustive spawn-chunk/ticket lifecycle and far-view eviction remain
- PARTIAL RC11 requires native world-border movement constraint, configured border damage, warning-distance/time packet updates and a timed lerp-size update to reach the browser; warning visual rendering and continuously measured moving-border interpolation remain
- PARTIAL HEM validates Java signed-64-bit numeric seeds and forwards text/numeric seeds to Paper; RC11 also verifies Paper `/seed` reports the configured shared-world seed, while exhaustive generation equivalence remains

## World generation and structures
- PARTIAL Paper 1.21.5 owns native Overworld biome/noise/cave/ore/vegetation generation and RC11 adds live `/locate biome` + structure evidence; exhaustive browser-side visual equivalence remains unproven
- PARTIAL Paper 1.21.5 owns native Nether generation and RC11 locates a Nether biome plus fortress/bastion in the live gate; exhaustive browser presentation remains unproven
- PARTIAL Paper 1.21.5 owns native End generation and RC11 requires an End City locate result; island/gateway visual equivalence remains unproven
- PARTIAL native Generate Structures and Normal/Flat/Large Biomes/Amplified Paper presets are exposed at world creation; complete structure rendering/interaction acceptance remains
- PARTIAL RC11 live worldgen acceptance requires a native stronghold plus monument, mansion, mineshaft, desert/jungle temple, swamp hut, igloo, pillager outpost and plains-village discovery; exhaustive visual/interaction coverage remains
- PARTIAL RC11 live worldgen acceptance requires native ancient-city, monument, mansion, trail-ruins and ruined-portal discovery; structure rendering/loot/interaction remains to be exhaustively exercised
- PARTIAL RC11 requires successful native fortress, bastion-remnant and End-city locate results from Paper 1.21.5; exhaustive exploration/loot/rendering remains
- PARTIAL RC11 requires native trial-chamber discovery and already live-gates trial-spawner/vault block states; ominous trial/vault progression remains
- PARTIAL RC11 requires native shipwreck, buried-treasure and cold-ocean-ruin discovery; fossils/configured-feature visual coverage and exhaustive remaining feature behavior remain

## Blocks and interactions
- PARTIAL live acceptance requires rendered chunk-section meshes while Crafter/Trial Spawner/Vault/Copper Bulb states are present; exhaustive block models/collision shapes remain
- PARTIAL RC11 measures real survival browser dig latency with bare hand versus diamond pickaxe and requires the effective tool to be materially faster; haste/fatigue/water/airborne modifiers remain
- PARTIAL browser-origin placement is live-gated and RC11 expands orientation/state families; exhaustive replaceability, face-placement and neighbor-shape edge cases remain
- PARTIAL RC11 live acceptance requires representative door/trapdoor/fence/pane/wall/stair/slab blockstate + property synchronization, including wall side-height/up transitions; exhaustive placement/neighbor/collision behavior remains
- PARTIAL RC11 adds sign/hanging-sign/lectern block-state synchronization plus mandatory browser-origin sign editing, writable-book page persistence and lectern insertion; hanging-sign back text, signing/page UI and lectern paging/comparator edge semantics remain
- PARTIAL RC11 adds bed + fully charged respawn-anchor state synchronization, live-gates valid Overworld bed sleep/death/respawn, and requires a browser-set Nether respawn anchor to become the post-death spawn; charge-depletion, obstruction and remaining sleep/spawn edge behavior remain
- PARTIAL RC11 live acceptance requires scaffolding/ladder state synchronization and real browser climbing on ladders, scaffolding and vines, plus powder-snow sink/support differences with leather boots and soul-sand bubble-column lift; crawl, horizontal currents and exhaustive climb/collision behavior remain
- PARTIAL RC11 live acceptance now requires browser bucket/bottle cauldron level changes and extraction from a ready composter in addition to state synchronization; conduits and exhaustive interaction/recipe rules remain
- PARTIAL RC11 live acceptance adds decorated-pot/chiseled-bookshelf/suspicious-sand state synchronization, browser item insertion into pot/bookshelf storage, and a complete brush-until-sand archaeology cycle; exhaustive loot tables, brush durability and archaeology edge behavior remain
- PARTIAL RC11 adds waxed/exposed copper and copper-grate synchronization plus browser axe scraping and honeycomb waxing; natural oxidation timing and exhaustive copper-family interactions remain
- PARTIAL RC11 adds Crafter state synchronization and a real redstone-triggered 9-iron-nugget→iron-ingot craft/output gate; slot locking, comparator semantics and exhaustive recipe timing remain

## Inventory, items, recipes and data components
- PARTIAL every 1.21.5 item registry entry is build-time round-trip checked; `mc-assets` 0.2.83 must expose the native 1.21.5 item-definition layer including Spring to Life items and every registered spawn egg, while exhaustive live rendering remains
- PARTIAL distinct server-authoritative player inventories, armor slot and offhand equipment are named live gates and persistence is encoded; cursor/creative edge semantics remain
- PARTIAL the pinned upstream client is build-contract checked for its creative-inventory/JEI feature surface; live 1.21.5 search/hotbar-saving acceptance remains
- PARTIAL browser-origin 2x2 player crafting plus a true 3x3 crafting-table recipe are named live gates; recipe-book/full recipe corpus remains
- PARTIAL native furnace plus real smoker/blast-furnace input/fuel/progress/output are live-gated, and taking a seeded furnace recipe result must award browser XP; unusual fuel, recipe-history breadth and furnace-family XP edge cases remain
- PARTIAL RC11 requires smithing, stonecutter, loom, cartography and grindstone UIs to open/close from the real browser; it also completes a native smithing upgrade and grindstone disenchant transaction, while stonecutter/loom/cartography result semantics and exhaustive recipes remain
- PARTIAL RC11 requires a browser enchanting-table choice to persist an enchantment and consume XP, plus anvil rename/XP-cost and damaged-sword repair/combining transactions; lapis edge rules and exhaustive enchantment/anvil semantics remain
- PARTIAL RC11 requires browser brewing-stand transactions to produce an awkward potion and separately requires browser drinking of Swiftness followed by milk clearing active effects; exhaustive potion recipes, fuel and timing semantics remain
- PARTIAL per-player ender-chest isolation and live shulker-box contents are named gates; RC11 also requires browser inventory clicks to store apples in the native bundle component, while bundle selection/removal/capacity edge behavior remains
- PARTIAL RC11 live acceptance requires a real survival dig to increase a diamond pickaxe damage value; Unbreaking/Mending probabilities and repair interactions remain
- PARTIAL RC11 requires filled-map/compass/clock/recovery-compass modern item/component paths to reach the browser; lodestone binding, map rendering and navigation semantics remain
- PARTIAL RC11 makes the browser `writeBook` path mandatory, verifies page text persisted in Paper player data and then inserts that written book into a lectern; signing/page UI and written-book completeness remain

## Combat and movement
- PARTIAL browser-origin forward movement, normal W-key input and second-browser remote movement are live-gated; RC11 measures sprint/sneak speed differences, deep-water swimming and soul-sand bubble-column lift, while crawl/horizontal-current and exhaustive movement physics remain
- PARTIAL browser-origin jump, one-block obstacle traversal and server-authoritative vertical fall are named live gates; RC11 also requires ladder/scaffolding/vine climbing and powder-snow sink/support semantics, while exhaustive step/crawl/collision physics remain
- PARTIAL RC11 equips elytra through the browser, calls the normal Mineflayer elytra-flight API from a real fall, and uses a firework rocket while airborne; exhaustive boost physics/durability/collision/animation remain
- PARTIAL survival damage plus horizontal knockback are mandatory live gates; RC11 also measures rapid-hit attack-cooldown scaling and falling critical-hit damage, while sprint-reset/sweeping and exhaustive combat timing remain
- PARTIAL RC11 compares naked versus diamond armor, then plain diamond versus Protection IV under matched damage; frontal shield reduction and rear-angle bypass are also live-gated, while toughness, Thorns and exhaustive shield timing remain
- PARTIAL RC11 requires arrow/trident/snowball synchronization, browser-origin bow firing, both 1.21.5 egg throws, airborne firework use and a browser-thrown Ender Pearl; exhaustive teleport/projectile collision/damage behavior remains
- PARTIAL RC11 forces a falling browser player to equip and attack with a mace through the normal combat path; smash scaling plus Density/Breach/Wind Burst semantics remain
- PARTIAL RC11 requires browser-origin wind-charge item use to spawn a synchronized wind-charge projectile; knockback/explosion/breeze-specific edge behavior remains
- PARTIAL RC11 requires browser-origin bow draw/release plus Mace and Wind Charge use paths; exhaustive ranged collision/damage, Mace enchant semantics and Wind Charge knockback/explosion edge behavior remain
- PARTIAL RC11 adds browser status-effect synchronization, browser potion→milk effect lifecycle and a browser-origin Fire Aspect sword hit that must ignite its target; sweeping, Thorns and exhaustive effect/enchantment edge behavior remain
- PARTIAL server-authoritative fall damage plus fire/drowning/freezing/suffocation/lava/void damage types are named live gates; resistance/armor/environmental edge cases remain
- PARTIAL RC11 requires hunger depletion, browser food consumption, browser-observed death/client respawn, actual default inventory death drops, bed/respawn-anchor spawn placement and a browser-equipped Totem preventing lethal damage; starvation timing, death messages and remaining spawn-point edges remain

## Redstone and technical gameplay
- PARTIAL RC11 requires Paper redstone-dust power-level propagation and downstream lamp power/depower synchronization; complex dust topology, attenuation and update-order edge cases remain
- PARTIAL repeater/comparator powered state, browser-pressed buttons, pressure plates and lamp propagation are named live gates; RC11 also requires rapid redstone-torch burnout plus recovery, while exhaustive update-order edge cases remain
- PARTIAL RC11 adds observer/target/calibrated-sculk-sensor state synchronization and requires an observer pulse plus browser-fired target-block analog redstone output; calibrated-vibration filtering and exhaustive event/update ordering remain
- PARTIAL native piston movement + cross-browser moved-block synchronization is live-gated and RC11 adds sticky-piston extension/retraction through a slime-block attachment; honey/flying-machine/update-order edge cases remain
- PARTIAL RC11 adds slime/honey state synchronization beside piston acceptance; attachment propagation and flying-machine edge cases remain
- PARTIAL RC11 live-gates dispenser projectile output, dropper item output and a dispenser water-bucket source/empty-bucket transition; remaining item-specific dispenser effects and inventory timing edge cases remain
- PARTIAL hopper→chest transfer and container synchronization are in the live system gate; full transfer timing/edge cases remain
- PARTIAL RC11 live acceptance requires powered/detector rail states, minecart synchronization and powered activator-rail rider ejection; complete cart momentum/collision/item-specific activator behavior remains
- PARTIAL lever-driven lamps, browser-pressed buttons/player pressure plates, daylight-detector inversion and a browser-triggered tripwire hook are live-gated; exhaustive analog/update-order behavior remains
- PARTIAL RC11 adds a Java-only quasi-connectivity fixture where a redstone torch two blocks above activates a piston and moves its block; BUD/update-order and exhaustive Java redstone edge cases remain
- PARTIAL RC11 requires a Crafter to trigger under real redstone power and emit an iron ingot from a loaded 9-nugget recipe; slot locking, recipe-selection edges, output timing and comparator semantics remain

## Entities and mobs
- PARTIAL the complete 1.21.5 entity registry is build-time name↔ID round-trip checked; RC11 named live gates include villager, armor stand, breeze, warden, blaze, enderman and shulker synchronization plus 1.21.5 sentinels, while exhaustive metadata/attributes/AI remain
- PARTIAL browser-origin dropped-item entity synchronization is live-gated and RC11 requires a real world XP orb pickup to increase browser experience; exhaustive item-pickup attraction/timing and XP-orb merging physics remain
- PARTIAL armor stands are already synchronized and RC11 adds painting + item/text display entity gates; exhaustive metadata/poses/item-frame/display transforms remain
- PARTIAL RC11 expanded entity-family gates include cow/wolf synchronization, browser-fed cow breeding that creates a baby and browser-fed wolf taming with server-owned UUID verification; broader breeding/taming rules, AI, attributes and interactions remain
- PARTIAL RC11 includes a survival zombie encounter and requires hostile pathfinding/attack damage to reach the browser; exhaustive mob-specific AI remains
- PARTIAL RC11 summons a professioned villager with a native offer, opens the merchant through the browser and completes an emerald→bread trade; POIs/gossip/breeding/raids and exhaustive economics remain
- PARTIAL RC11 expanded entity-family gates include iron/snow golem synchronization plus browser placement of the final carved pumpkin to construct each golem; targeting and AI behavior remain
- PARTIAL RC11 expanded entity-family gates include dolphin and guardian synchronization; elder guardians, swimming AI and aquatic behaviors remain
- PARTIAL RC11 expanded entity-family gates include blaze, wither skeleton and piglin synchronization; exhaustive Nether mob models/AI/behavior remain
- PARTIAL RC11 entity-family gates include enderman, shulker and endermite synchronization; exhaustive End AI/teleport/projectile behavior remains
- PARTIAL Warden entity synchronization is already gated and RC11 requires browser movement to activate a sculk sensor vibration state; shriekers/summoning/anger/sonic-boom and full ecosystem behavior remain
- PARTIAL modern entity protocol coverage is guarded by the complete registry check; exhaustive AI/model/behavior acceptance remains
- PARTIAL native 1.21.5 Spring to Life warm/cold Pig, Cow and Chicken variant data are mandatory live synchronization sentinels; climate-based spawning, Sheep wool-color ecology and exhaustive variant models/behavior remain
- PARTIAL RC11 requires a killed mob to create a synchronized dropped-item entity; exhaustive loot tables, equipment chances and death behavior remain

## Bosses and progression
- PARTIAL RC11 adds live Ender Dragon synchronization and requires native dragon-fight death state to generate the End exit-fountain portal; End Gateway teleport is separately live-gated, while crystal destruction, browser boss combat and fight-reset edge cases remain
- PARTIAL RC11 adds live Wither synchronization and browser placement of the final Wither skull on a valid soul-sand structure to spawn it; boss AI/combat, charging, destruction and drops remain
- PARTIAL RC11 grants a native advancement and requires an advancement protocol packet at the browser; exhaustive criteria/triggers/UI remain
- PARTIAL RC11 requires a native statistics protocol packet to reach the browser; exhaustive stat counters/UI/persistence remain
- PARTIAL RC11 requires server-authoritative experience-level synchronization/reset and a real world `experience_orb` pickup that increases browser XP points; level curves and enchanting progression remain
- PARTIAL RC11 uses the native recipe command and requires recipe-unlock protocol synchronization; exhaustive recipe-book knowledge/discovery UI remains

## Dimensions and portals
- PARTIAL RC11 requires browser flint-and-steel ignition of a valid Nether frame plus native player entry into the Nether; destination search/creation, return travel and exhaustive 8:1 coordinate-scaling behavior remain
- PARTIAL RC11 requires native player entry through an End portal block into the End; frame/eye activation, stronghold integration and return/dragon-fight behavior remain
- PARTIAL RC11 requires the dragon-created native End exit portal to return the browser to the Overworld and separately live-gates deterministic End Gateway teleportation; Nether destination/search/return edge cases remain
- PARTIAL RC11 browser-interacts with a Nether bed and Overworld charged respawn anchor for native explosions, requires valid Overworld bed sleep/death respawn, and requires valid Nether respawn-anchor spawn/death/client-respawn semantics; obstruction, charge-depletion and remaining spawn edges remain
- PARTIAL RC11 keeps the renderer alive across all three dimensions, forwards sky/day settings and adds HEM procedural feedback; exhaustive per-dimension sky/fog/audio equivalence remains

## Commands, chat and multiplayer protocol
- PARTIAL RC11 requires browser tab-completion for `/gi` to include `/give`; exhaustive Brigadier tree rendering, argument suggestions and tooltips remain
- PARTIAL per-world Allow Commands now reaches Paper and grants the authenticated player command permission; full vanilla command tree/argument UX still requires live acceptance
- PARTIAL 25-message client-origin chat stability plus 1.21.5 inline-SNBT title/action-bar/boss-bar command delivery are mandatory live gates; exhaustive visual styling/timing and system-message presentation remain
- PARTIAL the known-risk 1.21.5 chat acknowledgement path is gated by a 25-message browser-origin soak; exhaustive signed-chat edge cases remain
- PARTIAL RC11 requires both browsers to expose the other player and now requires scoreboard objective/sidebar plus team membership to materialize in Mineflayer client state, not merely packet names; exhaustive HUD rendering/style semantics remain
- PARTIAL isolated per-world op/command permission path is implemented; multiplayer permission edge cases remain to be accepted
- PARTIAL command blocks are enabled/disabled with the HEM world setting and RC11 requires browser command-block editing/redstone execution plus a command-block minecart executing on a powered activator rail; exhaustive modes/conditions/output remain
- PARTIAL RC11 records native playerJoined/playerLeft browser events and requires a real second-browser leave/rejoin cycle; visible death/advancement/system-message presentation remains
- PARTIAL two-browser remote entities/movement/jump/swim/climb, block updates/mining, distinct inventories + armor/offhand, containers/furnaces/crafting/fluids/redstone and native minecart + oak-boat control are named System Acceptance gates; live green evidence is still required
- PARTIAL refresh recovery and an actual Docker proxy stop/start with same-tab resume are mandatory in System Acceptance; arbitrary long network failures/new-browser recovery remain

## Containers and UI
- PARTIAL native chest open/deposit/shared-content plus barrel/trapped-chest contents and a true paired 54-slot double chest are named live gates; locking, double-chest redstone and edge cases remain
- PARTIAL hopper→chest transfer/container state plus dropper output, dispenser projectile output and dispenser water-bucket behavior are live-gated; exhaustive item-specific effects and transfer timing edge cases remain
- PARTIAL native furnace, smoker and blast-furnace processing are live-gated and RC11 requires taking a furnace result to award browser XP; unusual-fuel and recipe-history edge cases remain
- PARTIAL RC11 requires each corresponding workstation UI to open in the browser; complete modern container state/result semantics remain
- PARTIAL RC11 requires the beacon browser window, a valid iron pyramid/payment transaction and the native `set_beacon_effect` path to apply Speed to the browser player; multi-tier range/secondary-effect and obstruction edge semantics remain
- PARTIAL RC11 requires the browser to open a native villager merchant and complete a real trade; all merchant window edge cases and restocking remain
- PARTIAL RC11 opens horse and chested-llama entity inventory windows and requires a browser-deposited apple to persist in the chested llama inventory; saddle/armor/carpet/capacity/breeding/riding edge cases remain
- PARTIAL RC11 adds native recipe-unlock packet acceptance, modern item/component inventory paths and broad workstation window coverage; exhaustive recipe-book UI and every modern container state/data component remain

## Rendering and presentation
- PARTIAL HEM now refuses release unless live renderer chunk-section meshes exist while modern Crafter/Trial Spawner/Vault/Copper Bulb blockstates are loaded; exhaustive models remain
- PARTIAL the build pins `mc-assets` 0.2.83 and rejects a missing native 1.21.5 item-definition layer or missing Spring to Life item definitions; live exhaustive GUI/hand/world item rendering remains
- PARTIAL RC11 retains broad entity/equipment synchronization and adds a rendered-canvas smoke gate across dimensions; exhaustive model/pose/equipment-layer visual comparison remains
- PARTIAL the pinned client capability contract includes perspective support and RC11 adds broader FOV/bobbing settings plus rendered-frame acceptance; exhaustive first/third-person animation equivalence remains
- PARTIAL the browser renderer is exercised under live gameplay and RC11 adds rendered-frame/presentation acceptance; exhaustive particle-family visual equivalence remains
- PARTIAL RC11 forwards a sky/day-cycle setting and already live-gates time/rain/clear transitions while requiring healthy rendered frames; exhaustive celestial/cloud/snow appearance remains
- PARTIAL native 1.21.5 biome generation plus the live renderer path are now gated; exhaustive biome-color visual comparison remains
- PARTIAL RC11 forwards smooth-lighting and requires live rendered sections; exhaustive block-light/skylight/emissive pixel equivalence remains
- PARTIAL water/lava synchronization is already live-gated and RC11 keeps a healthy rendered canvas through dimension/visual smoke; exhaustive transparency/sorting/flow rendering remains
- PARTIAL RC11 requires a healthy renderer across Overworld/Nether/End transitions; exhaustive fog/color/distance equivalence remains
- PARTIAL RC11 implements an original HEM damage vignette triggered by real health loss; fire/freezing overlays and exact vanilla visual equivalence remain
- PARTIAL RC11 adds sign/hanging-sign block synchronization and broad player/entity rendering; text editing, nametag/bossbar/scoreboard visual equivalence remains
- PARTIAL RC11 adds an original procedural WebAudio feedback layer honoring master-volume settings; exhaustive HEM-original gameplay sound coverage remains

## Input and settings
- PARTIAL browser-origin movement/jump/one-block obstacle traversal/mining/placing/post-placement renderer stability/attacking are live-gated and the upstream feature contract checks input support; exhaustive keyboard/mouse parity remains
- PARTIAL RC11 build-contract checks the upstream keybinding feature and HEM Options can request the in-client keybinding panel on the next launch; live remap/persistence acceptance remains
- PARTIAL RC11 build-contract checks upstream raw-input/pointer-lock support; live browser/platform acceptance remains
- PARTIAL RC11 build-contract checks upstream debug-overlay and third-person/perspective feature signals; exhaustive F-key/screenshot/debug behavior remains
- PARTIAL RC11 requires command tab-completion and the bridge keeps a bounded recent-message history for HEM diagnostics; full visible history UX/search/editing remains
- PARTIAL RC11 HEM Options persist menu UI scale and game render distance and forward `setting=renderDistance:<n>` at launch; FOV/sensitivity and exhaustive in-client video settings remain
- PARTIAL RC11 adds persistent master/music volume controls forwarded into the browser client; HEM-original complete sound-event coverage and subtitles remain
- PARTIAL RC11 adds persistent high-contrast and reduced-motion controls plus raw-input/sensitivity/FOV settings; broader keyboard/screen-reader/subtitle accessibility remains

## HEM launcher/profile layer
- PASS private household registration and recoverable device identity
- PASS separate Singleplayer and Multiplayer world lists
- PASS private shared-world invitations and permanent membership
- PASS Minecraft-style HEM title/menu flow with original HEM styling
- PASS persistent display name separate from immutable private game-login ID
- PASS custom 64x64/legacy 64x32 PNG skin upload validation and Classic/Slim profile selection
- PARTIAL custom HEM skin is injected into the authenticated Paper `textures` profile with Classic/Slim metadata and re-announced after auth; RC11 now requires reciprocal remote skin fetches in the live two-browser gate, but that gate has not been executable in this sandbox
- PARTIAL RC11 implements a dependency-free WebGL Classic/Slim 3D launcher preview with base + outer layers, drag rotation, 64x64 upload and correct legacy 64x32→Classic normalization; a dedicated Playwright certificate gate is encoded but has not run in this sandbox, and in-game reciprocal skin acceptance remains separately live-gated

## Persistence and reliability
- PASS each server-backed HEM world uses a separate native Paper world directory
- PASS pinned Paper 1.21.5 build/checksum contract
- PASS graceful save-all/stop backup path
- PASS private world membership/launch-token contract
- PARTIAL 60-minute two-browser browser/session/renderer soak is now mandatory on main/manual System Acceptance runs (5-minute PR smoke); live green evidence is still required
- PARTIAL forced active-Paper `SIGKILL` recovery is now in System Acceptance and verifies saved block + both player inventories after restart; live green evidence is still required
- PARTIAL browser refresh/reconnect uses a rotating five-minute one-use `hem:session` lease; System Acceptance now also stops/restarts the real proxy and requires both same tabs to recover through fresh resume leases, but live green evidence is still required
- PARTIAL R2 backup checksum + remote `rclone check` + guarded restore/automatic rollback helper are implemented; RC11 adds a deterministic Docker+rclone-local system drill proving good restore, post-backup mutation replacement and rollback after an invalid destructive restore, but a real disposable clean-host Cloudflare R2 transport drill is still required

## Certification/reproducibility
- PASS local source contracts require protocol 770, complete registry round-trips, `mc-assets` 0.2.83 modern item definitions, one-use launch/resume credentials, crash-recovery hooks, executable backup/restore rollback safeguards and the 60-minute system-soak definition
- PARTIAL System Acceptance records named gameplay gates in `hem-1215-certification.json` and separate launcher/restore certificates; `scripts/verify-certification.mjs` rejects missing gates, missing WebGL Classic/Slim/legacy proof, missing restore+rollback proof, inadequate soak or an unpinned final upstream ref. This sandbox cannot produce a live PASS certificate
- PASS production Cloudflare deployment refuses a moving browser-client branch/tag and requires `MWC_REF` to equal an exact 40-character upstream commit SHA

## 1.0 release gate

HEM may only be called **full 1.21.5 parity** when every `TODO` above is either `PASS` or explicitly documented as impossible in a browser with a user-approved exception. A server being Paper 1.21.5 is necessary but does not prove browser-client parity.
