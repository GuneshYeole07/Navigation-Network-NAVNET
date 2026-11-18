import { prisma } from "../database/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { slugify } from "../utils/security.js";

const listSelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  city: true,
  category: true,
  coverImage: true,
  isPublic: true,
  createdAt: true,
  owner: { select: { id: true, name: true } },
  _count: { select: { members: { where: { status: "APPROVED" } }, trips: true } },
};

export async function createCommunity(ownerId, input) {
  let slug = slugify(input.name) || "community";
  if (await prisma.community.findUnique({ where: { slug } })) {
    slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
  }
  return prisma.community.create({ data: { ...input, slug, ownerId }, select: listSelect });
}

export async function listPublic({ search, category }, userId) {
  const rows = await prisma.community.findMany({
    where: {
      isPublic: true,
      ...(category ? { category: { equals: category, mode: "insensitive" } } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { city: { contains: search, mode: "insensitive" } },
              { description: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    select: { ...listSelect, members: { where: { userId }, select: { status: true } } },
  });
  return rows.map(({ members, ...c }) => ({ ...c, myStatus: members[0]?.status ?? null }));
}

export function listOwned(ownerId) {
  return prisma.community.findMany({
    where: { ownerId },
    orderBy: { createdAt: "desc" },
    select: {
      ...listSelect,
      _count: {
        select: {
          members: { where: { status: "PENDING" } },
          trips: true,
        },
      },
    },
  });
}

export async function getCommunity(idOrSlug, user) {
  const c = await prisma.community.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    select: {
      ...listSelect,
      announcements: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, title: true, body: true, createdAt: true, author: { select: { name: true } } },
      },
      trips: {
        where: { status: { in: ["PLANNED", "ACTIVE", "PAUSED"] } },
        orderBy: { departureTime: "asc" },
        select: {
          id: true,
          name: true,
          description: true,
          imageUrl: true,
          status: true,
          startName: true,
          destName: true,
          departureTime: true,
          routeDistance: true,
          vehicleType: true,
          maxMembers: true,
          _count: { select: { members: { where: { status: "ACTIVE" } } } },
        },
      },
      members: { where: { userId: user.id }, select: { status: true } },
    },
  });
  if (!c) throw ApiError.notFound("Community not found");
  const isOwner = c.owner.id === user.id;
  if (!c.isPublic && !isOwner && c.members[0]?.status !== "APPROVED") {
    throw ApiError.notFound("Community not found");
  }
  const { members, ...rest } = c;
  return { ...rest, myStatus: members[0]?.status ?? null, isOwner };
}

export async function requestJoin(communityId, user, message) {
  const c = await prisma.community.findUnique({ where: { id: communityId } });
  if (!c || !c.isPublic) throw ApiError.notFound("Community not found");
  if (c.ownerId === user.id) throw ApiError.badRequest("You own this community");
  const existing = await prisma.communityMember.findUnique({
    where: { communityId_userId: { communityId, userId: user.id } },
  });
  if (existing?.status === "APPROVED") throw ApiError.conflict("You are already a member");
  if (existing?.status === "PENDING") throw ApiError.conflict("Your request is already pending");
  return prisma.communityMember.upsert({
    where: { communityId_userId: { communityId, userId: user.id } },
    update: { status: "PENDING", message, decidedAt: null },
    create: { communityId, userId: user.id, message },
  });
}

async function assertOwner(communityId, userId) {
  const c = await prisma.community.findUnique({ where: { id: communityId } });
  if (!c) throw ApiError.notFound("Community not found");
  if (c.ownerId !== userId) throw ApiError.forbidden("Only the community owner can do that");
  return c;
}

export async function listRequests(communityId, owner) {
  await assertOwner(communityId, owner.id);
  return prisma.communityMember.findMany({
    where: { communityId },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      status: true,
      message: true,
      createdAt: true,
      decidedAt: true,
      user: { select: { id: true, name: true, email: true, vehicleNumber: true } },
    },
  });
}

export async function decideRequest(communityId, memberId, owner, decision) {
  await assertOwner(communityId, owner.id);
  const req = await prisma.communityMember.findUnique({ where: { id: memberId } });
  if (!req || req.communityId !== communityId) throw ApiError.notFound("Request not found");
  return prisma.communityMember.update({
    where: { id: memberId },
    data: { status: decision, decidedAt: new Date() },
  });
}

export async function postAnnouncement(communityId, owner, { title, body }) {
  await assertOwner(communityId, owner.id);
  return prisma.communityAnnouncement.create({
    data: { communityId, authorId: owner.id, title, body },
    select: { id: true, title: true, body: true, createdAt: true, author: { select: { name: true } } },
  });
}
