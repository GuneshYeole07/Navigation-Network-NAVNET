import * as tripService from "../services/trip.service.js";
import * as messageService from "../services/message.service.js";
import { ok } from "../utils/respond.js";
import * as ride from "../services/ride.service.js";
import * as poi from "../services/poi.service.js";
import * as expense from "../services/expense.service.js";

export const create = async (req, res) => ok(res, await tripService.createTrip(req.user.id, req.body), 201);
export const listMine = async (req, res) => ok(res, await tripService.listAdminTrips(req.user.id));
export const listJoined = async (req, res) => ok(res, await tripService.listJoinedTrips(req.user.id));
export const join = async (req, res) => ok(res, await tripService.joinTrip(req.user, req.body));
export const getOne = async (req, res) => ok(res, await tripService.getTripSnapshot(req.params.id, req.user));
export const changeStatus = async (req, res) =>
  ok(res, await tripService.changeStatus(req.params.id, req.user, req.body.action));
export const setLeader = async (req, res) =>
  ok(res, await tripService.setLeader(req.params.id, req.user, req.body.userId));
export const removeMember = async (req, res) =>
  ok(res, await tripService.removeMember(req.params.id, req.user, req.params.userId));
export const leave = async (req, res) => ok(res, await tripService.leaveTrip(req.params.id, req.user));
export const alerts = async (req, res) => ok(res, await tripService.listAlerts(req.params.id, req.user));
export const ackAlert = async (req, res) => ok(res, await tripService.acknowledgeAlert(req.params.alertId, req.user));
export const report = async (req, res) => ok(res, await tripService.getReport(req.params.id, req.user));

export const messages = async (req, res) =>
  ok(res, await messageService.listMessages(req.params.id, req.user, req.q));
export const sendMessage = async (req, res) =>
  ok(res, await messageService.sendMessage(req.params.id, req.user, req.body), 201);
export const broadcast = async (req, res) =>
  ok(res, await messageService.broadcast(req.params.id, req.user, req.body.body), 201);
export const threads = async (req, res) => ok(res, await messageService.privateThreads(req.params.id, req.user));
export const contacts = async (req, res) => ok(res, await tripService.listContacts(req.params.id, req.user));
export const invite = async (req, res) => ok(res, await tripService.createInvite(req.params.id, req.user));

// Ride captain & group riding
export const rideAsCaptain = async (req, res) => ok(res, await ride.rideAsCaptain(req.params.id, req.user));
export const setSweep = async (req, res) => ok(res, await ride.setSweep(req.params.id, req.user, req.body.userId));
export const setChecklist = async (req, res) => ok(res, await ride.setChecklist(req.params.id, req.user, req.body.items));
export const voice = async (req, res) => {
  const meta = { durationMs: Number(req.body.durationMs) || 0, recipientId: req.body.recipientId || undefined };
  ok(res, await messageService.sendVoice(req.params.id, req.user, { file: req.file, ...meta }), 201);
};
export const pois = async (req, res) => ok(res, await poi.getPois(req.params.id, req.user, req.q));
export const expenses = async (req, res) => ok(res, await expense.summary(req.params.id, req.user));
export const addExpense = async (req, res) => ok(res, await expense.addExpense(req.params.id, req.user, req.body), 201);
export const deleteExpense = async (req, res) => ok(res, await expense.deleteExpense(req.params.id, req.params.expenseId, req.user));
