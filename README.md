# Realtime Streaming Churn Intelligence Dashboard

Dark, animated full-stack dashboard that simulates customer behavior and predicts churn risk across:
- Netflix
- Amazon Prime
- JioHotstar
- Crunchyroll
- Aha

## Stack
- Frontend: React + Vite + Framer Motion + Recharts + Socket.IO client
- Backend: Node.js + Express + Socket.IO
- Realtime: WebSocket push every 2.5 seconds with updated analytics

## Run
```bash
npm install
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:4000`

## Run with your dataset
Backend defaults to:
- `D:/bhuvan/E_Commerce_Customer_Churn_With_Support_Tickets.csv`

To use a different CSV path (Windows cmd):
```bash
set DATASET_PATH=D:\path\to\your\data.csv && npm run dev --prefix server
```

## APIs
- `GET /health`
- `GET /api/snapshot`

## Notes
- Backend includes a weighted churn scoring model using session depth, inactivity, stream failures, billing friction, and catalog affinity.
- Dashboard includes glassmorphism cards, neon gradients, particle overlay, animated metrics, live pulse feed, and alert stack.
