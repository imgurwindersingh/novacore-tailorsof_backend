# novacore-tailorsof — Backend

REST API for the TailorSoft application, built with **Hono** + **Prisma** (SQLite / Cloudflare D1).  
Deploy independently from the frontend — any Node.js host works (Railway, Render, Fly.io, etc.).

---

## Stack

| Layer      | Technology                         |
|------------|------------------------------------|
| Runtime    | Node.js 20+                        |
| Framework  | [Hono](https://hono.dev)           |
| ORM        | Prisma 7 (better-sqlite3 adapter)  |
| Auth       | JWT via `jose` (Bearer token)      |
| Validation | Zod                                |

---

## Project structure

```
backend/
├── prisma/
│   └── schema.prisma          # Database schema
├── src/
│   ├── index.ts               # Entry point – starts Hono server
│   ├── lib/
│   │   ├── auth.ts            # JWT helpers (sign / verify)
│   │   ├── constants.ts       # Shared enums & labels
│   │   ├── money.ts           # Rupee ↔ paise helpers
│   │   ├── prisma.ts          # Singleton Prisma client
│   │   ├── types.ts           # Shared TypeScript types & ServiceResult
│   │   └── validators/        # Zod schemas (auth, client, common)
│   ├── middleware/
│   │   └── auth.middleware.ts # requireAuth – validates Bearer JWT
│   ├── routes/
│   │   ├── auth.routes.ts     # POST /api/auth/login  GET /api/auth/me
│   │   ├── clients.routes.ts  # CRUD /api/clients
│   │   ├── dashboard.routes.ts# GET  /api/dashboard/stats|recent-clients|upcoming-deliveries
│   │   ├── orders.routes.ts   # PATCH /api/orders/:id/deliver|revert-delivery
│   │   └── payments.routes.ts # POST /api/payments/orders/:orderId  GET /api/payments/clients/:clientId
│   └── services/              # Business logic (no HTTP concerns)
│       ├── auth.service.ts
│       ├── clients.service.ts
│       ├── measurements.service.ts
│       ├── orders.service.ts
│       ├── payments.service.ts
│       └── stats.service.ts
├── .env.example
├── package.json
└── tsconfig.json
```

---

## Quick start (local)

```bash
cd backend

# 1. Install dependencies
npm install

# 2. Copy env and fill in values
cp .env.example .env

# 3. Create / migrate the database
npx prisma migrate dev --name init

# 4. Start dev server (hot-reload)
npm run dev
# → http://localhost:3001
```

---

## Environment variables

| Variable        | Default                        | Description                                  |
|-----------------|--------------------------------|----------------------------------------------|
| `DATABASE_URL`  | `file:./dev.db`                | SQLite file path                             |
| `AUTH_SECRET`   | hard-coded fallback            | Secret for signing JWTs — **change in prod** |
| `ADMIN_EMAIL`   | `admin@tailorsoft.dev`         | Fallback admin e-mail (no DB row needed)     |
| `ADMIN_PASSWORD`| `admin123`                     | Fallback admin password                      |
| `ADMIN_NAME`    | `Unique Tailors`               | Fallback admin display name                  |
| `PORT`          | `3001`                         | HTTP port                                    |
| `FRONTEND_URL`  | `http://localhost:3000`        | Allowed CORS origin                          |

---

## API reference

All protected endpoints require:
```
Authorization: Bearer <token>
```

### Auth
| Method | Path             | Auth | Description          |
|--------|------------------|------|----------------------|
| POST   | /api/auth/login  | ✗    | Login, get JWT token |
| GET    | /api/auth/me     | ✓    | Get current user     |

### Clients
| Method | Path              | Auth | Description                    |
|--------|-------------------|------|--------------------------------|
| GET    | /api/clients      | ✓    | List clients (`?q=&page=`)     |
| GET    | /api/clients/:id  | ✓    | Client detail + orders         |
| POST   | /api/clients      | ✓    | Create client + first order    |
| PUT    | /api/clients/:id  | ✓    | Update client profile/measurements |
| DELETE | /api/clients/:id  | ✓    | Delete client                  |

### Orders
| Method | Path                           | Auth | Description              |
|--------|--------------------------------|------|--------------------------|
| PATCH  | /api/orders/:id/deliver        | ✓    | Mark order as delivered  |
| PATCH  | /api/orders/:id/revert-delivery| ✓    | Revert to in-progress    |

### Payments
| Method | Path                            | Auth | Description                    |
|--------|---------------------------------|------|--------------------------------|
| POST   | /api/payments/orders/:orderId   | ✓    | Record a payment on an order   |
| GET    | /api/payments/clients/:clientId | ✓    | List all payments for a client |

### Dashboard
| Method | Path                                  | Auth | Description               |
|--------|---------------------------------------|------|---------------------------|
| GET    | /api/dashboard/stats                  | ✓    | Summary stats             |
| GET    | /api/dashboard/recent-clients         | ✓    | Last N clients            |
| GET    | /api/dashboard/upcoming-deliveries    | ✓    | Upcoming deliveries       |

---

## Production deployment

1. Set `NODE_ENV=production` and all required env vars on your host.
2. Run `npm run build` to compile TypeScript to `dist/`.
3. Start with `npm start` (`node dist/index.js`).
4. Point `FRONTEND_URL` to your deployed frontend domain for CORS.

> **Database**: For a persistent production DB consider [Turso](https://turso.tech) (libSQL / SQLite edge) or swap the Prisma adapter to PostgreSQL.
