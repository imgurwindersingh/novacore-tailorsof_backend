const CREATE_CLIENT_EXAMPLE = {
  profile: {
    fullName: "Rajesh Kumar",
    mobile: "9876543210",
    fatherOrHusband: "Suresh Kumar",
    email: "rajesh.kumar@example.com",
    address: "12, Model Town, Guru Har Sahai",
    notes: "Prefers slight loose fit on shirts",
  },
  measurements: {
    unit: "CM",
    general: { height: 172 },
    shirt: {
      chest: 104,
      waist: 92,
      shoulderWidth: 46,
      sleeveLength: 62,
      shirtLength: 74,
      neck: 40,
      cuff: 23,
    },
    pant: {
      waist: 86,
      hip: 100,
      thigh: 58,
      knee: 40,
      bottomOpening: 18,
      inseam: 80,
    },
  },
  order: {
    items: [
      {
        garmentType: "Shirt",
        description: "White cotton formal",
        quantity: 2,
        unitPrice: 1500,
      },
      {
        garmentType: "Pant",
        description: "Navy formal trouser",
        quantity: 1,
        unitPrice: 1800,
      },
    ],
    expectedDelivery: "2026-10-15",
    advance: 1000,
    paymentMethod: "UPI",
  },
};

const UPDATE_CLIENT_EXAMPLE = {
  profile: CREATE_CLIENT_EXAMPLE.profile,
  measurements: CREATE_CLIENT_EXAMPLE.measurements,
};

const ADD_ORDER_EXAMPLE = {
  items: [
    {
      garmentType: "Kurta",
      description: "Cream silk",
      quantity: 1,
      unitPrice: 2500,
    },
  ],
  expectedDelivery: "2026-11-01",
  advance: 500,
  paymentMethod: "CASH",
};

const errorSchema = {
  type: "object",
  properties: { error: { type: "string" } },
  required: ["error"],
};

const bearer = [{ bearerAuth: [] }];

export function buildOpenApiSpec(serverUrl: string) {
  return {
    openapi: "3.0.3",
    info: {
      title: "TailorSoft REST API",
      version: "1.0.0",
      description: [
        "Unique Tailors backend.",
        "",
        "**How to use the JWT**",
        "1. Call `POST /api/auth/login` with `admin@tailorsoft.dev` / `admin123`.",
        "2. Copy `accessToken` from the response.",
        "3. Click **Authorize**, paste the token (no `Bearer` prefix), then **Authorize**.",
        "4. Swagger sends `Authorization: Bearer <token>` on every locked endpoint.",
        "",
        "`unitPrice` and `advance` / `amount` are in **rupees**, not paise.",
      ].join("\n"),
    },
    servers: [
      { url: serverUrl, description: "This server" },
      { url: "https://tailorsof-dac06.containers.snapdeploy.app", description: "Snapdeploy (SQLite)" },
      { url: "https://novacore-tailorsof-backend.gora55039.workers.dev", description: "Cloudflare Workers" },
      { url: "http://localhost:3001", description: "Local" },
    ],
    tags: [
      { name: "Auth" },
      { name: "Clients" },
      { name: "Dashboard" },
      { name: "Orders" },
      { name: "Payments" },
      { name: "Public" },
      { name: "System" },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Paste the `accessToken` from login. Do not include the word Bearer.",
        },
      },
      schemas: {
        Error: errorSchema,
        User: {
          type: "object",
          properties: {
            id: { type: "string" },
            email: { type: "string" },
            name: { type: "string" },
            role: { type: "string", enum: ["ADMIN", "STAFF"] },
          },
        },
        LoginRequest: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", example: "admin@tailorsoft.dev" },
            password: { type: "string", example: "admin123" },
          },
        },
        AuthResponse: {
          type: "object",
          properties: {
            accessToken: { type: "string" },
            refreshToken: { type: "string" },
            user: { $ref: "#/components/schemas/User" },
          },
        },
        Profile: {
          type: "object",
          required: ["fullName", "mobile", "fatherOrHusband", "email", "address", "notes"],
          properties: {
            fullName: { type: "string", minLength: 2, maxLength: 100 },
            mobile: { type: "string", pattern: "^[6-9]\\d{9}$", example: "9876543210" },
            fatherOrHusband: { type: "string", maxLength: 100, description: "Use empty string if none" },
            email: { type: "string", description: "Valid email or empty string" },
            address: { type: "string", maxLength: 300 },
            notes: { type: "string", maxLength: 500 },
          },
        },
        Measurements: {
          type: "object",
          required: ["unit", "general", "shirt", "pant"],
          properties: {
            unit: { type: "string", enum: ["CM", "INCH"] },
            general: {
              type: "object",
              properties: { height: { type: "number", example: 172 } },
            },
            shirt: {
              type: "object",
              properties: {
                chest: { type: "number" },
                waist: { type: "number" },
                shoulderWidth: { type: "number" },
                sleeveLength: { type: "number" },
                shirtLength: { type: "number" },
                neck: { type: "number" },
                cuff: { type: "number" },
              },
            },
            pant: {
              type: "object",
              properties: {
                waist: { type: "number" },
                hip: { type: "number" },
                thigh: { type: "number" },
                knee: { type: "number" },
                bottomOpening: { type: "number" },
                inseam: { type: "number" },
              },
            },
          },
        },
        OrderItem: {
          type: "object",
          required: ["garmentType", "description", "quantity", "unitPrice"],
          properties: {
            garmentType: {
              type: "string",
              example: "Shirt",
              description: "Shirt, Kurta, Pant, Trouser, Sherwani, Blazer, Suit, Blouse, Other",
            },
            description: { type: "string" },
            quantity: { type: "integer", minimum: 1, example: 1 },
            unitPrice: { type: "number", description: "Rupees (not paise)", example: 1500 },
          },
        },
        WizardOrder: {
          type: "object",
          required: ["items", "expectedDelivery", "advance", "paymentMethod"],
          properties: {
            items: { type: "array", minItems: 1, items: { $ref: "#/components/schemas/OrderItem" } },
            expectedDelivery: { type: "string", example: "2026-10-15" },
            advance: { type: "number", minimum: 0, description: "Rupees" },
            paymentMethod: {
              type: "string",
              description: "Required when advance > 0. Empty string if no advance.",
              enum: ["CASH", "UPI", "CARD", "OTHER", ""],
            },
          },
        },
        CreateClientRequest: {
          type: "object",
          required: ["profile", "measurements", "order"],
          properties: {
            profile: { $ref: "#/components/schemas/Profile" },
            measurements: { $ref: "#/components/schemas/Measurements" },
            order: { $ref: "#/components/schemas/WizardOrder" },
          },
          example: CREATE_CLIENT_EXAMPLE,
        },
        UpdateClientRequest: {
          type: "object",
          required: ["profile", "measurements"],
          properties: {
            profile: { $ref: "#/components/schemas/Profile" },
            measurements: { $ref: "#/components/schemas/Measurements" },
          },
          example: UPDATE_CLIENT_EXAMPLE,
        },
      },
    },
    paths: {
      "/health": {
        get: {
          tags: ["System"],
          summary: "Health",
          security: [],
          responses: { "200": { description: "OK" }, "503": { description: "Degraded" } },
        },
      },
      "/api/auth/login": {
        post: {
          tags: ["Auth"],
          summary: "Login",
          description: "Returns `accessToken` (JWT, 2 days) and `refreshToken` (7 days).",
          security: [],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/LoginRequest" },
                example: { email: "admin@tailorsoft.dev", password: "admin123" },
              },
            },
          },
          responses: {
            "200": {
              description: "Authenticated",
              content: { "application/json": { schema: { $ref: "#/components/schemas/AuthResponse" } } },
            },
            "401": { description: "Invalid credentials", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          },
        },
      },
      "/api/auth/me": {
        get: {
          tags: ["Auth"],
          summary: "Current user",
          security: bearer,
          responses: {
            "200": { description: "User" },
            "401": { description: "Missing or invalid token" },
          },
        },
      },
      "/api/auth/refresh": {
        post: {
          tags: ["Auth"],
          summary: "Refresh tokens",
          security: [],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["refreshToken"],
                  properties: { refreshToken: { type: "string" } },
                },
              },
            },
          },
          responses: {
            "200": { description: "New token pair" },
            "401": { description: "Invalid or expired refresh token" },
          },
        },
      },
      "/api/auth/logout": {
        post: {
          tags: ["Auth"],
          summary: "Logout (revoke one refresh token)",
          security: [],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { refreshToken: { type: "string" } },
                },
              },
            },
          },
          responses: { "200": { description: "OK" } },
        },
      },
      "/api/auth/logout-all": {
        post: {
          tags: ["Auth"],
          summary: "Logout everywhere",
          security: bearer,
          responses: { "200": { description: "OK" }, "401": { description: "Unauthorized" } },
        },
      },
      "/api/clients": {
        get: {
          tags: ["Clients"],
          summary: "List clients",
          security: bearer,
          parameters: [
            { name: "q", in: "query", schema: { type: "string" }, description: "Search name, mobile, or order number" },
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          ],
          responses: { "200": { description: "Paginated list" }, "401": { description: "Unauthorized" } },
        },
        post: {
          tags: ["Clients"],
          summary: "Create client (wizard)",
          description: "Creates the client, optional measurements, and the first order in one request.",
          security: bearer,
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateClientRequest" },
                example: CREATE_CLIENT_EXAMPLE,
              },
            },
          },
          responses: {
            "201": {
              description: "Created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      clientId: { type: "string" },
                      orderId: { type: "string" },
                      orderNumber: { type: "string" },
                    },
                  },
                },
              },
            },
            "400": { description: "Validation error" },
            "401": { description: "Unauthorized" },
            "422": { description: "Duplicate mobile or business rule" },
          },
        },
      },
      "/api/clients/{id}": {
        get: {
          tags: ["Clients"],
          summary: "Get client",
          security: bearer,
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Client detail" }, "404": { description: "Not found" } },
        },
        put: {
          tags: ["Clients"],
          summary: "Update client profile and measurements",
          security: bearer,
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/UpdateClientRequest" },
                example: UPDATE_CLIENT_EXAMPLE,
              },
            },
          },
          responses: { "200": { description: "Updated" }, "422": { description: "Conflict" } },
        },
        delete: {
          tags: ["Clients"],
          summary: "Delete client",
          security: bearer,
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Deleted" }, "404": { description: "Not found" } },
        },
      },
      "/api/clients/{clientId}/orders": {
        post: {
          tags: ["Clients"],
          summary: "Add order to existing client",
          security: bearer,
          parameters: [{ name: "clientId", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WizardOrder" },
                example: ADD_ORDER_EXAMPLE,
              },
            },
          },
          responses: { "201": { description: "Order created" }, "404": { description: "Client not found" } },
        },
      },
      "/api/dashboard/stats": {
        get: {
          tags: ["Dashboard"],
          summary: "Dashboard stats",
          security: bearer,
          responses: { "200": { description: "Totals" } },
        },
      },
      "/api/dashboard/recent-clients": {
        get: {
          tags: ["Dashboard"],
          summary: "Recent clients",
          security: bearer,
          parameters: [{ name: "limit", in: "query", schema: { type: "integer", default: 5 } }],
          responses: { "200": { description: "List" } },
        },
      },
      "/api/dashboard/upcoming-deliveries": {
        get: {
          tags: ["Dashboard"],
          summary: "Upcoming deliveries",
          security: bearer,
          parameters: [{ name: "limit", in: "query", schema: { type: "integer", default: 10 } }],
          responses: { "200": { description: "List" } },
        },
      },
      "/api/orders/{id}/deliver": {
        patch: {
          tags: ["Orders"],
          summary: "Mark order delivered",
          security: bearer,
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Updated" }, "422": { description: "Payment not cleared" } },
        },
      },
      "/api/orders/{id}/revert-delivery": {
        patch: {
          tags: ["Orders"],
          summary: "Revert delivery",
          security: bearer,
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Reverted" } },
        },
      },
      "/api/payments/orders/{orderId}": {
        post: {
          tags: ["Payments"],
          summary: "Record payment",
          security: bearer,
          parameters: [{ name: "orderId", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["amount", "method", "note"],
                  properties: {
                    amount: { type: "number", description: "Rupees", example: 500 },
                    method: { type: "string", enum: ["CASH", "UPI", "CARD", "OTHER"] },
                    note: { type: "string", example: "Partial payment" },
                  },
                },
              },
            },
          },
          responses: { "201": { description: "Recorded" } },
        },
      },
      "/api/payments/clients/{clientId}": {
        get: {
          tags: ["Payments"],
          summary: "List client payments",
          security: bearer,
          parameters: [{ name: "clientId", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Payments" } },
        },
      },
      "/api/public/clients/{id}": {
        get: {
          tags: ["Public"],
          summary: "Public client profile",
          security: [],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Public view" }, "404": { description: "Not found" } },
        },
      },
    },
  };
}

export function renderSwaggerHtml(specUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>TailorSoft API — Swagger</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css"/>
  <style>
    body { margin: 0; background: #0b1220; }
    .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: ${JSON.stringify(specUrl)},
      dom_id: "#swagger-ui",
      persistAuthorization: true,
      tryItOutEnabled: true,
      displayRequestDuration: true,
      docExpansion: "list",
      deepLinking: true,
    });
  </script>
</body>
</html>`;
}
