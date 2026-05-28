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

Production builds can call a deployed backend by setting:

```text
VITE_API_BASE_URL=https://<user-or-org>-<space-name>.hf.space
```

For the recommended deployment, Vercel serves only the frontend and Hugging Face
Spaces serves the FastAPI/Open3D backend.

## Tests

```powershell
cd D:\CHI\frontend
npm test
```
