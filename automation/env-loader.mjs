import fs from "fs";

export function applyEnvText(text, targetEnv = process.env) {
  for (const line of String(text || "").split("\n")) {
    const match = line.match(/^([^#=]+)=(.+)$/);
    if (match && !targetEnv[match[1].trim()]) {
      targetEnv[match[1].trim()] = match[2].trim();
    }
  }
}

export function loadFirstEnvFile(envFiles, options = {}) {
  const {
    targetEnv = process.env,
    fileSystem = fs,
    onError = () => {},
  } = options;

  for (const envFile of envFiles) {
    try {
      if (fileSystem.existsSync(envFile)) {
        applyEnvText(fileSystem.readFileSync(envFile, "utf8"), targetEnv);
        return { loaded: true, file: envFile };
      }
    } catch (error) {
      onError(error, envFile);
    }
  }

  return { loaded: false, file: null };
}
