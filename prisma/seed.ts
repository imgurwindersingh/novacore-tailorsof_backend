import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { hashPassword } from "../src/lib/auth.js";

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL ?? "file:./dev.db",
});
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("🌱 Seeding clean database...");

  // 1. Create or update default Admin User
  const adminEmail = process.env.ADMIN_EMAIL ?? "admin@tailorsoft.dev";
  const adminPassword = process.env.ADMIN_PASSWORD ?? "admin123";
  const adminName = process.env.ADMIN_NAME ?? "Bluestar Tailors";
  const passwordHash = await hashPassword(adminPassword);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { passwordHash, name: adminName, role: "ADMIN" },
    create: {
      email: adminEmail,
      name: adminName,
      passwordHash,
      role: "ADMIN",
    },
  });
  console.log(`✅ Admin user configured: ${admin.email}`);

  // 2. Remove dummy / extra test data so you have a clean slate
  await prisma.payment.deleteMany({});
  await prisma.orderItem.deleteMany({});
  await prisma.order.deleteMany({});
  await prisma.generalMeasurement.deleteMany({});
  await prisma.shirtMeasurement.deleteMany({});
  await prisma.pantMeasurement.deleteMany({});
  await prisma.client.deleteMany({});

  console.log("🧹 All sample/extra client and order data removed.");
  console.log("🎉 Database is now fresh and ready for real data!");
}

main()
  .catch((e) => {
    console.error("❌ Seeding failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
