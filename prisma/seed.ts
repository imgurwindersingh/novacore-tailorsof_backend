import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { hashPassword } from "../src/lib/auth.js";

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL ?? "file:./dev.db",
});
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("🌱 Seeding database...");

  // 1. Create or update default Admin User
  const adminEmail = process.env.ADMIN_EMAIL ?? "admin@tailorsoft.dev";
  const adminPassword = process.env.ADMIN_PASSWORD ?? "admin123";
  const adminName = process.env.ADMIN_NAME ?? "Unique Tailors";
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
  console.log(`✅ Admin user seeded: ${admin.email}`);

  // 2. Check if sample client exists
  const existingClient = await prisma.client.findFirst({
    where: { mobile: "9876543210" },
  });

  if (!existingClient) {
    const client = await prisma.client.create({
      data: {
        fullName: "Harpreet Singh",
        mobile: "9876543210",
        fatherOrHusband: "Gurdeep Singh",
        email: "harpreet.singh@example.com",
        address: "Shop 12, Model Town, Jalandhar",
        notes: "Prefers slim fit stitching with double stitching on collar.",
        generalMeasurement: {
          create: {
            unit: "INCH",
            height: 68.5,
          },
        },
        shirtMeasurement: {
          create: {
            unit: "INCH",
            chest: 40.0,
            waist: 34.0,
            shoulderWidth: 18.0,
            sleeveLength: 24.5,
            shirtLength: 29.0,
            neck: 15.5,
            cuff: 9.0,
          },
        },
        pantMeasurement: {
          create: {
            unit: "INCH",
            waist: 34.0,
            hip: 41.0,
            thigh: 24.0,
            knee: 17.5,
            bottomOpening: 14.5,
            inseam: 31.0,
          },
        },
        orders: {
          create: {
            orderNumber: "ORD-0001",
            status: "IN_PROGRESS",
            paymentStatus: "PARTIAL",
            totalPaise: 250000, // ₹2,500.00
            expectedDelivery: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // +5 days
            notes: "1 Royal Blue Kurta + 1 White Pajama",
            items: {
              create: [
                {
                  garmentType: "Kurta",
                  description: "Royal Blue raw silk with mandarin collar",
                  quantity: 1,
                  unitPricePaise: 150000, // ₹1,500.00
                },
                {
                  garmentType: "Pant",
                  description: "White cotton pajama with pockets",
                  quantity: 1,
                  unitPricePaise: 100000, // ₹1,000.00
                },
              ],
            },
            payments: {
              create: [
                {
                  amountPaise: 100000, // ₹1,000.00 advance
                  method: "UPI",
                  note: "Advance payment via GPay",
                },
              ],
            },
          },
        },
      },
    });
    console.log(`✅ Sample client seeded: ${client.fullName} (${client.mobile})`);
  } else {
    console.log("ℹ️ Sample client already exists, skipping creation.");
  }

  console.log("🎉 Database seeding completed successfully!");
}

main()
  .catch((e) => {
    console.error("❌ Seeding failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
