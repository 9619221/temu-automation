import bcrypt from "bcryptjs";
import { getDb } from "../db/connection.js";
import { migrate } from "../db/migrate.js";

migrate();
const db = getDb();

const tenantId = "default-tenant";
const username = "admin";
const password = process.argv[2] || "changeme123";

db.prepare("INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)").run(tenantId, "默认团队");

const hash = bcrypt.hashSync(password, 10);
const exist = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
if (exist) {
  db.prepare("UPDATE users SET password_hash = ?, tenant_id = ?, role = ? WHERE id = ?")
    .run(hash, tenantId, "admin", exist.id);
  console.log(`[seed] 已更新用户 ${username}（密码已重置）`);
} else {
  db.prepare("INSERT INTO users (id, tenant_id, username, password_hash, role) VALUES (?, ?, ?, ?, ?)")
    .run("admin", tenantId, username, hash, "admin");
  console.log(`[seed] 已创建用户 ${username}`);
}

console.log(`\n登录信息：\n  username: ${username}\n  password: ${password}\n  tenant_id: ${tenantId}\n`);
console.log(`登录命令：\n  curl -X POST http://localhost:8788/api/auth/login -H 'Content-Type: application/json' -d '{"username":"${username}","password":"${password}"}'`);
