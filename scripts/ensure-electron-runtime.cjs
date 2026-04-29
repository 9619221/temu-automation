const { spawnSync } = require("child_process");

function relaunchUnderElectronIfNeeded(scriptPath, args = process.argv.slice(2)) {
  if (process.versions.electron) return false;

  const electronPath = require("electron");
  const result = spawnSync(electronPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if (typeof result.status === "number") {
    process.exit(result.status);
  }
  if (result.signal) {
    console.error(`Electron test runtime exited via signal ${result.signal}`);
    process.exit(1);
  }
  process.exit(1);
}

module.exports = {
  relaunchUnderElectronIfNeeded,
};
