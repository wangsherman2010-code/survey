# Speech Survey

Mobile-first feedback form + QR code + results dashboard.

```bash
npm install
ADMIN_KEY=your-secret BASE_URL=https://your-public-url node server.js
```

- `/` – the survey participants see (optional name, or submit anonymously)
- `/admin?key=your-secret` – QR code, live results, CSV download
- `/qr.svg` – printable/projectable QR code
- Edit `questions.json` to change questions (types: `rating`, `choice`, `text`); restyle in `public/style.css`.
- Responses are stored in `data/responses.jsonl` (set `DATA_DIR` to a persistent disk when deploying).
- Anonymous submissions never store a name.

The QR code must point to a public URL – deploy to any Node host (Render, Railway, Fly.io) and set `BASE_URL`.
