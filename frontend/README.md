# Frontend

React + deck.gl interface for the CHI drone visual exposure prototype.

## Development

```powershell
cd D:\CHI\frontend
npm install
npm run dev
```

The app reads the backend base URL from `VITE_API_BASE_URL`.

Local development uses `.env.development`:

```text
http://127.0.0.1:8011
```

Production builds default to the same origin, so Vercel should normally leave
`VITE_API_BASE_URL` unset and call `/api/...` on the deployed domain.

## Tests

```powershell
cd D:\CHI\frontend
npm test
```
