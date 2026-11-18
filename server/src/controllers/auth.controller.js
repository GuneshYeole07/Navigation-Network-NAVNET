import * as authService from "../services/auth.service.js";
import { ok } from "../utils/respond.js";

export const register = async (req, res) => ok(res, await authService.register(req.body), 201);
export const login = async (req, res) => ok(res, await authService.login(req.body));
export const me = async (req, res) => ok(res, { user: req.user });
export const updateMe = async (req, res) => ok(res, { user: await authService.updateProfile(req.user.id, req.body) });
