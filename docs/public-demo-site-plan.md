# WolfMart — public demo site plan

A public, unauthenticated e-commerce site the SE team can drive live in front of
prospects to show what QA Wolf catches. Built to be broken on purpose.

Status: **plan, not yet built.** Branch `feat/public-demo-site` carries this doc
only; the site itself lives in a separate repo (see [Security boundary](#security-boundary)).

---

## 1. Why a demo site

Today an SE demoing QA Wolf either uses the prospect's own app (slow to set up,
can't be broken safely) or a canned recording (no live proof). WolfMart gives
every SE a URL they can open on a call, break with one toggle, and watch QA Wolf
catch — in under a minute, with no prospect-side setup.

It is a **prop with a real backend**, not a marketing page. Every flow must
actually work, because the demo's credibility comes from the failures being real.

## 2. What it is

**WolfMart** — a fictional consumer storefront. Obviously fictional branding, QA
Wolf's own; it must never look like a real retailer.

| Surface      | Flows                                                                  |
| ------------ | ---------------------------------------------------------------------- |
| Catalog      | search, facet filters, sort, pagination, empty states                  |
| Product      | variants (size/color), stock states, image gallery, reviews            |
| Cart         | add/remove, quantity, promo codes, totals, persistence across sessions |
| Checkout     | 4 steps — contact → shipping → payment (fake) → review → confirmation  |
| Account      | sign up, sign in, password reset, order history, addresses             |
| Support chat | live widget + an agent-side view an SE can drive                       |
| AI assistant | Claude-backed shopping helper with real catalog tools                  |
| Demo control | hidden panel that injects specific bugs on demand                      |

E-commerce is the right shape because it packs the flows prospects actually ask
about — multi-step checkout, auth, stateful inventory, payment forms — into a
domain that needs no explanation on a call.

## 3. Security boundary

> **Requirement: the public URL must never be able to reach SalesWolf.**

SalesWolf's single Heroku dyno (`qa-sales-engineering`) holds live Salesforce
credentials, a Notion token, a Linear API key, `JWT_SECRET`,
`INTEGRATION_ENCRYPTION_KEY`, and the production `DATABASE_URL`. Anything running
in that process is one route-mount mistake from reachable. So the isolation is at
the **deploy boundary**, not enforced by middleware.

Six controls, in order of how much they actually buy:

### 3.1 Separate repo, separate Heroku app, separate database

New GitHub repo `qa-wolf-demo-shop`, its own Heroku app, its own Postgres addon.
No submodule, no shared package, no code import from `sales-engineer-toolkit`.
None of the SalesWolf config vars are ever set on the demo app — it gets its own
`DEMO_JWT_SECRET` and its own `DATABASE_URL`. Two processes, two envs, two DBs.

### 3.1a Same Heroku team, never the same app

The SalesWolf app is owned by the `qa-wolf` Heroku **team** (an app whose owner
reads `<team>@herokumanager.com` is team-owned). WolfMart is created in that same
team — `heroku create sales-wolf-demo-shop --team qa-wolf` — which keeps access
control and billing in one place and costs the boundary nothing: apps in a Heroku
team still get separate dynos, separate config vars, and separate addons.

What a shared team does is put one breach within reach of a single command:

```bash
# NEVER. Sets SalesWolf's production DATABASE_URL on the public demo app.
heroku addons:attach <saleswolf-postgres> -a sales-wolf-demo-shop
```

`addons:attach` shares one addon across apps. Every control in this section would
still pass while the demo read live opportunity data, because nothing in the repo
or the running process would look wrong — the credential arrives as ordinary
config. The same applies to piping `heroku config:get` from one app into
`config:set` on the other.

WolfMart provisions its **own** `heroku-postgresql` addon, always. And it is never
added to a SalesWolf pipeline: pipelines promote one codebase through stages, and
these are two codebases.

### 3.2 Server-side egress allowlist ← the real teeth

The demo server makes exactly one class of outbound call: the Anthropic API. So
install a global `undici` dispatcher at boot that permits only `api.anthropic.com`
and rejects every other host, with `saleswolf.com`, `*.saleswolf.com`, and
`*.herokuapp.com` named in an explicit denylist for legibility.

This is what survives an SSRF bug. The AI assistant takes arbitrary public input
and is the most likely vector; a prompt-injected fetch to an internal host dies at
the dispatcher rather than at our good intentions.

### 3.3 Browser-side CSP

`connect-src 'self' ` plus a `default-src` lockdown, so page JavaScript can't call
SalesWolf either — closing the client half of the same hole. No link, form action,
or image on the site points at a SalesWolf host.

### 3.4 Never a `*.saleswolf.com` subdomain

Subtle and easy to get wrong later: if SalesWolf ever sets a cookie scoped to
`.saleswolf.com`, a `demo.saleswolf.com` deployment would **receive it on every
request**. The demo lives on `qa-wolf-demo-shop.herokuapp.com` or a distinct apex
(e.g. `wolfmart.dev`). Write this down wherever the DNS lives — it is the kind of
constraint that gets undone by a well-meaning "let's put it on our domain" ticket.

### 3.5 No real data, ever

Seeded fictional products, fictional customers, fake payment (never a real
processor, never real card input). Nightly scheduled reset wipes orders, carts,
chat transcripts, and accounts back to seed — so a prospect can't read the last
prospect's session, and every demo starts clean.

### 3.6 CI guard

A test that fails the build if `saleswolf`, `qa-sales-engineering`, or any
`SALESFORCE_*` / `NOTION_*` / `LINEAR_*` identifier appears anywhere in the repo,
plus an assertion that the egress allowlist is installed before the server listens.
Prevents drift once other people start committing.

## 4. Stack

Mirror SalesWolf so the SE team can extend the demo without learning a new stack:
React 19 + Vite + React Router, Express 5, Prisma + Postgres, LESS, ESM, Node
24.16.0, ESLint + Prettier + Husky, `node --test`. Same Procfile shape
(`release: prisma migrate deploy`, `web: npm start`), backend serving
`frontend/dist`.

Deliberately **not** Next.js — no SEO or SSR need here, and it would put the demo
on an idiom the team doesn't already use.

Unlike SalesWolf, this repo gets a real frontend test suite from day one
(Vitest + Playwright). The demo site being well-tested is itself part of the pitch.

## 5. Data model

Its own Prisma schema — one file, Postgres only, no SQLite split.

> **Deferred to P1 (2026-09-03).** `prisma/schema.prisma` exists in the demo repo
> as a record of intent, but Prisma is **not** a dependency and nothing connects
> to a database yet. `@prisma/client`'s postinstall discovers the schema and runs
> `generate`, which blocks on engine download at 0% CPU indefinitely — it hung
> the CI runner for eight minutes and hangs locally too, so it is not one bad
> network. P0 opens no database connection, so carrying it bought nothing and
> broke the build. P1 reinstates it with real models to generate, restores the
> Procfile release phase, and debugs the engine download properly.

- **Catalog** — `Product`, `ProductVariant`, `Category`, `Review`
- **Commerce** — `Cart`, `CartItem`, `Order`, `OrderItem`, `Address`, `PromoCode`
- **Identity** — `DemoUser`, `PasswordResetToken`
- **Chat** — `ChatConversation`, `ChatMessage`
- **AI** — `AssistantSession`, `AssistantMessage` (for rate limiting + transcript review)
- **Demo** — `ChaosFlag`

Seed: ~40 products across 6 categories with images, stock levels, and reviews,
plus 3 demo accounts at known credentials. `npm run demo:reset` re-seeds, and
Heroku Scheduler runs it nightly.

## 6. Feature specs

### 6.1 Auth

Email + password, bcrypt, JWT in an httpOnly + Secure + SameSite=Lax cookie.
Sign up, sign in, sign out, protected account routes.

Password reset with no email infrastructure: the reset token is surfaced on a
`/demo-inbox` page so an SE can complete the whole reset flow live on a call.
Small touch, disproportionate demo value — the reset flow is one prospects always
ask about and one nobody can usually show end to end.

Seeded accounts (`demo@wolfmart.test` etc.) with a printed credential card in the
repo README so any SE can pick it up cold.

### 6.2 Live chat

socket.io (already a dependency the team knows). Customer widget on every page,
plus an agent console at `/agent` so one SE can play both sides live.

Covers: open/close, send/receive, typing indicator, unread badge, message history
on reload, and reconnect after a dropped socket. Real-time is the case where
manual testing is worst and QA Wolf's value is most obvious.

### 6.3 AI shopping assistant

Claude-backed, using the official SDK (`@anthropic-ai/sdk`) with
`client.beta.messages.toolRunner` so we write tools, not a loop. Tools operate
only on the public catalog: `search_products`, `check_stock`, `add_to_cart`,
`get_order_status` (scoped to the signed-in demo user).

- Model `claude-opus-5`, `output_config: { effort: "low" }`, streaming to the
  widget. Low effort is right for a chat surface — it keeps latency demo-friendly
  without dropping to a weaker model.
- The assistant is a **testing showcase, not a product**: it demonstrates QA Wolf
  exercising a non-deterministic surface, which is a live question for prospects.

Because the endpoint is public and spends money, it needs, non-negotiably:
per-IP and per-session rate limits, a message cap per conversation, a hard monthly
spend ceiling with the route disabling itself when hit, `max_tokens` bounded, and
the egress allowlist from §3.2. The assistant is given catalog data only — no
secrets, no PII, nothing that would make prompt injection profitable.

### 6.4 Demo control panel

Hidden route `/demo-control`, gated by a shared passphrase and `noindex`. Flags
live in the DB and are read by middleware (server) and a context (client):

| Flag               | What breaks                          | What QA Wolf catches             |
| ------------------ | ------------------------------------ | -------------------------------- |
| `checkout_500`     | Checkout submit returns 500          | Failed order completion          |
| `cart_total_drift` | Totals off by $1                     | Wrong assertion on order summary |
| `search_latency`   | Search takes 4s                      | Timeout / perf regression        |
| `login_flake`      | Login fails 1 in 3                   | Flaky-auth detection across runs |
| `stock_race`       | Stock check passes, checkout rejects | Race condition at purchase       |
| `image_404`        | Product images 404                   | Broken-asset detection           |
| `promo_expired`    | Valid promo silently rejected        | Discount logic regression        |

Each flag carries its own "what this proves" copy, so the panel doubles as a
script for a newer SE. One **Reset all** button.

## 7. Build phases

| Phase  | Scope                                                                 | Done when                                                          |
| ------ | --------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **P0** | New repo, stack scaffold, CI, all six §3 controls, hello-world deploy | The public URL is live and a test proves it cannot reach SalesWolf |
| **P1** | Prisma + DB wiring, catalog, product, cart, checkout, seed data       | A prospect can complete a purchase end to end                      |
| **P2** | Auth, account, order history, demo inbox                              | Sign up → buy → see the order in history                           |
| **P3** | Live chat + agent console                                             | Two browsers hold a conversation through a reconnect               |
| **P4** | AI assistant + all its limits                                         | Assistant adds a real product to a real cart, within budget        |
| **P5** | Demo control panel, nightly reset, SE runbook                         | An SE flips a flag on a call and the suite goes red                |

P0 ships the security boundary **before** any feature code, so the constraint is
proven rather than retrofitted. Each phase is independently demoable.

**P0 status: complete and deployed (2026-09-04).**

- Repo: `Reptar007/sales-wolf-demo-shop` (private)
- Live: <https://sales-wolf-demo-shop-412cd1b2d1fd.herokuapp.com/>
- Heroku app owned by the `qa-wolf` team, its own dyno, no addons, no shared config
- CI green across isolation, quality, and build

Verified against the deployed URL, not just localhost: `/api/health` reports
`egressAllowlist.installed: true` under `environment: production`, and every
response carries the full CSP plus `X-Frame-Options: DENY`, `nosniff`,
`no-referrer`, and `noindex`. 10 boundary tests pass, including live assertions
that `fetch`, `https.request`, and `http.get` to SalesWolf are each refused.

Two plan changes forced by reality, both committed in the demo repo:

1. **Prisma deferred to P1** — its postinstall hangs on engine download at 0% CPU,
   which stalled CI for eight minutes and would have stalled the Heroku build the
   same way. P0 opens no database connection, so it was speculative weight that
   happened to be broken. §5 has the detail.
2. **`heroku-postbuild` must pass `--include=dev`** — Heroku builds with
   `NODE_ENV=production`, which omits devDependencies, and `vite` is one. Without
   it the deploy fails with `sh: vite: command not found`.

## 8. Decisions (settled 2026-09-03)

| Question         | Decision                                                                              |
| ---------------- | ------------------------------------------------------------------------------------- |
| Repo + app name  | `sales-wolf-demo-shop`                                                                |
| Domain           | `sales-wolf-demo-shop.herokuapp.com` — not a `saleswolf.com` subdomain, so §3.4 holds |
| Repo owner       | Personal account, same as `sales-engineer-toolkit`                                    |
| Anthropic key    | Reuse the existing key **for now** — see the carve-out below                          |
| QA Wolf coverage | Sebastian sets up the workspace later; P5 leaves the hook                             |

### Carve-out: the shared Anthropic key

Reusing SalesWolf's `ANTHROPIC_API_KEY` does not weaken §3 — an API key is not a
network path to SalesWolf, and every control in §3 still holds. What it does cost
is **blast radius**: the assistant route is public, so if that key ever leaks or
gets run up, it takes SalesWolf's LLM features down with it, and there is no way
to cap the demo's spend separately from SalesWolf's.

So the code treats it as temporary: the key is read from one env var
(`ANTHROPIC_API_KEY`) with no other coupling, so swapping in a dedicated key with
its own spend cap is a Heroku config change and **no code change at all**. The
per-IP, per-session, and message-count limits in §6.3 ship regardless — they are
what actually bounds spend until a separate key exists.

Revisit before the site is handed to anyone outside the SE team.

### Note on the CI guard and the repo's own name

`sales-wolf-demo-shop` contains the string `sales-wolf`, which is one hyphen away
from the `saleswolf` the §3.6 guard bans. The guard matches `saleswolf` (no
hyphen), `qa-sales-engineering`, and the SalesWolf env-var prefixes — so the repo
name does not trip it. Worth knowing before someone "fixes" the pattern to be
fuzzier and breaks the build on the repo's own name.
