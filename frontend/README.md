# Frontend

React + Vite SPA for Liminnality.

## Scripts

```bash
npm run dev      # http://localhost:5173
npm run build    # output: dist/
```

## Environment

```env
VITE_API_URL=http://localhost:4000
```

## Documentation

- [Page reference](../docs/PAGES.md) — every route and what it does
- [Components](../docs/COMPONENTS.md) — shared UI
- [Codebase guide](../docs/CODEBASE.md) — auth, API, conventions

Page files include a header comment linking to the docs.

## Structure

```
src/
├── pages/           Route-level screens (start here when learning the app)
├── components/      Reusable UI (pipeline, jobs, layout, …)
├── context/         AuthContext, ThemeContext
├── hooks/           Socket subscriptions, profile photo, …
├── utils/           axios client, branding, caches
└── App.tsx          Router
```
