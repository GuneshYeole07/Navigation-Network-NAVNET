import { prisma } from "../src/database/prisma.js";

export async function resetDb() {
  // Order matters only for readability; CASCADE handles FKs.
  await prisma.$executeRawUnsafe(`TRUNCATE "TripReport","Alert","Message","CheckpointVisit","LocationPing",
    "TripMember","Checkpoint","Waypoint","Trip","CommunityAnnouncement","CommunityMember","Community","User" CASCADE`);
}

export const tripInput = (overrides = {}) => ({
  name: "Test Ride",
  description: "Integration test trip",
  start: { name: "Start", lat: 18.5308, lng: 73.8475 },
  destination: { name: "End", lat: 18.5308, lng: 73.9475 }, // ~10.5 km due east
  waypoints: [],
  checkpoints: [{ name: "Fuel", category: "FUEL", lat: 18.5308, lng: 73.8975 }],
  groupCode: "TEST-RIDE",
  groupPassword: "secret1",
  maxMembers: 3,
  vehicleType: "BIKE",
  speedLimitKmh: 60,
  departureTime: new Date(Date.now() + 3600e3).toISOString(),
  expectedArrival: new Date(Date.now() + 7200e3).toISOString(),
  ...overrides,
});
