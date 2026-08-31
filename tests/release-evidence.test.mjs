import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function copy(root, rel) {
  const from = path.join(sourceRoot, rel)
  const to = path.join(root, rel)
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.copyFileSync(from, to)
}

test('all four finite release blockers close from matching evidence without editing Markdown status tokens',()=>{
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hem-release-evidence-'))
  try {
    for (const rel of [
      'package.json','docs/RELEASE_BLOCKERS.md','docs/MANUAL_ACCEPTANCE.md','tests/system/required-gates-1215.json',
      'scripts/release-readiness.mjs','scripts/reconcile-release-blockers.mjs','scripts/promote-1.0.0.mjs','scripts/set-version.mjs','scripts/source-manifest.mjs','scripts/verify-certification.mjs','scripts/verify-production-r2-evidence.mjs','scripts/verify-manual-acceptance.mjs'
    ]) copy(temp, rel)
    fs.mkdirSync(path.join(temp, 'artifacts'), { recursive: true })
    const packagePath = path.join(temp,'package.json')
    const pkg = JSON.parse(fs.readFileSync(packagePath,'utf8'))
    // This is deliberately an RC -> final promotion fixture even when the real
    // source tree running the test has already been promoted to 1.0.0.
    if (!/-rc\.\d+$/.test(pkg.version)) {
      pkg.version = '1.0.0-rc.1499'
      fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`)
    }
    const spec = JSON.parse(fs.readFileSync(path.join(temp,'tests/system/required-gates-1215.json'),'utf8'))
    const commit = 'a'.repeat(40)
    const now = '2026-08-29T22:00:00Z'
    const gates = [...spec.required, spec.soak]
    fs.writeFileSync(path.join(temp,'artifacts/hem-1215-certification.json'), JSON.stringify({
      hemVersion:pkg.version,minecraft:'1.21.5',acceptance:'passed',upstreamCommit:commit,upstreamRef:commit,upstreamPinned:true,
      upstreamReleaseTag:'v0.1.98',upstreamRelease1215:true,upstreamLiteralVersionTokens:['1.7'],upstreamSupportedVersionsSha256:'b'.repeat(64),upstreamPackageSha256:'c'.repeat(64),upstreamLockSha256:'d'.repeat(64),pnpmVersion:'10.13.1',frozenLockfile:true,protocolVerified1215:true,compatibilityMode:'pinned-v0.1.98-lockfile-1215-verified',
      gates,gateCount:gates.length,requiredGateCount:gates.length,soakMinutes:60,completedAt:now
    }))
    fs.writeFileSync(path.join(temp,'artifacts/hem-launcher-certification.json'), JSON.stringify({
      hemVersion:pkg.version,preview:'webgl-3d',classic:true,slim:true,dragRotate:true,legacyNormalized:true,settingsPersisted:true
    }))
    fs.writeFileSync(path.join(temp,'artifacts/hem-restore-certification.json'), JSON.stringify({
      hemVersion:pkg.version,transport:'rclone-local-filesystem',goodRestore:true,postBackupMutationRemoved:true,
      invalidArchiveRejectedAfterMutation:true,automaticRollback:true,backupStamp:'20260829T210000Z',completedAt:now
    }))
    fs.writeFileSync(path.join(temp,'artifacts/hem-production-r2-restore.json'), JSON.stringify({
      hemVersion:pkg.version,transport:'cloudflare-r2',rcloneBackend:'s3-cloudflare-r2',remoteAlias:'hem-r2',
      backupStamp:'20260829T210000Z',remoteCopyVerified:true,emptyVolumeRestore:true,nativeLevelDatFiles:2,nativePlayerDataFiles:2,
      nativeHashesMatch:true,invalidArchiveRejectedAfterMutation:true,automaticRollback:true,rollbackHashesMatch:true,completedAt:now
    }))

    let manual = fs.readFileSync(path.join(temp,'docs/MANUAL_ACCEPTANCE.md'),'utf8').replaceAll('- [ ]','- [x]').replaceAll('[ ] yes','[x] yes')
    const replacements = new Map([
      ['- HEM build/version: ____________________',`- HEM build/version: ${pkg.version}`],
      ['- Exact minecraft-web-client commit (40-char SHA): ________________________________________',`- Exact minecraft-web-client commit (40-char SHA): ${commit}`],
      ['- Deployment URL: ____________________','- Deployment URL: https://hem.example.test'],
      ['- Game host/VPS identifier: ____________________','- Game host/VPS identifier: hem-disposable-01'],
      ['- Cloudflare R2 backup stamp used for restore proof: ____________________','- Cloudflare R2 backup stamp used for restore proof: 20260829T210000Z'],
      ['- Automated certification completed at: ____________________',`- Automated certification completed at: ${now}`],
      ['- Manual session started at: ____________________','- Manual session started at: 2026-08-29T20:00:00Z'],
      ['- Manual session ended at: ____________________','- Manual session ended at: 2026-08-29T22:00:00Z'],
      ['- Player 1/operator: ____________________','- Player 1/operator: Player One'],
      ['- Player 2/operator: ____________________','- Player 2/operator: Player Two'],
      ['Player 1 sign-off: ____________________  Date/time: ____________________','Player 1 sign-off: Player One  Date/time: 2026-08-29T22:01:00Z'],
      ['Player 2 sign-off: ____________________  Date/time: ____________________','Player 2 sign-off: Player Two  Date/time: 2026-08-29T22:01:00Z'],
      ['Release operator sign-off: ____________________  Date/time: ____________________','Release operator sign-off: Release Operator  Date/time: 2026-08-29T22:02:00Z']
    ])
    for (const [from,to] of replacements) manual=manual.replace(from,to)
    fs.writeFileSync(path.join(temp,'docs/MANUAL_ACCEPTANCE.md'),manual)

    const output = execFileSync(process.execPath,[path.join(temp,'scripts/release-readiness.mjs'),'--final'],{cwd:temp,encoding:'utf8'})
    assert.match(output,/CLOSED=4 OPEN=0 TOTAL=4/)
    for (const id of ['pinned-live-acceptance','sixty-minute-soak','production-r2-restore','household-manual-acceptance']) assert.match(output,new RegExp(`CLOSED ${id}`))
    const blockerText=fs.readFileSync(path.join(temp,'docs/RELEASE_BLOCKERS.md'),'utf8')
    assert.equal((blockerText.match(/^- OPEN /gm)||[]).length,4,'synthetic proof must not rely on editing declared status tokens')

    const promotion = execFileSync(process.execPath,[path.join(temp,'scripts/promote-1.0.0.mjs')],{cwd:temp,encoding:'utf8'})
    assert.match(promotion,/promoted to 1\.0\.0/i)
    const promotedPkg = JSON.parse(fs.readFileSync(path.join(temp,'package.json'),'utf8'))
    assert.equal(promotedPkg.version,'1.0.0','the actual promotion command must convert an evidence-complete RC tree to final')

    assert.throws(()=>execFileSync(process.execPath,[path.join(temp,'scripts/verify-certification.mjs')],{
      cwd:temp,encoding:'utf8',stdio:'pipe',env:{...process.env,HEM_REQUIRE_PINNED_CERT:'true',HEM_EXPECT_SOAK_MINUTES:'60'}
    }),/Command failed/,'the RC certificate must not certify the newly promoted final tree; final System Acceptance must rerun')
  } finally {
    fs.rmSync(temp,{recursive:true,force:true})
  }
})
