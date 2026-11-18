/**
 * Demo data: 1 admin, 5 riders, 5 communities, 2 planned trips with real Pune-area routes.
 * Idempotent — safe to run repeatedly (upserts by email / slug / group code).
 *
 *   npm run db:seed
 */
import "dotenv/config";
import { prisma } from "../src/database/prisma.js";
import { hashPassword } from "../src/utils/security.js";
import { cumulativeDistances, densify, projectOnLine } from "../src/utils/geo.js";

const ADMIN = { name: "Gunesh Yeole", email: "admin@navnet.dev", password: "Admin@123" };
const RIDERS = [
  { name: "Aarav Patil", email: "aarav@navnet.dev", vehicleNumber: "MH12 AB 1234" },
  { name: "Diya Kulkarni", email: "diya@navnet.dev", vehicleNumber: "MH14 CD 5678" },
  { name: "Kabir Deshmukh", email: "kabir@navnet.dev", vehicleNumber: "MH12 EF 9012" },
  { name: "Meera Joshi", email: "meera@navnet.dev", vehicleNumber: "MH12 GH 3456" },
  { name: "Rohan Shinde", email: "rohan@navnet.dev", vehicleNumber: "MH14 IJ 7890" },
];
const RIDER_PASSWORD = "Rider@123";

const COMMUNITIES = [
  { name: "Pune Riders", city: "Pune", category: "Motorcycling", description: "Weekend highway rides across the Sahyadris. All bikes welcome — safety gear mandatory." },
  { name: "Weekend Touring Club", city: "Mumbai", category: "Road Trips", description: "Car convoys to beaches, hill stations and heritage towns every other weekend." },
  { name: "Pune Cycling Community", city: "Pune", category: "Cycling", description: "Sunrise loops, Sinhagad climbs and century rides for every fitness level." },
  { name: "Sahyadri Trekking Group", city: "Pune", category: "Trekking", description: "Fort treks and monsoon trails with experienced trek leaders." },
  { name: "KJCOEMR Travel Club", city: "Pune", category: "College", description: "Official college travel club — industrial visits, fests and semester-end trips." },
];

// Old Mumbai–Pune highway via Talegaon & Kamshet (approximate road anchor points).
const LONAVALA_ANCHORS = [
  [18.5308, 73.8475], // Shivajinagar
  [18.5626, 73.8087], // Aundh
  [18.6298, 73.7997], // Pimpri
  [18.6517, 73.7637], // Nigdi
  [18.6795, 73.736], // Dehu Road
  [18.735, 73.6755], // Talegaon Dabhade
  [18.7419, 73.6385], // Vadgaon Maval
  [18.7629, 73.5631], // Kamshet
  [18.7616, 73.473], // Karla
  [18.76, 73.441], // Malavli
  [18.7546, 73.4062], // Lonavala
];

const SINHAGAD_ANCHORS = [
  [18.5308, 73.8475], // Shivajinagar
  [18.5074, 73.8077], // Kothrud
  [18.4706, 73.7911], // Warje
  [18.443, 73.771], // Khadakwasla dam
  [18.4065, 73.7638], // Donje
  [18.3664, 73.7559], // Sinhagad fort parking
];

const dayAt = (daysAhead, hour, minute = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(hour, minute, 0, 0);
  return d;
};

async function upsertTrip({ groupCode, password, anchors, avgKmh, checkpoints, ...rest }) {
  const geometry = densify(anchors, 250);
  const cum = cumulativeDistances(geometry);
  const distance = cum.at(-1);
  const duration = distance / ((avgKmh * 1000) / 3600);
  const exists = await prisma.trip.findUnique({ where: { groupCode } });
  if (exists) return exists;

  const departure = rest.departureTime;
  return prisma.trip.create({
    data: {
      ...rest,
      groupCode,
      passwordHash: await hashPassword(password),
      startName: rest.startName,
      startLat: anchors[0][0],
      startLng: anchors[0][1],
      destLat: anchors.at(-1)[0],
      destLng: anchors.at(-1)[1],
      routeGeometry: geometry,
      routeDistance: distance,
      routeDuration: duration,
      routeProvider: "seed",
      expectedArrival: new Date(departure.getTime() + duration * 1000 + 45 * 60 * 1000),
      checkpoints: {
        create: checkpoints.map((c, i) => {
          const along = projectOnLine([c.lat, c.lng], geometry, cum).along;
          return { ...c, order: i, eta: new Date(departure.getTime() + (along / distance) * duration * 1000) };
        }),
      },
    },
  });
}

async function main() {
  console.log("🌱 Seeding NavNet demo data…");

  const admin = await prisma.user.upsert({
    where: { email: ADMIN.email },
    update: {},
    create: { name: ADMIN.name, email: ADMIN.email, role: "ADMIN", passwordHash: await hashPassword(ADMIN.password) },
  });

  const riderHash = await hashPassword(RIDER_PASSWORD);
  const riders = [];
  for (const r of RIDERS) {
    riders.push(
      await prisma.user.upsert({
        where: { email: r.email },
        update: {},
        create: { ...r, role: "USER", passwordHash: riderHash },
      }),
    );
  }

  const communities = {};
  for (const c of COMMUNITIES) {
    const slug = c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    communities[c.name] = await prisma.community.upsert({
      where: { slug },
      update: {},
      create: { ...c, slug, ownerId: admin.id },
    });
  }

  const pr = communities["Pune Riders"];
  if ((await prisma.communityAnnouncement.count({ where: { communityId: pr.id } })) === 0) {
    await prisma.communityAnnouncement.createMany({
      data: [
        { communityId: pr.id, authorId: admin.id, title: "Monsoon ride season is open 🌧️", body: "Lonavala ride this weekend. Rain gear, tyre check, and full tank before departure. Join with Group ID PUNE-RIDE." },
        { communityId: pr.id, authorId: admin.id, title: "Safety first", body: "Keep the SOS button handy and never ride without location sharing turned on." },
      ],
    });
  }
  await prisma.communityMember.upsert({
    where: { communityId_userId: { communityId: pr.id, userId: riders[0].id } },
    update: {},
    create: { communityId: pr.id, userId: riders[0].id, status: "APPROVED", decidedAt: new Date() },
  });
  await prisma.communityMember.upsert({
    where: { communityId_userId: { communityId: pr.id, userId: riders[1].id } },
    update: {},
    create: { communityId: pr.id, userId: riders[1].id, status: "PENDING", message: "Ride a Himalayan 450, would love to join!" },
  });

  await upsertTrip({
    groupCode: "PUNE-RIDE",
    password: "ride123",
    name: "Lonavala Monsoon Ride",
    description: "Classic monsoon run up the old Mumbai–Pune highway. Breakfast at Talegaon, chai with a view at Karla, lunch in Lonavala.",
    adminId: admin.id,
    communityId: pr.id,
    startName: "Shivajinagar, Pune",
    destName: "Lonavala",
    vehicleType: "BIKE",
    speedLimitKmh: 70,
    maxMembers: 15,
    avgKmh: 45,
    departureTime: dayAt(1, 6, 30),
    anchors: LONAVALA_ANCHORS,
    checkpoints: [
      { name: "HP Fuel Station, Dehu Road", category: "FUEL", lat: 18.6795, lng: 73.736 },
      { name: "Misal at Talegaon", category: "BREAKFAST", lat: 18.735, lng: 73.6755 },
      { name: "Kamshet viewpoint", category: "SCENIC", lat: 18.7629, lng: 73.5631 },
      { name: "Karla hydration stop", category: "HYDRATION", lat: 18.7616, lng: 73.473 },
      { name: "Lunch — Lonavala", category: "LUNCH", lat: 18.7546, lng: 73.4062 },
    ],
  });

  await upsertTrip({
    groupCode: "SINHAGAD",
    password: "cycle123",
    name: "Sinhagad Sunrise Climb",
    description: "Pre-dawn cycling climb to Sinhagad fort. Regroup at Khadakwasla before the ghat section.",
    adminId: admin.id,
    communityId: communities["Pune Cycling Community"].id,
    startName: "Shivajinagar, Pune",
    destName: "Sinhagad Fort",
    vehicleType: "BICYCLE",
    speedLimitKmh: 40,
    maxMembers: 25,
    avgKmh: 16,
    departureTime: dayAt(3, 5, 0),
    anchors: SINHAGAD_ANCHORS,
    checkpoints: [
      { name: "Regroup — Khadakwasla dam", category: "REST", lat: 18.443, lng: 73.771 },
      { name: "Water refill — Donje", category: "HYDRATION", lat: 18.4065, lng: 73.7638 },
    ],
  });

  console.log(`✅ Seed complete
   Admin   → ${ADMIN.email} / ${ADMIN.password}
   Riders  → ${RIDERS.map((r) => r.email).join(", ")} / ${RIDER_PASSWORD}
   Trips   → Group ID PUNE-RIDE / ride123   ·   SINHAGAD / cycle123`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
