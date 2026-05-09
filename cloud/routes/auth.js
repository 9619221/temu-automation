import { Router } from "express";
import bcrypt from "bcryptjs";
import { getDb } from "../db/connection.js";
import { signToken, authMiddleware } from "../middleware/auth.js";

const r = Router();

r.post("/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "username/password 必填" });
  const db = getDb();
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "invalid_credentials" });
  }
  const token = signToken(user);
  res.json({
    token,
    user: { id: user.id, username: user.username, role: user.role, tenant_id: user.tenant_id },
  });
});

r.get("/me", authMiddleware, (req, res) => {
  const db = getDb();
  const u = db.prepare("SELECT id, username, role, tenant_id FROM users WHERE id = ?").get(req.user.uid);
  if (!u) return res.status(404).json({ error: "not_found" });
  res.json(u);
});

export default r;
