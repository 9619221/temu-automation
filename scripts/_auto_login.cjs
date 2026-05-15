const { app, safeStorage } = require("electron");
const fs = require("fs");
const path = require("path");
const http = require("http");

// CRITICAL: Must match the main GUI's appName so safeStorage entropy aligns.
// Electron独立脚本不会读 cwd/package.json，需要显式 setName。
app.setName("temu-automation");
const appdataDir = process.env.APPDATA || path.join(process.env.USERPROFILE, "AppData", "Roaming");
app.setPath("userData", path.join(appdataDir, "temu-automation"));

app.whenReady().then(async () => {
  let exitCode = 0;
  try {
    console.log(`[diag] appName=${app.getName()} version=${app.getVersion()}`);
    console.log(`[diag] userData=${app.getPath("userData")}`);
    console.log(`[diag] exePath=${app.getPath("exe")}`);
    console.log(`[diag] electron=${process.versions.electron}`);
    console.log(`[diag] cwd=${process.cwd()}`);
    console.log(`[diag] safeStorageAvailable=${safeStorage.isEncryptionAvailable()}`);
    console.log(`[diag] selectedStorageBackend=${typeof safeStorage.getSelectedStorageBackend === "function" ? safeStorage.getSelectedStorageBackend() : "n/a"}`);
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("safeStorage encryption not available");
    }
    const appdata = process.env.APPDATA || path.join(process.env.USERPROFILE, "AppData", "Roaming");
    const dataDir = path.join(appdata, "temu-automation");
    const accounts = JSON.parse(fs.readFileSync(path.join(dataDir, "temu_accounts.json"), "utf8"));
    const portFile = JSON.parse(fs.readFileSync(path.join(dataDir, "worker-port"), "utf8"));

    const target = (accounts.accounts || []).find((a) => a.name === "OpalStyle")
      || (accounts.accounts || [])[0];
    if (!target) throw new Error("No account found");

    let password = target.password || "";
    if (password.startsWith("enc:")) {
      password = safeStorage.decryptString(Buffer.from(password.slice(4), "base64"));
    }
    if (!password) throw new Error("Decrypted password is empty");

    console.log(`[auto-login] target accountId=${target.id} phone=${target.phone} name=${target.name} pwdLen=${password.length}`);

    const body = JSON.stringify({
      action: "login",
      params: {
        accountId: target.id,
        phone: target.phone,
        password,
        credentials: { accountId: target.id, phone: target.phone, password },
      },
    });

    const result = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: portFile.port,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
            "Authorization": `Bearer ${portFile.token}`,
          },
          timeout: 5 * 60 * 1000,
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
        },
      );
      req.on("error", reject);
      req.on("timeout", () => { req.destroy(new Error("Worker login timed out (5min)")); });
      req.write(body);
      req.end();
    });

    console.log(`[auto-login] worker status=${result.status}`);
    console.log(`[auto-login] worker body=${result.body}`);
  } catch (e) {
    console.error(`[auto-login] FAIL: ${e.message}`);
    exitCode = 1;
  } finally {
    app.exit(exitCode);
  }
});
