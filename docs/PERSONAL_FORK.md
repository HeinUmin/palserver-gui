# Personal noncommercial fork

This fork enables the features in `EARLY_ACCESS_FEATURES` locally without a
sponsor identification code. Both Agent checks and the web UI use the local
`personal-noncommercial` entitlement. Missing, invalid, expired, or offline
sponsor records do not disable these features. Background license refresh is a
no-op; manual code activation/removal APIs remain for compatibility.

Build and run this branch from source using the existing development/build
instructions. Existing upstream binaries or Docker images do not contain this
change. An upstream self-update can replace this personal build.

This change does not provide access to upstream hosted services. Cloud endpoints,
external accounts, platform requirements, game mods, and normal authentication
and runtime safety checks still apply.

The original [LICENSE.md](../LICENSE.md), copyright, third-party notices, and
sponsorship links are retained. This fork is for personal noncommercial use and
does not grant commercial rights or claim verified upstream sponsor status.

Validation:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm --filter @palserver/agent exec tsx --test src/license.test.ts
```
