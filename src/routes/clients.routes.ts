import { Hono } from "hono";
import { rupeesToPaise } from "../lib/money.js";
import { addClientWizardSchema, updateClientSchema, type AddClientWizardInput, type UpdateClientInput } from "../lib/validators/client.js";
import { requireAuth, type AuthVariables } from "../middleware/auth.middleware.js";
import {
  createClientWithOrder,
  deleteClient,
  emptyToNull,
  getClientDetail,
  listClients,
  updateClient,
} from "../services/clients.service.js";
import type { CreateClientWithOrderDTO, MeasurementsDTO, UpdateClientDTO } from "../lib/types.js";

const clients = new Hono<{ Variables: AuthVariables }>();

// All client routes require auth
clients.use(requireAuth);

function firstIssueMessage(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Invalid input";
}

function toMeasurementsDTO(
  input: AddClientWizardInput["measurements"] | UpdateClientInput["measurements"]
): MeasurementsDTO {
  return {
    unit: input.unit,
    general: { height: input.general.height ?? null },
    shirt: {
      chest: input.shirt.chest ?? null,
      waist: input.shirt.waist ?? null,
      shoulderWidth: input.shirt.shoulderWidth ?? null,
      sleeveLength: input.shirt.sleeveLength ?? null,
      shirtLength: input.shirt.shirtLength ?? null,
      neck: input.shirt.neck ?? null,
      cuff: input.shirt.cuff ?? null,
    },
    pant: {
      waist: input.pant.waist ?? null,
      hip: input.pant.hip ?? null,
      thigh: input.pant.thigh ?? null,
      knee: input.pant.knee ?? null,
      bottomOpening: input.pant.bottomOpening ?? null,
      inseam: input.pant.inseam ?? null,
    },
  };
}

/**
 * GET /api/clients?q=&page=1
 */
clients.get("/", async (c) => {
  const q = c.req.query("q");
  const page = Number(c.req.query("page") ?? "1");
  const result = await listClients({ q, page: isNaN(page) ? 1 : page });
  if (!result.ok) return c.json({ error: result.error }, 500);
  return c.json(result.data);
});

/**
 * GET /api/clients/:id
 */
clients.get("/:id", async (c) => {
  const id = c.req.param("id");
  const result = await getClientDetail(id);
  if (!result.ok) return c.json({ error: result.error }, 404);
  return c.json(result.data);
});

/**
 * POST /api/clients
 * Body: AddClientWizardInput (profile + measurements + order, unitPrice in rupees)
 */
clients.post("/", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = addClientWizardSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: firstIssueMessage(parsed.error) }, 400);

  const data = parsed.data;
  const dto: CreateClientWithOrderDTO = {
    profile: {
      fullName: data.profile.fullName,
      mobile: data.profile.mobile,
      fatherOrHusband: emptyToNull(data.profile.fatherOrHusband),
      email: emptyToNull(data.profile.email),
      address: emptyToNull(data.profile.address),
      notes: emptyToNull(data.profile.notes),
    },
    measurements: toMeasurementsDTO(data.measurements),
    order: {
      items: data.order.items.map((item) => ({
        garmentType: item.garmentType,
        description: emptyToNull(item.description),
        quantity: item.quantity,
        unitPricePaise: rupeesToPaise(item.unitPrice),
      })),
      expectedDelivery: data.order.expectedDelivery || null,
      advancePaise: rupeesToPaise(data.order.advance),
      paymentMethod: data.order.paymentMethod === "" ? null : data.order.paymentMethod,
    },
  };

  const result = await createClientWithOrder(dto);
  if (!result.ok) return c.json({ error: result.error }, 422);
  return c.json(result.data, 201);
});

/**
 * PUT /api/clients/:id
 * Body: UpdateClientInput (profile + measurements)
 */
clients.put("/:id", async (c) => {
  const id = c.req.param("id");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = updateClientSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: firstIssueMessage(parsed.error) }, 400);

  const data = parsed.data;
  const dto: UpdateClientDTO = {
    profile: {
      fullName: data.profile.fullName,
      mobile: data.profile.mobile,
      fatherOrHusband: emptyToNull(data.profile.fatherOrHusband),
      email: emptyToNull(data.profile.email),
      address: emptyToNull(data.profile.address),
      notes: emptyToNull(data.profile.notes),
    },
    measurements: toMeasurementsDTO(data.measurements),
  };

  const result = await updateClient(id, dto);
  if (!result.ok) return c.json({ error: result.error }, 422);
  return c.json(result.data);
});

/**
 * DELETE /api/clients/:id
 */
clients.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const result = await deleteClient(id);
  if (!result.ok) return c.json({ error: result.error }, 404);
  return c.json(result.data);
});

export default clients;
