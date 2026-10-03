# Phase 1 — Auth & data isolation

**Goal:** users can sign up, log in, and log out; every protected route requires a session; ownership is enforced by one pattern every later endpoint reuses.
**Covers:** FR-1, FR-2, NFR-S1, NFR-S2, NFR-S3, NFR-R12, NFR-S9 (auth part).
**Depends on:** Phase 0

## Scope

### packages/shared
- [ ] `signUpSchema` (email, password 8–128) and `signInSchema`. Used by both the forms and the API.

### apps/api
- [ ] better-auth config:
  - `emailAndPassword: { enabled: true, minPasswordLength: 8, maxPasswordLength: 128 }`.
  - Prisma adapter for `user`, `account`, `verification`. Generate the models with the better-auth CLI, then add a migration.
  - `secondaryStorage` via `@better-auth/redis-storage` (ioredis). Sessions live **only** in Redis.
  - `rateLimit: { enabled: true, storage: 'secondary-storage' }` with a stricter custom rule for `/sign-in/email`.
  - Client IP from `X-Forwarded-For` (better-auth IP header setting), as verified in the Phase 0 spike; without it every user shares the proxy's counter (AC-1.6).
  - Cookies: `httpOnly`, `SameSite=Lax`, `Secure` outside localhost. `trustedOrigins` = web origin.
- [ ] `@thallesp/nestjs-better-auth`: global `AuthGuard` (protected by default), `@AllowAnonymous()` on `/health`, `/ready`, and auth routes. `@CurrentUser()` decorator that returns `{ id }` only.
- [ ] **Fail closed when Redis is down** (NFR-R12): a session lookup error must become `503 SERVICE_UNAVAILABLE`, never "anonymous" and never "authenticated". Map it in the exception filter.
- [ ] **Origin check** middleware for mutating methods on non-auth routes: reject when `Origin` is absent or not the web origin. Accept only `application/json` and `multipart/form-data` bodies (NFR-S3).
- [ ] **Ownership pattern** (NFR-S2), used by every later module:
  - Repository methods always take `userId` (`findOwned(id, userId)`, `listOwned(userId)`, `deleteOwned(id, userId)`).
  - Not found **or** not owned → `404 NOT_FOUND`. Never `403`.
  - `userId` / `ownerId` in request bodies is stripped by the Zod pipe; the owner always comes from the session (AC-2.3).
- [ ] `GET /api/cvs` stub returning `[]` through the ownership pattern, so the dashboard has something to call.

### apps/web
- [ ] `/signup` and `/login` pages: react-hook-form + `zodResolver(shared schema)` + shadcn `Field`. Base UI inputs via `register` / `Controller`, form `noValidate`, `aria-invalid` on errors, `autocomplete="email" / "new-password" / "current-password"`.
- [ ] Server errors: `400 fields` → `form.setError`. Invalid credentials → the generic "Invalid email or password". `429` → "Too many attempts, try later".
- [ ] Route protection: Next middleware does a cheap cookie-presence redirect to `/login`; the authoritative check is the API's `401`, handled by `apiFetch`.
- [ ] Dashboard placeholder at `/` with a "Log out" button.

## Tests (e2e against real Postgres + Redis)
- Sign-up creates the account and sets an httpOnly cookie (AC-1.1).
- Duplicate email → error, existing account unchanged (AC-1.2).
- Wrong password and unknown email return the same generic error (AC-1.3).
- After logout the old cookie gets `401`, and the session key is gone from Redis (AC-1.4).
- No cookie → `401` on a protected route (AC-1.5).
- Exceeding the sign-in limit → `429`; the counter survives an API restart (AC-1.6). Two different `X-Forwarded-For` addresses have separate counters.
- Redis stopped → an authenticated call returns `503` (NFR-R12).
- `POST` with a foreign `Origin` → rejected.
- A body containing `userId` is ignored (AC-2.3). The full cross-user matrix comes in Phase 6 once all endpoints exist.

## Definition of done
- Sign up → dashboard → log out → redirected to login, working at 360 px.
- All tests above are green.
- **Docs updated.** CLAUDE.md: the ownership rule (repositories always take `userId`; not found or not owned → `404`; owner only from the session), routes are protected by default and `@AllowAnonymous()` is the explicit exception, Redis failure → `503`. README: the auth model (users in Postgres, sessions and rate-limit counters in Redis).
