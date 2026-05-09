import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

export function signToken(user) {
  return jwt.sign(
    { uid: user.id, tid: user.tenant_id, role: user.role, name: user.username },
    SECRET,
    { expiresIn: "30d" }
  );
}

export function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || "";
  const m = /^Bearer\s+(.+)$/.exec(auth);
  if (!m) return res.status(401).json({ error: "no_token" });
  try {
    req.user = jwt.verify(m[1], SECRET);
    next();
  } catch (e) {
    res.status(401).json({ error: "invalid_token" });
  }
}
