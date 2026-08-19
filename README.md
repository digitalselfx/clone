# Reflection Clone — Phase 1 Backend

Persistent backend for the interview + personality + chat prototype: Postgres
for storage, Express for the API, Claude for the clone's responses.

## Local setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in `DATABASE_URL` and `ANTHROPIC_API_KEY`
3. `npm run migrate` — creates the tables (and enables `pgvector` for Phase 2)
4. `npm start` — runs on `http://localhost:3000`

## Deploying on Railway (alongside Management Twin)

1. Add a new Postgres instance to your Railway project (or reuse an existing one with a separate schema)
2. Enable the `vector` extension: Railway's Postgres supports this via `CREATE EXTENSION vector;` — the migration script does this for you
3. Push this repo as a new Railway service, pointing `DATABASE_URL` at the Postgres instance's connection string
4. Set `ANTHROPIC_API_KEY` in the service's environment variables
5. Railway auto-assigns a `PORT`; the server already reads `process.env.PORT`

## API

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/users` | Create a user with a unique `slug` (e.g. `"vladimir"`), get back an `id` |
| POST | `/api/profile/:userId` | Save one interview answer `{ key, value }` |
| GET | `/api/profile/:userId` | Get all interview answers |
| POST | `/api/personality/:userId` | Save Big Five scores `{ scores: { O, C, E, A, N } }` |
| GET | `/api/personality/:userId` | Get Big Five scores |
| POST | `/api/chat/:userId` | Send a message `{ message }`, get the clone's reply, both persisted |
| GET | `/api/chat/:userId` | Get full chat history |
| GET | `/api/me` | Resolves the user from the request's subdomain (e.g. `vladimir.digital-selfx.com`) |
| POST | `/api/me/chat` | Same as `/api/chat/:userId` but resolved from the subdomain instead of a path param |

## Frontend

A plain HTML/CSS/JS chat UI lives in `public/` and is served by this same
Express app — no build step, no separate deployment. It's served identically
at every subdomain; on load it calls `/api/me` to figure out which clone it
is (via the `Host` header) and walks the visitor through claiming the name,
the interview, the personality check-in, and then the chat — resuming from
wherever they left off on repeat visits.

If no user exists yet for a subdomain, the page shows a "claim this name"
step that creates the user with that slug before starting the interview.

## Subdomain routing (digital-selfx.com)

Each clone lives at `<slug>.digital-selfx.com`. The server reads the `Host`
header on every request, strips `ROOT_DOMAIN` from it, and looks up a user by
the remaining slug — that's what `/api/me` and `/api/me/chat` use. Set
`ROOT_DOMAIN` in `.env` to match your domain. See the DNS setup steps for
pointing `*.digital-selfx.com` at this service on Railway.

## What's deliberately not here yet

- Auth (every request trusts the `userId` in the URL — fine for solo testing, not for real users)
- The `knowledge_chunks` table exists in the schema for Phase 2 (email ingestion + RAG) but has no endpoints yet
- Rate limiting / abuse protection on the chat endpoint
