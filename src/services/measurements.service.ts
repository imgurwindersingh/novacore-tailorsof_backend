import type { Prisma } from "../generated/prisma/client.js";
import type { MeasurementsDTO } from "../lib/types.js";

export function hasAnyMeasurement(m: MeasurementsDTO): boolean {
  return (
    m.general.height != null ||
    Object.values(m.shirt).some((v) => v != null) ||
    Object.values(m.pant).some((v) => v != null)
  );
}

export async function upsertMeasurementsInTx(
  tx: Prisma.TransactionClient,
  clientId: string,
  m: MeasurementsDTO
): Promise<void> {
  await tx.generalMeasurement.upsert({
    where: { clientId },
    update: { unit: m.unit, height: m.general.height ?? null },
    create: { clientId, unit: m.unit, height: m.general.height ?? null },
  });

  await tx.shirtMeasurement.upsert({
    where: { clientId },
    update: {
      unit: m.unit,
      chest: m.shirt.chest ?? null,
      waist: m.shirt.waist ?? null,
      shoulderWidth: m.shirt.shoulderWidth ?? null,
      sleeveLength: m.shirt.sleeveLength ?? null,
      shirtLength: m.shirt.shirtLength ?? null,
      neck: m.shirt.neck ?? null,
      cuff: m.shirt.cuff ?? null,
    },
    create: {
      clientId,
      unit: m.unit,
      chest: m.shirt.chest ?? null,
      waist: m.shirt.waist ?? null,
      shoulderWidth: m.shirt.shoulderWidth ?? null,
      sleeveLength: m.shirt.sleeveLength ?? null,
      shirtLength: m.shirt.shirtLength ?? null,
      neck: m.shirt.neck ?? null,
      cuff: m.shirt.cuff ?? null,
    },
  });

  await tx.pantMeasurement.upsert({
    where: { clientId },
    update: {
      unit: m.unit,
      waist: m.pant.waist ?? null,
      hip: m.pant.hip ?? null,
      thigh: m.pant.thigh ?? null,
      knee: m.pant.knee ?? null,
      bottomOpening: m.pant.bottomOpening ?? null,
      inseam: m.pant.inseam ?? null,
    },
    create: {
      clientId,
      unit: m.unit,
      waist: m.pant.waist ?? null,
      hip: m.pant.hip ?? null,
      thigh: m.pant.thigh ?? null,
      knee: m.pant.knee ?? null,
      bottomOpening: m.pant.bottomOpening ?? null,
      inseam: m.pant.inseam ?? null,
    },
  });
}
