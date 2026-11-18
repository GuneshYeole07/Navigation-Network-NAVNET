import * as svc from "../services/community.service.js";
import { ok } from "../utils/respond.js";

export const create = async (req, res) => ok(res, await svc.createCommunity(req.user.id, req.body), 201);
export const list = async (req, res) => ok(res, await svc.listPublic(req.q, req.user.id));
export const listOwned = async (req, res) => ok(res, await svc.listOwned(req.user.id));
export const getOne = async (req, res) => ok(res, await svc.getCommunity(req.params.id, req.user));
export const requestJoin = async (req, res) =>
  ok(res, await svc.requestJoin(req.params.id, req.user, req.body.message), 201);
export const requests = async (req, res) => ok(res, await svc.listRequests(req.params.id, req.user));
export const decide = async (req, res) =>
  ok(res, await svc.decideRequest(req.params.id, req.params.memberId, req.user, req.body.decision));
export const announce = async (req, res) => ok(res, await svc.postAnnouncement(req.params.id, req.user, req.body), 201);
