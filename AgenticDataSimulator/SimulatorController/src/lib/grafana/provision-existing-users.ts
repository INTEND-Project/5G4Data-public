import { readFileSync } from "node:fs";

export type ExistingUserPasswordSource = {
  defaultPassword?: string;
  passwordsByUsername: Map<string, string>;
};

export type ProvisionExistingUsersOptions = {
  dryRun?: boolean;
  createOnly?: boolean;
  credentialsFile?: string;
  defaultPassword?: string;
};

export function parseCredentialsEnvFile(source: string): Map<string, string> {
  const passwords = new Map<string, string>();

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const eq = line.indexOf("=");
    if (eq <= 0) {
      throw new Error(`Invalid credentials line (expected USERNAME=password): ${rawLine}`);
    }

    const username = line.slice(0, eq).trim();
    const password = line.slice(eq + 1).trim();

    if (!username) {
      throw new Error(`Invalid credentials line (empty username): ${rawLine}`);
    }
    if (!password) {
      throw new Error(`Invalid credentials line (empty password for ${username})`);
    }

    passwords.set(username, password);
  }

  return passwords;
}

export function loadExistingUserPasswordSource(
  options: ProvisionExistingUsersOptions,
  envSource: Partial<Record<string, string | undefined>> = process.env,
): ExistingUserPasswordSource {
  const passwordsByUsername = new Map<string, string>();

  if (options.credentialsFile) {
    const fileContents = readFileSync(options.credentialsFile, "utf8");
    for (const [username, password] of parseCredentialsEnvFile(fileContents)) {
      passwordsByUsername.set(username, password);
    }
  }

  const defaultPassword =
    options.defaultPassword?.trim() ||
    envSource.GRAFANA_MIGRATION_PASSWORD?.trim() ||
    undefined;

  return {
    defaultPassword,
    passwordsByUsername,
  };
}

export function resolvePasswordForUsername(
  username: string,
  source: ExistingUserPasswordSource,
): string | null {
  return source.passwordsByUsername.get(username) ?? source.defaultPassword ?? null;
}
