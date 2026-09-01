import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const read=p=>fs.readFileSync(path.join(root,p),'utf8')
const currentVersion=JSON.parse(read('package.json')).version
const versionPattern=new RegExp(currentVersion.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))

test('Paper authority is reproducibly pinned to 1.21.5 build 114',()=>{
  const s=read('apps/orchestrator/server.mjs')
  assert.match(s,/PAPER_VERSION[^\n]+['"]1\.21\.5['"]/)
  assert.match(s,/PAPER_BUILD[^\n]+['"]114['"]/)
  assert.match(s,/2ae6ae22adf417699746e0f89fc2ef6cb6ee050a5f6608cee58f0535d60b509e/)
  assert.match(s,/Paper checksum mismatch/)
  assert.match(read('apps/server-plugin/build.gradle.kts'),/paper-api:1\.21\.5-R0\.1-SNAPSHOT/)
  assert.match(read('apps/server-plugin/src/main/resources/plugin.yml'),/api-version:\s*['"]?1\.21\.5/)
})

test('each HEM world is a separate native Paper directory',()=>{
  const s=read('apps/orchestrator/server.mjs')
  const config=read('apps/orchestrator/world-config.mjs')
  assert.match(s,/path\.join\(ROOT,id\)/)
  assert.match(config,/'level-name':'world'/)
  assert.doesNotMatch(s,/Multiverse/i)
})

test('Paper is offline-mode only behind HEM one-time gate',()=>{
  assert.match(read('apps/orchestrator/world-config.mjs'),/'online-mode':'false'/)
  const p=read('apps/server-plugin/src/main/java/com/hemcraft/gate/HEMGatePlugin.java')
  assert.match(p,/consume-launch/); assert.match(p,/auth-timeout-seconds/); assert.match(p,/authenticated/)
})

test('client build targets modern 1.21.5 data and enables auto connect',()=>{
  const b=read('apps/client/build-client.mjs')
  assert.match(b,/require\('minecraft-data'\)\('1\.21\.5'\)/)
  assert.match(b,/--frozen-lockfile/)
  assert.match(b,/supportedVersions\.mjs/)
  assert.match(b,/\['1\.21\.5'\]/)
  assert.match(b,/allowAutoConnect\s*=\s*true/)
})

test('launch token is never placed in query string',()=>{
  const l=read('apps/hub/src/lib.mjs'); assert.match(l,/url\.hash/); assert.doesNotMatch(l,/searchParams\.set\(['"]hemToken/)
})

test('proxy is destination allowlisted to orchestrator ports',()=>{
  const p=read('apps/proxy/server.cjs'); assert.match(p,/to:destinations/); assert.match(p,/host:HOST,port:START\+i/)
})

test('hub UI exposes separate Singleplayer and Multiplayer lists',()=>{
  const h=read('apps/hub/public/index.html'); assert.match(h,/>Singleplayer</); assert.match(h,/>Multiplayer</); assert.match(h,/HEM/)
})

test('shared invitations become permanent memberships',()=>{
  const w=read('apps/hub/src/worker.mjs'); assert.match(w,/INSERT OR IGNORE INTO memberships/); assert.match(w,/createInvite/); assert.match(w,/redeemInvite/)
})

test('production compose does not publish raw Paper world ports',()=>{
  const y=read('infra/docker-compose.yml'); assert.match(y,/31000-31099/); assert.doesNotMatch(y,/31000:31000/)
})

test('production volumes do not hide orchestrator application files',()=>{
  const y=read('infra/docker-compose.yml'); assert.doesNotMatch(y,/hem-paper-cache:\/opt\/hem/); assert.match(y,/PAPER_JAR: \/cache\/paper\.jar/)
})

test('offsite backup takes a graceful cold world snapshot',()=>{
  const b=read('infra/backup-r2.sh')
  assert.match(b,/docker compose stop -t 60 orchestrator/)
  assert.match(b,/rclone copy/)
  assert.match(b,/sha256sum/)
  const o=read('apps/orchestrator/server.mjs')
  assert.match(o,/save-all flush/)
  assert.match(o,/stop\\n/)
  assert.match(o,/45_000/)
})



test('multiplayer presence accounting is idempotent under reordered join/quit delivery',()=>{
  const o=read('apps/orchestrator/server.mjs')
  assert.match(o,/presenceClock/)
  assert.match(o,/at>=previous\.at/)
  assert.match(o,/filter\(x=>x\.connected\)\.length/)
  const p=read('apps/server-plugin/src/main/java/com/hemcraft/gate/HEMGatePlugin.java')
  assert.match(p,/System\.currentTimeMillis\(\)/)
  assert.match(p,/postPresence\(player, true\)/)
  assert.match(p,/postPresence\(e\.getPlayer\(\), false\)/)
})

test('1.21.5 removes the post-1.21.5 physics scale shim while retaining live movement/combat gates',()=>{
  const p=read('apps/server-plugin/src/main/java/com/hemcraft/gate/HEMGatePlugin.java')
  assert.doesNotMatch(p,/minecraft:scale base set/)
  assert.doesNotMatch(read('apps/server-plugin/src/main/resources/config.yml'),/physics-scale-workaround/)
  const system=read('tests/system/browser-1215.mjs')
  assert.match(system,/horizontal knockback physics/)
  assert.match(system,/one-block obstacle/)
})

test('public HEM hub ships restrictive browser security headers',()=>{
  const h=read('apps/hub/public/_headers')
  assert.match(h,/Content-Security-Policy:/)
  assert.match(h,/frame-ancestors 'none'/)
  assert.match(h,/Referrer-Policy:\s*no-referrer/)
})


test('production deployment renders config, applies D1 migration, installs secrets and health-checks',()=>{
  const y=read('.github/workflows/deploy-cloudflare.yml')
  assert.match(y,/render-cloudflare-config\.mjs/)
  assert.match(y,/preflight:production/)
  assert.match(y,/d1 migrations apply hem --remote/)
  assert.match(y,/secret put/)
  assert.match(y,/\/api\/health/)
})

test('game host has a mandatory deployment preflight',()=>{
  const s=read('infra/preflight.sh')
  assert.match(s,/Docker Compose/)
  assert.match(s,/ACCEPT_MINECRAFT_EULA/)
  assert.match(s,/ORCHESTRATOR_KEY must be >=32/)
  assert.match(s,/SERVER_SERVICE_KEY must be >=32/)
})

test('system gate proves real-time two-browser 1.21.5 gameplay and known physics risk',()=>{
  const s=read('tests/system/browser-1215.mjs')
  assert.match(s,/real-time remote movement/)
  assert.match(s,/client-originated mining synchronization/)
  assert.match(s,/client-originated block placement synchronization/)
  assert.match(s,/horizontal knockback physics/)
  assert.match(s,/firefly_bush/)
  assert.match(s,/brown_egg/)
  assert.match(s,/Short Dry Grass/)
  assert.match(s,/variant:/)
  assert.match(s,/25-message chat acknowledgement soak/)
  assert.match(s,/the_nether/)
  assert.match(s,/the_end/)
})

test('system gate proves shared player persistence and isolated singleplayer persistence',()=>{
  const s=read('tests/system/browser-1215.mjs')
  assert.match(s,/Hudson inventory persistence/)
  assert.match(s,/Elise inventory persistence/)
  assert.match(s,/Singleplayer playerdata leaked from shared world/)
  assert.match(s,/solo inventory persistence after Paper restart/)
  assert.match(s,/solo Anvil persistence after Paper restart/)
})

test('HEM profile layer supports custom names and PNG skin model metadata', () => {
  const html = fs.readFileSync('apps/hub/public/index.html','utf8')
  const app = fs.readFileSync('apps/hub/public/app.js','utf8')
  const preview = fs.readFileSync('apps/hub/public/skin-preview-3d.js','utf8')
  const migration = fs.readFileSync('apps/hub/migrations/0002_profiles.sql','utf8')
  const worker = fs.readFileSync('apps/hub/src/worker.mjs','utf8')
  assert.match(html, /regSkinPreview/)
  assert.match(html, /profileSkinPreview/)
  assert.match(app, /Slim/)
  assert.match(app, /64×64/)
  assert.match(app, /normalizeLegacySkin/)
  assert.match(app, /Legacy 64×32 skin normalized/)
  assert.match(app, /skinModel/)
  assert.match(app, /renderSkinPreview3D/)
  assert.match(preview, /getContext\('webgl'/)
  assert.match(preview, /model === 'slim'/)
  assert.match(preview, /outer|overlay/i)
  assert.match(preview, /pointermove/)
  assert.match(preview, /__hemPreviewDragCount/)
  assert.match(preview, /faceMap\(48,48,armW,12,4\)/)
  assert.match(migration, /skin_model/)
  assert.match(migration, /skin_png/)
  assert.match(worker, /PUT.*\/api\/me\/profile/)
  assert.match(worker, /api\\\/skins|api\/skins|skins/)
})


test('launcher WebGL skin preview has an executable Playwright acceptance gate',()=>{
  const system=read('.github/workflows/system-1215.yml')
  const launcher=read('tests/system/launcher-3d.mjs')
  const staticHub=read('tests/system/static-hub.mjs')
  const verifier=read('scripts/verify-certification.mjs')
  assert.match(system,/Verify interactive Classic\/Slim 3D launcher skin preview/)
  assert.match(system,/tests\/system\/launcher-3d\.mjs/)
  assert.match(launcher,/dataset\.preview === 'webgl-3d'/)
  assert.match(launcher,/setInputFiles\('#regSkin'/)
  assert.match(launcher,/toggle-reg-skin-model/)
  assert.match(launcher,/dragRotate/)
  assert.match(launcher,/dragCountAfter > dragCountBefore/)
  assert.match(launcher,/legacy\.png/)
  assert.match(launcher,/legacyNormalized/)
  assert.match(launcher,/settingsPersisted/)
  assert.match(launcher,/hem-launcher-certification\.json/)
  assert.match(staticHub,/apps\/hub\/public/)
  assert.match(verifier,/hem-launcher-certification\.json/)
  assert.match(verifier,/Launcher 3D certification is incomplete/)
  assert.match(verifier,/settingsPersisted/)
  assert.ok(fs.existsSync(path.join(root,'tests/system/skins/legacy.png')))
})

test('parity ledger blocks a false full-1.21.5 claim until every subsystem is accepted', () => {
  const parity = fs.readFileSync('docs/PARITY_1_21_5.md','utf8')
  for (const required of ['Redstone and technical gameplay','Combat and movement','Entities and mobs','World generation and structures','Commands, chat and multiplayer protocol','Rendering and presentation','Containers and UI','Dimensions and portals']) {
    assert.ok(parity.includes(required), `missing parity subsystem: ${required}`)
  }
  assert.match(parity, /may only be called \*\*full 1\.21\.5 parity\*\*/)
})


test('custom HEM skins propagate through Paper player profile textures',()=>{
  const w=read('apps/hub/src/worker.mjs')
  const p=read('apps/server-plugin/src/main/java/com/hemcraft/gate/HEMGatePlugin.java')
  assert.match(w,/skin_model,i\.skin_png,i\.profile_updated_at|skin_model,skin_png|i\.skin_model,i\.skin_png,i\.profile_updated_at/)
  assert.match(w,/access-control-allow-origin/)
  assert.match(w,/OK\\t\$\{safeName\}\\t\$\{skinModel\}\\t\$\{skinUrl\}/)
  assert.match(p,/ProfileProperty\("textures"/)
  assert.match(p,/player\.setPlayerProfile\(profile\)/)
  assert.match(p,/metadata.*model.*slim/)
})

test('client build rejects stale registries before bundling',()=>{
  const b=read('apps/client/build-client.mjs')
  assert.match(b,/minecraft-data'\)\('1\.21\.5'\)/)
  for (const name of ['mace','wind_charge','brown_egg','blue_egg','firefly_bush','leaf_litter','wildflowers','short_dry_grass','tall_dry_grass','cactus_flower','trial_spawner','vault']) assert.ok(b.includes(name), `missing registry sentinel ${name}`)
  assert.match(b,/minecraftRenderer: dependencyVersion\('minecraft-renderer'/)
  assert.match(b,/minecraftInventory: dependencyVersion\('minecraft-inventory'/)
  assert.match(b,/mineflayerConnector: dependencyVersion\('mcraft-fun-mineflayer'/)
  assert.match(b,/roundTrip\(mcData\.itemsArray/)
  assert.match(b,/roundTrip\(mcData\.blocksArray/)
  assert.match(b,/roundTrip\(mcData\.entitiesArray/)
  assert.match(b,/mcData\.version\?\.version !== 770/)
  assert.match(b,/return 'declared:' \+ declared/)
  assert.match(b,/return 'embedded-or-transitive'/)
})

test('client build uses the frozen release asset dependency and validates its 1.21.5 item-definition layer',()=>{
  const b=read('apps/client/build-client.mjs')
  assert.match(b,/const assetsPackage = require\('mc-assets\/package\.json'\)/)
  assert.match(b,/itemDefinitions\.json/)
  assert.match(b,/hasOwnProperty\.call\(itemDefinitions, '1\.21\.5'\)/)
  for (const name of ['mace','wind_charge','firefly_bush','leaf_litter','wildflowers','cactus_flower']) assert.ok(b.includes(name), `missing 1.21.5 item-definition sentinel ${name}`)
  assert.match(b,/mcAssets: assetsPackage\.version/)
})

test('runtime bridge exposes secret-free 1.21.5 parity diagnostics',()=>{
  const b=read('apps/client/hem-bridge.js')
  assert.match(b,/__HEM_PARITY__/)
  assert.match(b,/registry\.ok/)
  assert.match(b,/windowsOpened/)
  assert.match(b,/entitiesSeen/)
  assert.match(b,/sectionObjects/)
  assert.match(b,/renderer\.healthy/)
  assert.doesNotMatch(b,/parity\.[A-Za-z0-9_]*token/i)
})

test('system gate covers commands redstone containers and expanded 1.21.5 content',()=>{
  const s=read('tests/system/browser-1215.mjs')
  for (const marker of ['rendered chunk sections','modern block registry states with live rendered chunk sections','client-originated command execution','client lever state synchronization','redstone-powered lamp state','shared native chest contents','mace inventory data','wind charge inventory data','Spring to Life plants/eggs','browser bone meal grows 1.21.5 Short Dry Grass','runtime 1.21.5 registry']) assert.ok(s.includes(marker), `missing system marker ${marker}`)
})


test('system gate covers crafting smelting item entities fluids pistons and hoppers',()=>{
  const s=read('tests/system/browser-1215.mjs')
  for (const marker of [
    'browser crafting recipe execution',
    '3x3 crafting-table recipe',
    'furnace fuel/input/progress/output synchronization',
    'dropped-item entity synchronization',
    'water/lava blockstate synchronization',
    'piston/redstone movement synchronization',
    'hopper transfer/container state synchronization',
    'barrel contents in browser container',
    'Ender chest leaked Hudson contents to Elise',
    'remote armor/offhand equipment synchronization',
    'repeater powered state',
    'server-authoritative fall damage',
    'server-authoritative night time reaches browser',
    'representative entity family',
  ]) assert.ok(s.includes(marker), `missing survival-loop system marker ${marker}`)
})


test('world creation supports Hardcore structures and vanilla world presets',()=>{
  const lib=read('apps/hub/src/lib.mjs')
  const worker=read('apps/hub/src/worker.mjs')
  const html=read('apps/hub/public/index.html')
  const app=read('apps/hub/public/app.js')
  const orch=read('apps/orchestrator/server.mjs')
  const worldConfig=read('apps/orchestrator/world-config.mjs')
  const migration=read('apps/hub/migrations/0004_world_generation.sql')
  assert.match(lib,/hardcore/)
  assert.match(lib,/WORLD_TYPES/)
  assert.match(worker,/world_type/)
  assert.match(worker,/generate_structures/)
  assert.match(html,/World Type: Default/)
  assert.match(html,/Generate Structures: On/)
  assert.match(app,/large_biomes/)
  assert.match(app,/amplified/)
  assert.match(worldConfig,/hardcore.*true/)
  assert.match(worldConfig,/level-type/)
  assert.match(worldConfig,/generate-structures/)
  assert.match(migration,/world_type/)
  assert.match(migration,/generate_structures/)
})

test('world allow-commands setting reaches Paper and normal authenticated players',()=>{
  const lib=read('apps/hub/src/lib.mjs')
  const worker=read('apps/hub/src/worker.mjs')
  const html=read('apps/hub/public/index.html')
  const app=read('apps/hub/public/app.js')
  const orch=read('apps/orchestrator/server.mjs')
  const worldConfig=read('apps/orchestrator/world-config.mjs')
  const plugin=read('apps/server-plugin/src/main/java/com/hemcraft/gate/HEMGatePlugin.java')
  assert.match(lib,/allowCommands/)
  assert.match(worker,/allow_commands/)
  assert.match(html,/Allow Commands: On/)
  assert.match(app,/toggle-commands/)
  assert.match(worldConfig,/enable-command-block.*allowCommands/)
  assert.match(plugin,/setOp\(lease\.commandsAuthorized\(\)\)/)
  const sys=read('tests/system/browser-1215.mjs')
  assert.doesNotMatch(sys,/command\(SHARED, `op \$\{H\}`\)/)
  assert.match(sys,/client-originated command execution/)
})


test('world list exposes Minecraft-style Edit flow with owner-only rename API',()=>{
  const worker=read('apps/hub/src/worker.mjs')
  const html=read('apps/hub/public/index.html')
  const app=read('apps/hub/public/app.js')
  assert.match(html,/Edit World/)
  assert.match(html,/data-action="edit-selected"/)
  assert.match(worker,/async function renameWorld/)
  assert.match(worker,/Only the world owner can rename this world/)
  assert.match(worker,/UPDATE worlds SET name=\?,updated_at=\?/)
  assert.match(app,/saveWorldEdit/)
})


test('browser refresh uses a bounded one-use resume lease without weakening launch-token replay protection',()=>{
  const p=read('apps/server-plugin/src/main/java/com/hemcraft/gate/HEMGatePlugin.java')
  const b=read('apps/client/hem-bridge.js')
  assert.match(p,/RESUME_TTL_MS\s*=\s*5 \* 60 \* 1000L/)
  assert.match(p,/resumeSessions\.remove\(token\)/)
  assert.match(p,/Base64\.getUrlEncoder\(\)\.withoutPadding\(\)/)
  assert.match(p,/registerOutgoingPluginChannel\(this, SESSION_CHANNEL\)/)
  assert.match(p,/sendPluginMessage\(this, SESSION_CHANNEL/)
  assert.match(b,/sessionStorage\.setItem\(resumeKey, value\)/)
  assert.match(b,/\/hem resume \$\{resume\}/)
  assert.match(b,/history\.replaceState/)
  assert.doesNotMatch(b,/localStorage\.setItem\([^\n]*resume/i)
  assert.doesNotMatch(b,/searchParams\.set\([^\n]*resume/i)
})

test('post-auth skins are re-announced and the system gate requires real remote texture fetches',()=>{
  const p=read('apps/server-plugin/src/main/java/com/hemcraft/gate/HEMGatePlugin.java')
  const s=read('tests/system/browser-1215.mjs')
  assert.match(p,/viewer\.hidePlayer\(this, player\)/)
  assert.match(p,/viewer\.showPlayer\(this, player\)/)
  assert.match(s,/Elise renderer fetches Hudson custom skin/)
  assert.match(s,/Hudson renderer fetches Elise custom skin/)
  assert.ok(fs.existsSync(path.join(root,'tests/system/skins/hudson.png')))
  assert.ok(fs.existsSync(path.join(root,'tests/system/skins/elise.png')))
})

test('active Paper crash recovery is an opt-in test-only fault and is exercised end to end',()=>{
  const o=read('apps/orchestrator/server.mjs')
  const y=read('tests/system/docker-compose.yml')
  const s=read('tests/system/browser-1215.mjs')
  assert.match(o,/HEM_ENABLE_TEST_FAULTS/)
  assert.match(o,/\/internal\/test\/kill-world/)
  assert.match(o,/child\.kill\('SIGKILL'\)/)
  assert.match(y,/HEM_ENABLE_TEST_FAULTS:\s*["']?true/)
  assert.match(s,/forced active-Paper crash recovery/)
  assert.match(s,/saved crash marker after forced Paper restart/)
})

test('R2 backup and restore bind to the orchestrator volume and fail safely',()=>{
  const backup=read('infra/backup-r2.sh')
  const restore=read('infra/restore-r2.sh')
  assert.match(backup,/cd "\$TMP".*sha256sum hem-worlds\.tar\.gz/s)
  assert.match(backup,/docker compose ps -aq orchestrator/)
  assert.match(backup,/eq \.Destination \"\/data\/worlds\"/)
  assert.match(backup,/rclone check "\$TMP\/" "\$RCLONE_REMOTE\/\$STAMP\/" --one-way/)
  assert.match(backup,/trap 'exit 130' INT/)
  assert.match(backup,/trap 'exit 143' TERM/)
  assert.match(restore,/RESTORE_CONFIRM/)
  assert.match(restore,/sha256sum -c hem-worlds\.tar\.gz\.sha256/)
  assert.match(restore,new RegExp(`HEM: ${versionPattern.source}`))
  assert.match(restore,/Paper: 1\.21\.5 build 114/)
  assert.match(restore,/docker compose ps -aq orchestrator/)
  assert.match(restore,/eq \.Destination \"\/data\/worlds\"/)
  assert.match(restore,/trap 'exit 130' INT/)
  assert.match(restore,/trap 'exit 143' TERM/)
  assert.match(restore,/\.\.\//)
  assert.match(restore,/pre-restore-worlds/)
  assert.match(restore,/level\.dat/)
})

test('backup restore rollback drill is executable and required by system certification',()=>{
  const backup=read('infra/backup-r2.sh')
  const restore=read('infra/restore-r2.sh')
  const drill=read('tests/system/backup-restore-drill.sh')
  const verifier=read('scripts/verify-certification.mjs')
  const workflow=read('.github/workflows/system-1215.yml')
  assert.match(backup,/HEM_RESTART_SERVICES:=orchestrator proxy caddy/)
  assert.match(restore,/HEM_RESTART_SERVICES:=orchestrator proxy caddy/)
  assert.match(drill,/HEM_RESTART_SERVICES='orchestrator proxy'/)
  assert.match(drill,/rclone-local-filesystem/)
  assert.match(drill,/postBackupMutationRemoved/)
  assert.match(drill,/invalidArchiveRejectedAfterMutation/)
  assert.match(drill,/automaticRollback/)
  assert.match(drill,/hem-restore-certification\.json/)
  assert.match(verifier,/hem-restore-certification\.json/)
  assert.match(verifier,/Backup\/restore certification is incomplete/)
  assert.match(workflow,/apt-get install -y rclone/)
  assert.match(workflow,/tests\/system\/backup-restore-drill\.sh/)
  assert.ok(workflow.indexOf('backup-restore-drill.sh') < workflow.indexOf('npm run verify:certification'))
})

test('system acceptance proves reconnect after a real transient proxy outage',()=>{
  const system=read('tests/system/browser-1215.mjs')
  assert.match(system,/docker.*compose.*tests\/system\/docker-compose\.yml/s)
  assert.match(system,/compose\('stop', '-t', '15', 'proxy'\)/)
  assert.match(system,/Hudson observes proxy outage/)
  assert.match(system,/Elise observes proxy outage/)
  assert.match(system,/compose\('start', 'proxy'\)/)
  assert.match(system,/transient proxy outage \+ same-tab resume recovery/)
})

test('certification workflow includes a real 60-minute two-browser soak',()=>{
  const workflow=read('.github/workflows/system-1215.yml')
  const system=read('tests/system/browser-1215.mjs')
  const timeout=/timeout-minutes:\s*(\d+)/.exec(workflow)
  assert.ok(timeout && Number(timeout[1])>=120,`expected system timeout >= 120 minutes, got ${timeout?.[1]||'missing'}`)
  assert.match(workflow,/HEM_SOAK_MINUTES:.*'5'.*'60'/)
  assert.match(system,/SOAK_MINUTES/)
  assert.match(system,/60_000/)
  assert.match(system,/two-browser stability soak/)
})

test('system acceptance emits a machine-readable certification artifact with named live gates',()=>{
  const s=read('tests/system/browser-1215.mjs')
  const spec=JSON.parse(read('tests/system/required-gates-1215.json'))
  assert.match(s,/hem-1215-certification\.json/)
  assert.match(s,/acceptance: 'passed'/)
  assert.match(s,/upstreamCommit: buildIdentity\.upstreamCommit/)
  assert.match(s,/upstreamPinned: buildIdentity\.upstreamPinned === true/)
  assert.match(s,/soakMinutes: SOAK_MINUTES/)
  assert.match(s,/gates: \[\.\.\.passedGates\]\.sort\(\)/)
  assert.match(s,/missingGates/)
  for (const gate of ['client.capability-contract','blocks.placement','render.post-placement-stability','blocks.state-families','movement.jump','movement.obstacle-jump','inventory.armor-offhand','crafting.table-3x3','containers.ender-chest','redstone.repeater','redstone.rails-minecart','movement.vehicle-mount','containers.shulker-box','containers.special-furnaces','progression.experience','multiplayer.player-list','movement.fall-damage','world.time-weather','entities.family-sentinels','entities.family-expanded','entities.projectile-sentinels']) {
    assert.ok(spec.required.includes(gate), `missing required live gate ${gate}`)
    assert.ok(s.includes(gate), `system driver never records live gate ${gate}`)
  }
})

test('certification verifier rejects incomplete or unpinned final evidence',()=>{
  const v=read('scripts/verify-certification.mjs')
  const workflow=read('.github/workflows/system-1215.yml')
  assert.match(v,/HEM_REQUIRE_PINNED_CERT/)
  assert.match(v,/Certification missing required gates/)
  assert.match(v,/requiredGateCount/)
  assert.match(v,/expectedSoak/)
  assert.match(v,/expectedVersion/)
  assert.match(v,/package\.json/)
  assert.match(workflow,/Verify machine-readable acceptance certificate/)
  assert.match(workflow,/HEM_REQUIRE_PINNED_CERT/)
  assert.match(workflow,/npm run verify:certification/)
})

test('final client certification and production deploy require an exact upstream commit SHA',()=>{
  const b=read('apps/client/build-client.mjs')
  const system=read('.github/workflows/system-1215.yml')
  const deploy=read('.github/workflows/deploy-cloudflare.yml')
  assert.match(b,/HEM_REQUIRE_PINNED_MWC/)
  assert.match(b,/\^\[0-9a-f\]\{40\}\$/)
  assert.match(b,/upstream checkout mismatch/)
  assert.match(b,/upstreamPinned:/)
  assert.match(system,/default: 0359f20b8d721ea44c7ddb633c985a71574c73d3/)
  assert.match(system,/HEM_REQUIRE_PINNED_MWC: 'true'/)
  assert.match(system,/HEM_REQUIRE_PINNED_CERT: 'true'/)
  assert.doesNotMatch(system,/default: next/)
  assert.match(deploy,/mwc_ref:/)
  assert.match(deploy,/HEM_REQUIRE_PINNED_MWC: 'true'/)
  assert.match(deploy,/d\.upstreamPinned!==true/)
  assert.match(deploy,/d\.upstreamRef!==d\.upstreamCommit/)
})


test('release candidates use a finite production blocker list instead of making every parity TODO block 1.0.0',()=>{
  const guard=read('scripts/release-guard.mjs')
  const readiness=read('scripts/release-readiness.mjs')
  const blockers=read('docs/RELEASE_BLOCKERS.md')
  const pkg=JSON.parse(read('package.json'))
  assert.equal(pkg.scripts['release:readiness'],'node scripts/release-readiness.mjs')
  assert.match(guard,/release-readiness\.mjs/)
  assert.doesNotMatch(guard,/parity-report\.mjs'\), \['--final'\]/)
  assert.match(guard,/HEM_REQUIRE_PINNED_CERT: 'true'/)
  assert.match(guard,/HEM_EXPECT_SOAK_MINUTES: '60'/)
  assert.match(readiness,/OPEN\|CLOSED/)
  assert.match(readiness,/--final/)
  for (const id of ['pinned-live-acceptance','sixty-minute-soak','production-r2-restore','household-manual-acceptance']) assert.ok(blockers.includes(id),`missing finite release blocker ${id}`)
  assert.match(blockers,/full 1\.21\.5 parity/)
})

test('browser build contract exposes release-critical upstream client capabilities',()=>{
  const b=read('apps/client/build-client.mjs')
  for (const capability of ['keybindings','renderDistanceSetting','rawMouseInput','resourcePackTextures','creativeInventory','debugOverlay','thirdPerson','sounds']) assert.ok(b.includes(capability),`missing capability contract ${capability}`)
  assert.match(b,/HEM upstream capability contract missing/)
  assert.match(b,/capabilities,/)
  assert.match(b,/minecraftData: require\('minecraft-data\/package\.json'\)\.version/)
  assert.match(b,/upstreamLockSha256/)
})

test('HEM options forward a Minecraft-style video/input/audio profile and can open upstream keybindings on next launch',()=>{
  const html=read('apps/hub/public/index.html')
  const app=read('apps/hub/public/app.js')
  assert.match(html,/Game Render Distance/)
  assert.match(html,/openControls/)
  assert.match(app,/renderDistance/)
  assert.match(app,/searchParams\.append\('setting'/)
  for (const setting of ['fov','mouseSensitivity','masterVolume','musicVolume','viewBobbing','smoothLighting','skyEnabled','rawMouseInput']) assert.ok(app.includes(`['${setting}'`) || app.includes(`'${setting}'`), `missing forwarded setting ${setting}`)
  assert.match(html,/High contrast launcher UI/)
  assert.match(app,/searchParams\.set\('modal', 'keybindings'\)/)
  assert.match(app,/location\.assign\(withClientSettings\(data\.launchUrl\)\)/)
})



test('source packaging is protected by a reproducible SHA-256 manifest',()=>{
  const tool=read('scripts/source-manifest.mjs')
  const pack=read('scripts/package.mjs')
  const pkg=JSON.parse(read('package.json'))
  assert.equal(pkg.scripts['manifest:write'],'node scripts/source-manifest.mjs --write')
  assert.equal(pkg.scripts['manifest:verify'],'node scripts/source-manifest.mjs')
  assert.match(tool,/SOURCE_MANIFEST\.sha256/)
  assert.match(tool,/createHash\('sha256'\)/)
  assert.match(tool,/excludedDirs/)
  assert.match(tool,/artifacts/)
  assert.match(tool,/--write/)
  assert.match(pack,/source-manifest\.mjs/)
})

test('promotion tooling converts the same certified tree into final 1.0.0 and requires recertification',()=>{
  const setVersion=read('scripts/set-version.mjs')
  const promote=read('scripts/promote-1.0.0.mjs')
  const pack=read('scripts/package.mjs')
  const verifier=read('scripts/verify-certification.mjs')
  assert.match(setVersion,/Usage: node scripts\/set-version\.mjs 1\.0\.0\[-rc\.N\]/)
  assert.match(setVersion,/source-manifest\.mjs/)
  assert.match(setVersion,/--write/)
  assert.match(promote,/release-readiness\.mjs/)
  assert.match(promote,/verify-certification\.mjs/)
  assert.match(promote,/set-version\.mjs/)
  assert.match(promote,/rerun final System Acceptance/)
  assert.match(pack,/version==='1\.0\.0'/)
  assert.match(pack,/HEM_v1\.0\.0_SOURCE\.zip/)
  assert.match(verifier,/expectedVersion/)
  assert.match(verifier,/package\.json/)
})

test('release-bound final path has a real household acceptance worksheet',()=>{
  const blockers=read('docs/RELEASE_BLOCKERS.md')
  const manual=read('docs/MANUAL_ACCEPTANCE.md')
  assert.match(blockers,/household-manual-acceptance/)
  assert.match(blockers,/docs\/MANUAL_ACCEPTANCE\.md/)
  for (const marker of ['Exact minecraft-web-client commit','Open Controls on next game launch','Remap at least one movement/action key','real Nether portal','Cloudflare R2 remote','Player 1 sign-off','Player 2 sign-off']) {
    assert.ok(manual.includes(marker), `missing manual release acceptance marker: ${marker}`)
  }
})

test('release-bound system acceptance includes normal keyboard difficulty and native portal gates',()=>{
  const system=read('tests/system/browser-1215.mjs')
  const spec=JSON.parse(read('tests/system/required-gates-1215.json'))
  for (const gate of ['controls.keyboard-movement','world.difficulty','world.border','dimensions.native-entry-portals','redstone.dust-propagation','survival.hunger-death-respawn']) {
    assert.ok(spec.required.includes(gate), `missing required gate ${gate}`)
    assert.ok(system.includes(`pass('${gate}'`), `missing system implementation ${gate}`)
  }
  assert.match(system,/keyboard\.down\('w'\)/)
  assert.match(system,/difficulty hard/)
  assert.match(system,/minecraft:nether_portal\[axis=x\]/)
  assert.match(system,/minecraft:end_portal/)
  assert.match(system,/redstone dust analog-power propagation/)
  assert.match(system,/client-origin respawn/)
  assert.match(system,/worldborder set 8/)
})

test('release readiness derives pinned live and soak blockers from certification evidence',()=>{
  const readiness=read('scripts/release-readiness.mjs')
  const reconcile=read('scripts/reconcile-release-blockers.mjs')
  const promote=read('scripts/promote-1.0.0.mjs')
  const workflow=read('.github/workflows/system-1215.yml')
  const blockers=read('docs/RELEASE_BLOCKERS.md')
  const pkg=JSON.parse(read('package.json'))
  assert.equal(pkg.scripts['release:reconcile'],'node scripts/reconcile-release-blockers.mjs')
  assert.match(readiness,/const evidence =/)
  assert.match(readiness,/pinned-live-acceptance/)
  assert.match(readiness,/sixty-minute-soak/)
  assert.match(readiness,/HEM_REQUIRE_PINNED_CERT: 'true'/)
  assert.match(readiness,/HEM_EXPECT_SOAK_MINUTES: '60'/)
  assert.match(readiness,/evidenceDerived/)
  assert.match(reconcile,/hem-release-readiness\.json/)
  assert.match(promote,/reconcile-release-blockers\.mjs/)
  assert.match(workflow,/Reconcile release evidence/)
  assert.match(workflow,/npm run release:reconcile/)
  assert.match(blockers,/evidence-derived at runtime/)
})

test('all four final blockers are evidence-derived and cannot be closed by status text alone',()=>{
  const readiness=read('scripts/release-readiness.mjs')
  const r2=read('scripts/verify-production-r2-evidence.mjs')
  const drill=read('infra/production-r2-drill.sh')
  const manual=read('scripts/verify-manual-acceptance.mjs')
  const pkg=JSON.parse(read('package.json'))
  for (const id of ['pinned-live-acceptance','sixty-minute-soak','production-r2-restore','household-manual-acceptance']) {
    assert.ok(readiness.includes(`'${id}'`), `readiness does not derive ${id}`)
  }
  assert.equal(pkg.scripts['drill:r2-production'],'infra/production-r2-drill.sh')
  assert.equal(pkg.scripts['verify:r2-production'],'node scripts/verify-production-r2-evidence.mjs')
  assert.equal(pkg.scripts['verify:manual'],'node scripts/verify-manual-acceptance.mjs')
  assert.match(drill,/HEM_DISPOSABLE_R2_DRILL/)
  assert.ok(drill.includes('r2\\.cloudflarestorage\\.com'))
  assert.match(drill,/find \/worlds -mindepth 1 -maxdepth 1 -exec rm -rf/)
  assert.match(drill,/native Paper playerdata/)
  assert.match(drill,/rolling back the pre-restore snapshot/)
  assert.match(r2,/emptyVolumeRestore/)
  assert.match(r2,/rollbackHashesMatch/)
  assert.match(manual,/unchecked required item/)
  assert.match(manual,/40-character SHA/)
  assert.match(manual,/worksheetSha256/)
})

test('RC13 has no unimplemented parity TODOs but still refuses the full-parity claim until PARTIAL entries are live-proven',()=>{
  const parity=read('docs/PARITY_1_21_5.md')
  const pkg=JSON.parse(read('package.json'))
  const spec=JSON.parse(read('tests/system/required-gates-1215.json'))
  const system=read('tests/system/browser-1215.mjs')
  assert.equal(pkg.scripts['parity:full'],'node scripts/parity-report.mjs --final')
  assert.equal((parity.match(/^- TODO /gm)||[]).length,0)
  assert.ok((parity.match(/^- PARTIAL /gm)||[]).length>0)
  assert.ok(spec.required.length>=120,`expected at least 120 live gates, got ${spec.required.length}`)
  for(const gate of spec.required) assert.ok(system.includes(`pass('${gate}'`)||system.includes(`pass(\"${gate}\"`),`required gate has no system pass site: ${gate}`)
})

test('client build preserves frozen upstream provenance and verifies 1.21.5 protocol/data before bundling',()=>{
  const b=read('apps/client/build-client.mjs')
  const system=read('tests/system/browser-1215.mjs')
  const verifier=read('scripts/verify-certification.mjs')
  assert.match(b,/upstreamReleaseTag/); assert.match(b,/protocolVerified1215/); assert.match(b,/upstreamLiteralVersionTokens/)
  assert.match(b,/upstreamSupportedVersionsSha256/)
  assert.match(b,/pinned-v0\.1\.99-lockfile-1215-verified/)
  assert.match(b,/--frozen-lockfile/)
  assert.doesNotMatch(b,/--no-frozen-lockfile/)
  assert.match(b,/upstreamLockSha256/)
  assert.match(b,/upstreamPackageSha256/)
  assert.match(b,/frozenLockfile: true/)
  assert.match(b,/literal supportedVersions tokens are informational only/)
  assert.match(b,/createHash\('sha256'\)\.update\(upstreamSupportedVersionsSource\)/)
  assert.match(system,/compatibilityMode: buildIdentity\.compatibilityMode/)
  assert.match(verifier,/pinned v0\.1\.99 frozen dependencies plus verified 1\.21\.5 protocol\/data/)
  const workflow=read('.github/workflows/system-1215.yml')
  assert.match(b,/0359f20b8d721ea44c7ddb633c985a71574c73d3/)
  assert.match(workflow,/default: 0359f20b8d721ea44c7ddb633c985a71574c73d3/)
  assert.match(workflow,/HEM_REQUIRE_PINNED_MWC: 'true'/)
  assert.match(workflow,/HEM_REQUIRE_PINNED_CERT: 'true'/)
  assert.doesNotMatch(workflow,/default: next/)
})

test('browser bridge fails visibly on bad 1.21.5 build registry renderer or authorization state',()=>{
  const b=read('apps/client/hem-bridge.js')
  assert.match(b,/hem-compatibility-error/)
  for (const code of ['build-identity','registry-1215','renderer-1215','authorization']) assert.ok(b.includes(code),`missing visible fatal code ${code}`)
  assert.match(b,/authorization: \{ mode:/)
  assert.match(b,/build: \{ checked:/)
  assert.match(b,/50_000/)
})

test('orchestrator rejects invalid production config and avoids silent Paper startup respawn loops',()=>{
  const o=read('apps/orchestrator/server.mjs')
  assert.match(o,/runtimeConfigErrors/)
  assert.match(o,/MAX_ACTIVE_WORLDS .* exceeds world port capacity/)
  assert.match(o,/ORCHESTRATOR_KEY must be >=32/)
  assert.match(o,/HEMGate plugin jar is missing or unreadable/)
  assert.match(o,/Paper exited before ready/)
  assert.match(o,/failedAt/)
  assert.match(o,/configFingerprint/)
  assert.match(o,/config-changed/)
})

test('system workflow runs the machine-readable HEM doctor before live acceptance',()=>{
  const pkg=JSON.parse(read('package.json'))
  const workflow=read('.github/workflows/system-1215.yml')
  const doctor=read('scripts/doctor.mjs')
  assert.equal(pkg.scripts['doctor:system'],'node scripts/doctor.mjs --system')
  assert.match(workflow,/npm run doctor:system/)
  assert.match(doctor,/hem-doctor\.json/)
  assert.match(doctor,/network\.paper-1215/)
  assert.match(doctor,/client\.identity/)
  assert.match(doctor,/tool\.docker-compose/)
})
test('RC13 native 1.21.5 mechanics are release-gated beyond registry sentinels',()=>{
  const s=read('tests/system/browser-1215.mjs')
  const spec=JSON.parse(read('tests/system/required-gates-1215.json'))
  const client=read('apps/client/build-client.mjs')
  const gates=[
    'commands.command-block-edit','redstone.crafter-recipe','world.fluid-buckets',
    'redstone.dispenser-fluid','blocks.copper-actions','entities.golem-creation',
    'entities.breeding','bosses.wither-structure-spawn','survival.food-consumption',
    'movement.boat-control','blocks.cauldron-composter-actions','items.enchanting',
    'items.anvil-rename','entities.ender-pearl-use','movement.swimming',
    'movement.ladder-climb','movement.scaffolding-climb','redstone.sticky-slime',
    'redstone.daylight-sensor','dimensions.portal-ignition','survival.fishing',
    'dimensions.bed-spawn'
  ]
  assert.ok(spec.required.length>=120,`expected at least 120 mandatory live gates, got ${spec.required.length}`)
  for(const gate of gates){
    assert.ok(spec.required.includes(gate),`missing required native-mechanic gate ${gate}`)
    assert.ok(s.includes(`pass('${gate}'`),`missing system pass site for ${gate}`)
  }
  for(const marker of ['setCommandBlock','browser food consumption restores hunger','browser bucket pickup returns filled bucket','browser axe scraping weathered copper','native cow breeding creates child entity','browser-built Wither appears','Crafter emits iron-ingot recipe output','native oak-boat steering','browser-enchanted item persists enchantment component','browser anvil rename persists custom name','browser sprint-swims through a water lane','browser climbs native ladder','browser climbs native scaffolding','sticky piston slime assembly extension','browser toggles daylight detector inversion','browser flint-and-steel creates Nether portal blocks','native fishing catch reaches browser inventory','client respawns near valid Overworld bed spawn']) assert.ok(s.includes(marker),`missing live-mechanic marker ${marker}`)
  assert.match(client,/process\.env\.MWC_REF \|\| '0359f20b8d721ea44c7ddb633c985a71574c73d3'/)
  assert.match(client,/spawnEggs = mcData\.itemsArray\.filter/)
  assert.match(client,/for \(const name of spawnEggs\)/)
})


test('RC13 parity closure batch gates seed vertical movement storage redstone taming shield and respawn-anchor behavior',()=>{
  const s=read('tests/system/browser-1215.mjs')
  const spec=JSON.parse(read('tests/system/required-gates-1215.json'))
  const gates=[
    'world.seed-authority','blocks.wall-state','movement.vine-climb','movement.bubble-column',
    'blocks.bookshelf-pot-actions','redstone.observer-action','entities.taming','combat.shield-block',
    'dimensions.respawn-anchor-spawn','containers.mount-inventory-semantics'
  ]
  assert.ok(spec.required.length>=135,`expected at least 135 mandatory live gates, got ${spec.required.length}`)
  for(const gate of gates){
    assert.ok(spec.required.includes(gate),`missing required parity-closure gate ${gate}`)
    assert.ok(s.includes(`pass('${gate}'`),`missing live pass site for ${gate}`)
  }
  for(const marker of [
    'Paper reports the configured shared-world seed','wall side-height/up state synchronization','browser climbs native vine',
    'upward bubble column lifts browser player','browser inserts book into chiseled bookshelf','decorated pot stores browser-inserted item',
    'observer neighbor update pulses lamp','browser-fed wolf acquires owner UUID','unshielded arrow damages browser player',
    'client respawns near valid Nether respawn anchor','browser deposits item into chested llama inventory'
  ]) assert.ok(s.includes(marker),`missing parity-closure live marker ${marker}`)
})


test('RC13 second parity closure batch gates native recipes technical redstone gateway and death drops',()=>{
  const s=read('tests/system/browser-1215.mjs')
  const spec=JSON.parse(read('tests/system/required-gates-1215.json'))
  const gates=['items.brewing-recipe','items.smithing-recipe','items.grindstone-action','redstone.tripwire-action','commands.command-minecart','survival.death-drops','dimensions.end-gateway']
  assert.ok(spec.required.length>=142,`expected at least 142 mandatory live gates, got ${spec.required.length}`)
  for(const gate of gates){
    assert.ok(spec.required.includes(gate),`missing required second parity-closure gate ${gate}`)
    assert.ok(s.includes(`pass('${gate}'`),`missing live pass site for ${gate}`)
  }
  for(const marker of ['browser brewing produces awkward potion component','browser takes native smithing result','grindstone result persists in player inventory','browser player powers attached tripwire hook','command-block minecart executes on powered activator rail','death creates dropped inventory item entity','native End Gateway teleports browser player to exact exit']) assert.ok(s.includes(marker),`missing second parity-closure live marker ${marker}`)
})


test('RC13 third parity closure gates XP costs border damage and powder snow physics',()=>{
  const s=read('tests/system/browser-1215.mjs')
  const spec=JSON.parse(read('tests/system/required-gates-1215.json'))
  const gates=['progression.enchant-cost','items.anvil-cost','world.border-damage','movement.powder-snow']
  assert.ok(spec.required.length>=146,`expected at least 146 mandatory live gates, got ${spec.required.length}`)
  for(const gate of gates){
    assert.ok(spec.required.includes(gate),`missing required third-closure gate ${gate}`)
    assert.ok(s.includes(`pass('${gate}'`),`missing system pass site for ${gate}`)
  }
  for(const marker of ['enchanting consumes browser XP levels','anvil rename consumes browser XP levels','world-border damage reaches browser health state','powder-snow sink/support semantics differ with leather boots']) assert.ok(s.includes(marker),`missing third-closure live marker ${marker}`)
})

test('RC13 fourth parity closure gates bundle repair furnace XP archaeology cooldown and critical combat',()=>{
  const s=read('tests/system/browser-1215.mjs')
  const spec=JSON.parse(read('tests/system/required-gates-1215.json'))
  const gates=['items.bundle-storage','items.anvil-repair','containers.furnace-xp','blocks.archaeology-brushing','combat.attack-cooldown','combat.critical-hit']
  assert.ok(spec.required.length>=152,`expected at least 152 mandatory live gates, got ${spec.required.length}`)
  for(const gate of gates){
    assert.ok(spec.required.includes(gate),`missing required fourth-closure gate ${gate}`)
    assert.ok(s.includes(`pass('${gate}'`),`missing system pass site for ${gate}`)
  }
  for(const marker of ['browser inventory click stores apples in native bundle component','anvil combines damaged swords into repaired result','taking furnace result awards browser XP','browser brushing completes suspicious-sand archaeology cycle','attack cooldown scaling failed','critical hit scaling failed']) assert.ok(s.includes(marker),`missing fourth-closure live marker ${marker}`)
})


test('RC13 fifth parity closure gates target activator torch beacon and dragon fight state',()=>{
  const s=read('tests/system/browser-1215.mjs')
  const spec=JSON.parse(read('tests/system/required-gates-1215.json'))
  const gates=['redstone.target-action','redstone.activator-rail-action','redstone.torch-burnout','containers.beacon-effect','bosses.dragon-fight-state']
  assert.ok(spec.required.length>=157,`expected at least 157 mandatory live gates, got ${spec.required.length}`)
  for(const gate of gates){
    assert.ok(spec.required.includes(gate),`missing required fifth-closure gate ${gate}`)
    assert.ok(s.includes(`pass('${gate}'`),`missing system pass site for ${gate}`)
  }
  for(const marker of ['target-block analog redstone output','powered activator rail ejects browser rider','redstone torch enters burnout','set_beacon_effect','native dragon death generates End exit portal']) assert.ok(s.includes(marker),`missing fifth-closure live marker ${marker}`)
})


test('RC13 sixth parity closure gates survival combat enchantment consumable and border-update semantics',()=>{
  const s=read('tests/system/browser-1215.mjs')
  const spec=JSON.parse(read('tests/system/required-gates-1215.json'))
  const gates=['combat.shield-angle','combat.protection-enchant','combat.fire-aspect','survival.totem','items.potion-milk','world.border-updates']
  assert.ok(spec.required.length>=163,`expected at least 163 mandatory live gates, got ${spec.required.length}`)
  for(const gate of gates){
    assert.ok(spec.required.includes(gate),`missing required sixth-closure gate ${gate}`)
    assert.ok(s.includes(`pass('${gate}'`),`missing system pass site for ${gate}`)
  }
  for(const marker of ['rear projectile bypasses frontal shield arc','Protection enchantment mitigation failed','browser Fire Aspect hit ignites target','totem prevents lethal damage and is consumed','browser drinking milk clears active potion effects','world_border_lerp_size']) assert.ok(s.includes(marker),`missing sixth-closure live marker ${marker}`)
})

test('RC16 orchestrator image sources Java 21 from a real JRE image instead of Bookworm apt',()=>{
  const d=read('apps/orchestrator/Dockerfile')
  assert.match(d,/FROM eclipse-temurin:21-jre-jammy AS java-runtime/)
  assert.match(d,/COPY --from=java-runtime \/opt\/java\/openjdk \/opt\/java\/openjdk/)
  assert.match(d,/ENV JAVA_HOME=\/opt\/java\/openjdk/)
  assert.match(d,/java -version/)
  assert.doesNotMatch(d,/apt-get install[^\n]*openjdk-21-jre-headless/)
})


test('RC17 proxy dependency stage provides git without shipping it in the runtime image',()=>{
  const d=read('apps/proxy/Dockerfile')
  assert.ok(d.includes('FROM node:22-bookworm-slim AS deps'))
  assert.ok(d.includes('apt-get install -y --no-install-recommends git ca-certificates'))
  assert.ok(d.includes('RUN npm install --omit=dev'))
  assert.ok(d.includes('COPY --from=deps /app/node_modules ./node_modules'))
  const runtimeMarker='FROM node:22-bookworm-slim\nWORKDIR /app\nCOPY --from=deps /app/node_modules ./node_modules'
  assert.ok(d.includes(runtimeMarker),'proxy runtime must copy preinstalled production dependencies from deps stage')
  const runtime=d.slice(d.indexOf(runtimeMarker))
  assert.doesNotMatch(runtime,/apt-get install[^\n]*git/)
})


test('RC19 orchestrator runtime image ships every local module imported by server.mjs',()=>{
  const server=read('apps/orchestrator/server.mjs')
  const docker=read('apps/orchestrator/Dockerfile')
  const imports=[...server.matchAll(/from ['\"](\.\/[^'\"]+)['\"]/g)].map(m=>m[1].replace(/^\.\//,''))
  assert.deepEqual(new Set(imports),new Set(['world-config.mjs','world-version.mjs']))
  for(const file of imports){
    assert.ok(docker.includes(`COPY apps/orchestrator/${file} ./${file}`),`orchestrator image does not copy imported runtime module ${file}`)
  }
})


test('RC20 client test origin never masks missing JSON or JS assets with index.html',()=>{
  const server=read('tests/system/static-client.mjs')
  assert.match(server,/wantsDocument/)
  assert.match(server,/missing client asset/)
  assert.match(server,/HEM client asset not found/)
  assert.match(server,/x-content-type-options':'nosniff'/)
  assert.match(server,/if \(wantsDocument\(req, u\.pathname\)\) actual = path\.join\(root, 'index\.html'\)/)
})


test('RC21 workflows reject incomplete or stale release checkouts before tests, builds, or system doctor',()=>{
  for(const rel of ['.github/workflows/ci.yml','.github/workflows/system-1215.yml','.github/workflows/deploy-cloudflare.yml']){
    const workflow=read(rel)
    const manifestIndex=workflow.indexOf('sha256sum -c SOURCE_MANIFEST.sha256')
    assert.ok(manifestIndex>=0,`${rel} does not verify the shipped source manifest`)
    for(const later of ['npm test','node apps/client/build-client.mjs','npm run doctor:system']){
      const i=workflow.indexOf(later)
      if(i>=0) assert.ok(manifestIndex<i,`${rel} verifies the manifest after ${later}`)
    }
  }
  const manifest=read('SOURCE_MANIFEST.sha256')
  assert.match(manifest,/\.\/scripts\/doctor\.mjs/)
  const pkg=JSON.parse(read('package.json'))
  assert.equal(pkg.scripts['doctor:system'],'node scripts/doctor.mjs --system')
})


test('RC21 repo-root package and package script preserve a directly extractable complete checkout',()=>{
  const pkg=JSON.parse(read('package.json'))
  assert.equal(pkg.scripts['package:repo-root'],'node scripts/package-repo-root.mjs')
  const pack=read('scripts/package-repo-root.mjs')
  assert.match(pack,/REPO_ROOT\.zip/)
  assert.match(pack,/scripts\/source-manifest\.mjs/)
  assert.match(pack,/'-qr', out, '\.'/)
  assert.match(pack,/\.\/apps\/client\/upstream\/\*/)
  assert.match(pack,/\.\/\.git\/\*/)
})
