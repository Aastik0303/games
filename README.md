# Prism (games)

A social puzzle platform: solo puzzles, matchmaking, private rooms with live games and chat, Watch Together, and an admin dashboard.

| Folder | What's inside |
|---|---|
| [`frontend/`](frontend/) | Next.js 16 + TypeScript + Tailwind web app. It runs on a built-in mock backend unless `NEXT_PUBLIC_API_MODE=http` |
| [`backend/`](backend/) | FastAPI + Redis + PostgreSQL API implementing [`frontend/docs/API_CONTRACT.md`](frontend/docs/API_CONTRACT.md) |

## Run it

Full stack (needs Docker):

```bash
docker compose up --build    # http://localhost:3000 (UI), http://localhost:8000/docs (API)
```

Frontend only, with mock data:

```bash
cd frontend
npm install
npm run dev      # http://localhost:3000
```

Backend only: see [`backend/README.md`](backend/README.md). It can run without Redis using `PRISM_REDIS_URL=memory://`.

CI (`.github/workflows/ci.yml`) lints, type-checks and tests both apps, runs the backend suite against a real Redis, and builds both images.
