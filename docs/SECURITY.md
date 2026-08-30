# HEM security model

## Threat model

The HEM website can be publicly reachable without making the game worlds public.

### Household registration

New device identities require `HOUSEHOLD_CODE`. After registration the browser stores a long recovery credential. Export the HEM device backup before clearing browser storage.

### Private Minecraft login name

Paper must run `online-mode=false` because the browser client is not using Microsoft Java authentication. HEM therefore allocates a random private Minecraft login name unrelated to the visible display name. Knowing “Hudson” or “Elise” is not enough to guess the account accepted by the game server.

### Membership

The Hub checks world membership before it asks the orchestrator to start a world or issues a launch session.

### Invites

Shared-world invites are random, hashed at rest, seven-day and one-use by default. Redeeming one creates durable membership; the invite is not needed again.

### Launch sessions

Launch sessions are:

- random and hashed at rest;
- valid for 90 seconds;
- bound to one exact world;
- bound to one exact private Minecraft login name;
- atomically marked consumed by D1 before HEMGate unlocks the player.

The raw launch token is placed in the URL **fragment**, not the query string. Browsers do not send URL fragments in HTTP requests. The HEM client erases the fragment immediately after reading it.

### Paper gate

Until HEMGate accepts the token, a joining player is frozen, invulnerable/non-collidable and blocked from block changes, interactions, inventory changes, drops, pickup, damage, food changes and unrelated commands. Failed/expired authorization is kicked.

### Proxy

The proxy is not a generic TCP relay. Its destination allowlist is generated only for the orchestrator host and the configured world port range. Raw Paper ports are not published from production Docker Compose.

### Administrative control

`/internal/*` requires `ORCHESTRATOR_KEY`. The arbitrary command endpoint exists only for the automated acceptance environment and is disabled unless `HEM_ENABLE_ADMIN_COMMANDS=true`; production Compose never enables it.

## Secrets

Never commit:

- `HOUSEHOLD_CODE`
- `IDENTITY_PEPPER`
- `SERVER_SERVICE_KEY`
- `ORCHESTRATOR_KEY`
- Cloudflare API token
- R2 credentials

Generate long random values and use Cloudflare Worker secrets / a VPS environment file with restricted filesystem permissions.
