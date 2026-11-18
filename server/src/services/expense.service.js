/** Shared trip costs (fuel, food, tolls) and who-owes-whom, like a mini Splitwise. */
import { prisma } from "../database/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { assertTripAccess } from "./trip.service.js";
import { emitToTrip } from "../socket/emitter.js";

/**
 * Minimal set of transfers that settles every balance (greedy: biggest debtor pays
 * biggest creditor). Balances are in paise; positive = is owed money.
 */
export function settle(balances) {
  const debtors = [];
  const creditors = [];
  for (const [id, v] of Object.entries(balances)) {
    if (v < 0) debtors.push({ id, amt: -v });
    else if (v > 0) creditors.push({ id, amt: v });
  }
  debtors.sort((a, b) => b.amt - a.amt);
  creditors.sort((a, b) => b.amt - a.amt);
  const transfers = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amt = Math.min(debtors[i].amt, creditors[j].amt);
    if (amt > 0) transfers.push({ from: debtors[i].id, to: creditors[j].id, amountPaise: amt });
    debtors[i].amt -= amt;
    creditors[j].amt -= amt;
    if (debtors[i].amt === 0) i++;
    if (creditors[j].amt === 0) j++;
  }
  return transfers;
}

/** Equal split with the leftover paise going to the first people (so totals always match). */
export function shares(amountPaise, ids) {
  const base = Math.floor(amountPaise / ids.length);
  let rest = amountPaise - base * ids.length;
  return ids.map((id) => ({ id, share: base + (rest-- > 0 ? 1 : 0) }));
}

async function participants(tripId) {
  const rows = await prisma.tripMember.findMany({
    where: { tripId, status: { not: "REMOVED" } },
    select: { userId: true, user: { select: { name: true } } },
  });
  return rows.map((r) => ({ userId: r.userId, name: r.user.name }));
}

export async function summary(tripId, user) {
  await assertTripAccess(tripId, user);
  const [expenses, people] = await Promise.all([
    prisma.expense.findMany({ where: { tripId }, orderBy: { createdAt: "asc" }, include: { paidBy: { select: { name: true } } } }),
    participants(tripId),
  ]);
  const names = Object.fromEntries(people.map((p) => [p.userId, p.name]));
  const balances = Object.fromEntries(people.map((p) => [p.userId, 0]));
  for (const e of expenses) {
    names[e.paidById] ||= e.paidBy.name;
    balances[e.paidById] = (balances[e.paidById] || 0) + e.amountPaise;
    for (const { id, share } of shares(e.amountPaise, e.splitAmong)) balances[id] = (balances[id] || 0) - share;
  }
  return {
    expenses: expenses.map(({ paidBy, ...e }) => ({ ...e, paidByName: paidBy.name })),
    totalPaise: expenses.reduce((s, e) => s + e.amountPaise, 0),
    people: Object.keys(balances).map((id) => ({ userId: id, name: names[id] || "Rider", balancePaise: balances[id] })),
    settlements: settle(balances).map((t) => ({ ...t, fromName: names[t.from], toName: names[t.to] })),
  };
}

export async function addExpense(tripId, user, { amount, description, splitAmong }) {
  await assertTripAccess(tripId, user);
  const people = await participants(tripId);
  const valid = new Set(people.map((p) => p.userId));
  if (!valid.has(user.id)) throw ApiError.forbidden("Join the ride to add shared expenses");
  const among = (splitAmong?.length ? splitAmong : [...valid]).filter((id) => valid.has(id));
  if (!among.length) throw ApiError.badRequest("Pick at least one rider to split with");
  const e = await prisma.expense.create({
    data: { tripId, paidById: user.id, amountPaise: Math.round(amount * 100), description, splitAmong: [...new Set(among)] },
  });
  emitToTrip(tripId, "expenses:changed", { tripId });
  return e;
}

export async function deleteExpense(tripId, expenseId, user) {
  const { isAdmin } = await assertTripAccess(tripId, user);
  const e = await prisma.expense.findUnique({ where: { id: expenseId } });
  if (!e || e.tripId !== tripId) throw ApiError.notFound("Expense not found");
  if (e.paidById !== user.id && !isAdmin) throw ApiError.forbidden("Only the person who paid (or the admin) can delete this");
  await prisma.expense.delete({ where: { id: expenseId } });
  emitToTrip(tripId, "expenses:changed", { tripId });
  return { deleted: true };
}
