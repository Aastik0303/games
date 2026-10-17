# Prism (games)

A social puzzle platform: solo puzzles, matchmaking, private rooms with live games and chat, Watch Together, and an admin dashboard.

| Folder | What's inside |
|---|---|
| [`frontend/`](frontend/) | Next.js 16 + TypeScript + Tailwind web app. It runs on a built-in mock backend until a real API is connected. |

## Run it

```bash
cd frontend
npm install
npm run dev      # http://localhost:3000 (mock data)
```

See [`frontend/README.md`](frontend/README.md) for setup, architecture, tests and known gaps. See [`frontend/docs/API_CONTRACT.md`](frontend/docs/API_CONTRACT.md) for the REST and WebSocket contract the backend must implement.
