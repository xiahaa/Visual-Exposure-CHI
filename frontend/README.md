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

## Study Entry Points

```text
/setup
  Facilitator setup and non-recording cell previews.

/runner?lang=en&entry_token=<opaque-questionnaire-token>
  Main-study runner. The backend assigns the A-D x M/S/V cell and returns a
  completion code after required milestones are recorded.

/runner?role=facilitator&preview=disclosure&profile=C&disclosure=V
  Researcher preview. This mode does not create a study record or completion
  code.
```

Participant URLs must not contain or rely on `profile` or `disclosure`; those
parameters are honored only in facilitator mode.

## Tests

```powershell
cd D:\CHI\frontend
npm test
npm run build
```
