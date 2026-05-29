import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  // 不允许用弱默认密钥启动：缺失 JWT_SECRET 时任何 JWT 都可被伪造（任意租户/角色）
  throw new Error("[auth] JWT_SECRET 未配置，拒绝启动（请在 .env 或 systemd Environment 中设置）");
}

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
