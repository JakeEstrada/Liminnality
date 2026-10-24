# Backend

Express API for Liminnality.

## Scripts

```bash
npm run dev      # nodemon, port 4000
npm start        # production
```

## Environment

See `backend/.env` — at minimum `MONGODB_URI`, `JWT_SECRET`, `CORS_ORIGINS`.

## Documentation

- [API route map](../docs/BACKEND.md)
- [Architecture](../docs/CODEBASE.md)

## Structure

```
src/
├── server.js        Entry: CORS, tenant middleware, routes, Socket.IO
├── routes/          HTTP path → controller function
├── controllers/     Business logic
├── models/          Mongoose schemas (+ tenantScopePlugin)
├── middleware/      auth, upload, tenant context, RFID device key
└── services/        email, socket, event bus, assistant site map
```
