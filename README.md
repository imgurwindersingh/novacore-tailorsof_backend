# novacore-tailorsof — Backend

REST API for the TailorSoft application, built with **Hono** + **Prisma** (SQLite / Cloudflare Workers).

🚀 **Live Production API**: [https://novacore-tailorsof-backend.gora55039.workers.dev](https://novacore-tailorsof-backend.gora55039.workers.dev)

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
| `INFOBIP_API_KEY` | — | Infobip API key, stored as a production secret |
| `INFOBIP_BASE_URL` | — | Infobip base URL, e.g. `your-id.api.infobip.com` |
| `INFOBIP_WHATSAPP_FROM` | — | Approved WhatsApp Business sender number |
| `INFOBIP_WHATSAPP_ENABLED` | `true` | Set `false` to use SMS only |
| `INFOBIP_SMS_FROM` | — | Approved SMS sender ID/number; used if WhatsApp cannot send |
| `INFOBIP_SMS_ENABLED` | `true` | Set `false` to disable SMS fallback |
| `INFOBIP_WHATSAPP_TEMPLATE_LANGUAGE` | `en` | Language of your approved templates, e.g. `en` or `en_US` |
| `INFOBIP_WHATSAPP_TEMPLATE_WELCOME` | — | Approved welcome template name |
| `INFOBIP_WHATSAPP_TEMPLATE_ORDER` | — | Approved order-confirmation template name |
| `INFOBIP_WHATSAPP_TEMPLATE_PAYMENT` | — | Approved payment-receipt template name |
| `INFOBIP_WHATSAPP_TEMPLATE_DELIVERED` | — | Approved ready-for-pickup template name |

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

### Notifications
| Method | Path                        | Auth | Description |
|--------|-----------------------------|------|-------------|
| POST   | /api/notifications/test     | ✓    | Send a demo `welcome`, `order`, `payment`, or `delivered` message without changing data |

## Client messaging

The API automatically attempts a WhatsApp message for a new client welcome,
new order, payment receipt, and delivered order. If WhatsApp is unavailable
(for example, the customer has not opted in or a template is not approved), it
uses Infobip SMS when `INFOBIP_SMS_FROM` is configured. Message delivery never
prevents the client, order, or payment from being saved; each write response
includes a `notified` result so the app can show whether it was delivered.

For production WhatsApp, obtain customer opt-in and use approved transactional
templates in your Infobip account for business-initiated messages. Start with a
small trial/paid credit and send only the four event messages above; that keeps
the expected volume well within 10–20 messages per client.

### First production setup

1. Create one Infobip account and activate both WhatsApp Business and SMS.
2. Register the sender(s), collect WhatsApp opt-in when registering a client,
   and approve your order/payment templates with Meta.
3. Set the credentials on the backend host. For Cloudflare Workers, use
   `wrangler secret put INFOBIP_API_KEY`, then set `INFOBIP_BASE_URL`,
   `INFOBIP_WHATSAPP_FROM`, and `INFOBIP_SMS_FROM` as Worker variables/secrets.
4. Start with SMS enabled for the live demonstration. The code will use it
   whenever WhatsApp rejects a message outside its customer-service window.

WhatsApp free-form text can only be delivered while a customer-service session
is open (normally after the client has messaged you). Outside that window,
configure the matching approved WhatsApp templates with Infobip or let the SMS
fallback deliver the receipt. This protects you from paying for messages that
cannot be delivered.

### Template bodies to approve

Create these as **Utility** templates in Infobip/Meta. Keep the placeholders in
the exact listed order; the backend fills them automatically.

| Environment variable | Template body |
|---|---|
| `INFOBIP_WHATSAPP_TEMPLATE_WELCOME` | `Welcome to Novacore Tailorsoft, {{1}}. We have saved your profile and measurements. We will keep you updated about your orders.` |
| `INFOBIP_WHATSAPP_TEMPLATE_ORDER` | `Dear {{1}}, your order {{2}} has been confirmed. Total: {{3}}. Balance due: {{4}}. Thank you.` |
| `INFOBIP_WHATSAPP_TEMPLATE_PAYMENT` | `Dear {{1}}, we received {{3}} for order {{2}}. Total paid: {{4}}. Balance due: {{5}}. Thank you.` |
| `INFOBIP_WHATSAPP_TEMPLATE_DELIVERED` | `Dear {{1}}, order {{2}} is ready for pickup. Total: {{3}}. Balance: {{4}}. Thank you.` |

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
