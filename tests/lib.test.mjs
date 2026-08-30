import test from 'node:test'
import assert from 'node:assert/strict'
import {
  WORLD_ID_RE, MC_USERNAME_RE, randomWorldId, randomIdentityId, randomToken,
  sanitizeDisplayName, sanitizeWorldName, baseMcUsername, deriveAvailableUsername, normalizeSeed,
  validateWorldCreate, parseIdentityCredential, buildLaunchUrl, safeEqualText,
} from '../apps/hub/src/lib.mjs'

test('world IDs are canonical lowercase 80-bit IDs', () => {
  for (let i=0;i<100;i++) assert.match(randomWorldId(), WORLD_ID_RE)
})

test('identity IDs are canonical lowercase IDs', () => {
  for (let i=0;i<20;i++) assert.match(randomIdentityId(), /^u_[a-f0-9]{20}$/)
})

test('tokens have high entropy and URL-safe alphabet', () => {
  const seen=new Set(); for(let i=0;i<100;i++){const t=randomToken(32); assert.match(t,/^[A-Za-z0-9_-]{40,}$/);seen.add(t)}
  assert.equal(seen.size,100)
})

test('display names accept Hudson / Elise style names but reject markup', () => {
  assert.equal(sanitizeDisplayName('  Hudson   Elise  '),'Hudson Elise')
  assert.throws(()=>sanitizeDisplayName('<script>'))
  assert.throws(()=>sanitizeDisplayName('x'.repeat(33)))
})

test('world names normalize whitespace and reject control-character injection', () => {
  assert.equal(sanitizeWorldName('  Hudson   +   Elise  '), 'Hudson + Elise')
  assert.throws(()=>sanitizeWorldName(''))
  assert.throws(()=>sanitizeWorldName('bad\nworld'))
  assert.throws(()=>sanitizeWorldName('x'.repeat(65)))
})

test('minecraft base names are valid', () => {
  assert.match(baseMcUsername('Hudson-Elise'), MC_USERNAME_RE)
  assert.ok(baseMcUsername('Very Very Very Long Name').length<=16)
})

test('allocated Minecraft login names are unguessable-looking and unique', async () => {
  const used=new Set(); const exists=async x=>used.has(x)
  const a=await deriveAvailableUsername('Hudson',exists);used.add(a)
  const b=await deriveAvailableUsername('Hudson',exists)
  assert.match(a,MC_USERNAME_RE); assert.match(b,MC_USERNAME_RE); assert.notEqual(a,b)
  assert.notEqual(a.toLowerCase(),'hudson')
})

test('numeric Minecraft seeds enforce signed 64-bit range', () => {
  assert.equal(normalizeSeed('9223372036854775807'),'9223372036854775807')
  assert.equal(normalizeSeed('-9223372036854775808'),'-9223372036854775808')
  assert.throws(()=>normalizeSeed('9223372036854775808'))
  assert.throws(()=>normalizeSeed('-9223372036854775809'))
})

test('text seeds remain supported', () => {
  assert.equal(normalizeSeed('Hudson + Elise'),'Hudson + Elise')
  assert.throws(()=>normalizeSeed('bad\nseed'))
})

test('world creation validates defaults and explicit modes', () => {
  assert.deepEqual(validateWorldCreate({name:'  Our World  ',kind:'shared',gameMode:'creative',difficulty:'hard',seed:'42'}),
    {name:'Our World',kind:'shared',gameMode:'creative',difficulty:'hard',allowCommands:true,worldType:'normal',generateStructures:true,seed:'42'})
  assert.deepEqual(validateWorldCreate({name:'Solo'}),{name:'Solo',kind:'solo',gameMode:'survival',difficulty:'normal',allowCommands:true,worldType:'normal',generateStructures:true,seed:''})
  assert.equal(validateWorldCreate({name:'No Commands',allowCommands:false}).allowCommands,false)
  assert.deepEqual(validateWorldCreate({name:'Hardcore',gameMode:'hardcore',difficulty:'peaceful',worldType:'amplified',generateStructures:false}),{name:'Hardcore',kind:'solo',gameMode:'hardcore',difficulty:'hard',allowCommands:true,worldType:'amplified',generateStructures:false,seed:''})
  assert.equal(validateWorldCreate({name:'Flat',worldType:'flat'}).worldType,'flat')
})

test('identity credential parser rejects malformed credentials', () => {
  assert.equal(parseIdentityCredential('bad'),null)
  assert.equal(parseIdentityCredential('u_0123456789abcdefabcd.short'),null)
  assert.deepEqual(parseIdentityCredential('u_0123456789abcdefabcd.'+'x'.repeat(32)),{id:'u_0123456789abcdefabcd',secret:'x'.repeat(32)})
})

test('launch URL is fixed to 1.21.5 and keeps auth secret in fragment', () => {
  const u=new URL(buildLaunchUrl({gameClientUrl:'https://client.example/',proxyUrl:'https://play.example',destinationHost:'orchestrator',port:31042,username:'Hudso_abcd123456',token:'SUPERSECRET'}))
  assert.equal(u.searchParams.get('version'),'1.21.5')
  assert.equal(u.searchParams.get('ip'),'orchestrator:31042')
  assert.equal(u.searchParams.get('autoConnect'),'true')
  assert.equal(u.searchParams.get('lockConnect'),'true')
  assert.equal(u.search.includes('SUPERSECRET'),false)
  assert.equal(new URLSearchParams(u.hash.slice(1)).get('hemToken'),'SUPERSECRET')
})

test('constant-time-style text equality returns correct result', () => {
  assert.equal(safeEqualText('abc','abc'),true); assert.equal(safeEqualText('abc','abd'),false); assert.equal(safeEqualText('a','aa'),false)
})
