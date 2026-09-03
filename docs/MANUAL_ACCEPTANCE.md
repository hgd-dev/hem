# HEM 1.0.0 household acceptance record

Complete this worksheet on the production-shaped deployment after the exact-pinned automated system acceptance is green. Do not mark an item complete unless both intended players actually exercised the behavior in normal non-headless browser sessions.

## Evidence header

- HEM build/version: ____________________
- Exact minecraft-web-client commit (40-char SHA): ________________________________________
- Deployment URL: ____________________
- Game host/VPS identifier: ____________________
- Cloudflare R2 backup stamp used for restore proof: ____________________
- Automated certification completed at: ____________________
- Manual session started at: ____________________
- Manual session ended at: ____________________
- Player 1/operator: ____________________
- Player 2/operator: ____________________

## Launcher, profiles, skins and settings

- [ ] Both players can create or recover their HEM profile and choose their intended display name.
- [ ] Each player uploads a distinct valid PNG skin; Classic and Slim selection work as expected.
- [ ] Both players see the other player's correct custom skin in live gameplay after join/rejoin.
- [ ] The launcher 3D skin preview rotates by drag and shows both Classic/Slim geometry correctly.
- [ ] Game Render Distance persists in HEM Options and affects the next game launch.
- [ ] "Open Controls on next game launch" opens the in-client keybindings screen exactly once.
- [ ] Remap at least one movement/action key, use it successfully in game, leave/rejoin, and verify the binding remains usable.
- [ ] Raw mouse/pointer-lock look works in Chromium without recurring input loss.
- [ ] F3 debug overlay and F5 perspective switching work.
- [ ] UI scaling remains usable at the intended desktop viewport; no essential launcher control is clipped.

## Singleplayer privacy and persistence

- [ ] Player 1 creates a private Singleplayer world and can mine, place, craft and use containers.
- [ ] Player 1 exits and resumes the same Singleplayer world with inventory, location and world edits intact.
- [ ] Player 2 creates an independent Singleplayer world.
- [ ] Player 1 cannot see or join Player 2's private Singleplayer world without an explicit shared-world flow.
- [ ] Closing the only Singleplayer client allows idle shutdown to stop Paper cleanly; relaunch restores the same native Paper world.

## Shared multiplayer lifecycle

- [ ] One player creates a shared Multiplayer world and generates an invite.
- [ ] The second player redeems the invite exactly once and receives permanent membership.
- [ ] Both players can enter the shared world simultaneously and see one another moving in real time.
- [ ] Shared-world membership survives launcher refresh/re-login.
- [ ] Refresh an active game tab and confirm same-tab resume reconnects without exposing or reusing the original launch token.
- [ ] A reconnect lease works only within its bounded lifetime; after a fresh launcher authorization, the previous reconnect lease no longer authenticates.
- [ ] Disconnect/reconnect preserves each player's inventory, position and world state.
- [ ] Both authenticated browsers remain playable simultaneously for at least 60 continuous minutes.

## Core survival and interaction

- [ ] Keyboard movement, mouse look, sprint/sneak and jump work through normal browser controls.
- [ ] Mining and block placement work in survival and are immediately visible to the other player.
- [ ] Hunger, health, fall damage, death and respawn behave normally.
- [ ] Armor and offhand/shield equipment work and are visible to the other player.
- [ ] Player 2x2 crafting and 3x3 crafting-table recipes work.
- [ ] Furnace, chest, barrel and hopper/container interactions work without inventory desync.
- [ ] Ender-chest contents remain private per player.
- [ ] Dropped item pickup works and item entities render.
- [ ] Water and lava updates visibly synchronize.
- [ ] Passive and hostile mobs render, move and interact normally.
- [ ] Melee and ranged combat work; damage, knockback and projectiles visibly synchronize.
- [ ] Experience gain/levels and the player list synchronize normally.

## Commands, technical gameplay and 1.21.5 content

- [ ] A world created with Allow Commands: On accepts normal player commands and command-block use.
- [ ] A world created with Allow Commands: Off does not grant those privileges.
- [ ] Player chat remains synchronized through a sustained conversation longer than 25 messages.
- [ ] Lever/lamp, repeater, piston, hopper and rail/minecart behavior is visible and synchronized.
- [ ] Time and weather changes reach both clients.
- [ ] Mace and Wind Charge appear correctly in inventory/hand and can be exercised without a renderer crash.
- [ ] 1.21.5 Spring to Life plants/items render correctly; Short Dry Grass grows to Tall Dry Grass with bone meal; Brown/Blue Eggs appear correctly.
- [ ] Warm/cold Pig, Cow and Chicken variants render correctly in live gameplay.
- [ ] Representative passive, hostile, aquatic, Nether and End entity families render without recurring fatal errors.

## Dimensions and restart recovery

- [ ] A real Nether portal carries a normal player from Overworld to Nether; destination terrain renders and movement remains usable.
- [ ] Nether return travel works and preserves player state.
- [ ] A real End portal carries a normal player into the End; End terrain/entities render and movement remains usable.
- [ ] Return from the End works through the intended vanilla flow and preserves player state.
- [ ] A graceful full Paper stop/restart preserves shared-world Anvil changes and both players' inventory data.
- [ ] No recurring fatal browser console/page errors occur during the manual session.
- [ ] No Paper crash, watchdog termination or unrecovered proxy/orchestrator failure occurs during the manual session.

## Production R2 disaster-recovery proof

- [ ] Create a cold backup using `infra/backup-r2.sh` against the configured Cloudflare R2 remote.
- [ ] Record the immutable backup stamp in the evidence header above.
- [ ] Restore that stamp on a disposable/copy production-shaped host into an empty HEM world volume using `infra/restore-r2.sh`.
- [ ] Start Paper from the restored volume and verify at least one known world block marker plus both players' expected native inventory/playerdata.
- [ ] Connect normal browser clients to the restored world and verify playability.
- [ ] Exercise restore rollback once with a deliberately invalid test archive and verify the pre-restore world is automatically recovered.

## Final sign-off

Automated exact-pinned acceptance artifact reviewed: [ ] yes

Production R2 restore evidence reviewed: [ ] yes

Player 1 sign-off: ____________________  Date/time: ____________________

Player 2 sign-off: ____________________  Date/time: ____________________

Release operator sign-off: ____________________  Date/time: ____________________

If any required checkbox fails, record the failure in the release issue/log, patch the failing path, rerun the affected automated and manual evidence, and keep the corresponding release blocker OPEN until the retest passes.
