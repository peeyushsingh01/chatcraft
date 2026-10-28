# ChatCraft

WhatsApp-style chat app: 1:1 and group chats, photos, voice notes, emoji picker + reactions,
typing indicators, read receipts, online presence, and 1:1 voice/video calls.

Static front end (Vite + Tailwind, vanilla JS) deployed on Vercel. Backend is Supabase
(open-source Postgres + Auth + Realtime + Storage). Vercel can't hold WebSocket connections,
so realtime comes from Supabase.

## 1. Backend (once)

1. Create a Supabase project, or self-host Supabase (see "Free forever" below).
2. SQL editor -> paste and run `supabase/schema.sql`.
3. Authentication -> Providers -> Email -> turn **off** "Confirm email" for instant sign-up
   (or leave it on; the app tells users to confirm by email).
4. Project Settings -> API -> copy the project URL and the `anon` public key.

## 2. Run locally

```bash
cp .env.example .env     # fill in the two values
npm install
npm run dev
```

## 3. Deploy to Vercel

```bash
git init && git add . && git commit -m "ChatCraft"
# push to GitHub, then in Vercel: Add New -> Project -> import the repo
```

Framework preset is auto-detected (Vite). Add these environment variables, then deploy:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Or with the CLI: `npx vercel` (add the env vars with `vercel env add`).

## Free forever

The hosted Supabase free tier has caps and pauses inactive projects. The app only needs a
URL and anon key, so you can self-host the open-source Supabase stack (Docker) and point
the two env vars at it with no code changes. The self-hosted server must be reachable over
HTTPS from the internet for the Vercel site to use it.

## Known limits

- Calls use Google STUN. Strict NATs/mobile carriers need a TURN server; set `VITE_ICE_SERVERS`
  (self-host coturn to stay free).
- The `chat-media` bucket is public: files have unguessable UUID paths but anyone with a URL can open it.
- Call signaling, typing and presence use public Realtime channels (no private-channel auth).
  Presence uses one shared channel, which is fine for hundreds of users, not tens of thousands.
- Messages can't be edited or deleted yet. Calls are 1:1 only.
