#!/usr/bin/env npx tsx
/**
 * Create or update Grafana logins for every Controller user in the SQLite database.
 *
 * Controller stores bcrypt hashes only — you must supply Grafana passwords explicitly:
 *   - scripts/grafana-user-passwords.env (USERNAME=password per line), and/or
 *   - --password / GRAFANA_MIGRATION_PASSWORD (same password for all users)
 *
 * Usage:
 *   npm run grafana:provision-users
 *   npm run grafana:provision-users -- --dry-run
 *   npm run grafana:provision-users -- --password 'shared-lab-password'
 *   npm run grafana:provision-users -- --credentials-file scripts/grafana-user-passwords.env
 */
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "dotenv";
import { PrismaClient } from "@prisma/client";

import { verifyPassword } from "../src/lib/auth/password";
import { loadAppEnv } from "../src/lib/env";
import {
  loadExistingUserPasswordSource,
  resolvePasswordForUsername,
  type ProvisionExistingUsersOptions,
} from "../src/lib/grafana/provision-existing-users";
import {
  GrafanaProvisioningError,
  grafanaProvisioningEnvFromProcess,
  provisionGrafanaUser,
} from "../src/lib/grafana/provision-user";

const ROOT = resolve(__dirname, "..");

function loadProvisioningEnv(): NodeJS.ProcessEnv {
  const merged: Record<string, string> = {};

  for (const file of [
    resolve(ROOT, ".env"),
    resolve(ROOT, "scripts/grafana-admin.env"),
    resolve(ROOT, "../Grafana/.env"),
  ]) {
    if (!existsSync(file)) {
      continue;
    }

    for (const [key, value] of Object.entries(parse(readFileSync(file, "utf8")))) {
      if (typeof value === "string") {
        merged[key] = value;
      }
    }
  }

  return { ...process.env, ...merged };
}

type CliOptions = ProvisionExistingUsersOptions & {
  force?: boolean;
  verifyControllerPassword?: boolean;
  assignGeneratedPasswords?: boolean;
  generatedPasswordsFile?: string;
};

function generatedPassword(): string {
  return randomBytes(18).toString("base64url");
}

function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    verifyControllerPassword: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--create-only") {
      options.createOnly = true;
      continue;
    }

    if (arg === "--force") {
      options.force = true;
      options.verifyControllerPassword = false;
      continue;
    }

    if (arg === "--assign-generated-passwords") {
      options.assignGeneratedPasswords = true;
      options.verifyControllerPassword = false;
      continue;
    }

    if (arg === "--generated-passwords-file") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--generated-passwords-file requires a path.");
      }
      options.generatedPasswordsFile = resolve(ROOT, value);
      index += 1;
      continue;
    }

    if (arg.startsWith("--generated-passwords-file=")) {
      options.generatedPasswordsFile = resolve(ROOT, arg.slice("--generated-passwords-file=".length));
      continue;
    }

    if (arg === "--password") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--password requires a value.");
      }
      options.defaultPassword = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--password=")) {
      options.defaultPassword = arg.slice("--password=".length);
      continue;
    }

    if (arg === "--credentials-file") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--credentials-file requires a path.");
      }
      options.credentialsFile = resolve(ROOT, value);
      index += 1;
      continue;
    }

    if (arg.startsWith("--credentials-file=")) {
      options.credentialsFile = resolve(ROOT, arg.slice("--credentials-file=".length));
      continue;
    }

    if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.credentialsFile) {
    const defaultCredentialsPath = resolve(ROOT, "scripts/grafana-user-passwords.env");
    if (existsSync(defaultCredentialsPath)) {
      options.credentialsFile = defaultCredentialsPath;
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage: npm run grafana:provision-users -- [options]

Options:
  --dry-run                 List actions without calling Grafana
  --create-only             Do not change password when Grafana login already exists
  --force                   Set Grafana password even if it does not match the Controller hash
  --assign-generated-passwords
                            Create Grafana logins with random passwords (written to scripts/grafana-assigned-passwords.env)
  --password <value>        Password for all users (or set GRAFANA_MIGRATION_PASSWORD)
  --credentials-file <path> Per-user USERNAME=password file (default: scripts/grafana-user-passwords.env if present)

By default each password is checked against the Controller bcrypt hash before calling Grafana.

Requires GRAFANA_BASE_URL and GRAFANA_ADMIN_PASSWORD in .env.
`);
}

async function main() {
  const envSource = loadProvisioningEnv();
  const cli = parseCliArgs(process.argv.slice(2));
  const passwordSource = loadExistingUserPasswordSource(cli, envSource);
  const generatedPasswordsPath =
    cli.generatedPasswordsFile ?? resolve(ROOT, "scripts/grafana-assigned-passwords.env");

  if (
    !cli.assignGeneratedPasswords &&
    !passwordSource.defaultPassword &&
    passwordSource.passwordsByUsername.size === 0
  ) {
    console.error(
      "error: provide passwords via --password, GRAFANA_MIGRATION_PASSWORD, a credentials file, or --assign-generated-passwords.",
    );
    process.exit(1);
  }

  const grafanaEnv = grafanaProvisioningEnvFromProcess(envSource);
  if (!grafanaEnv) {
    console.error(
      "error: set GRAFANA_BASE_URL and GRAFANA_ADMIN_PASSWORD (or GRAFANA_API_KEY with users:create) in .env or scripts/grafana-admin.env",
    );
    process.exit(1);
  }

  const appEnv = loadAppEnv(envSource);
  const prisma = new PrismaClient({
    datasources: {
      db: { url: appEnv.databaseUrl },
    },
  });

  const users = await prisma.user.findMany({
    select: { username: true, passwordHash: true },
    orderBy: { username: "asc" },
  });

  if (users.length === 0) {
    console.log("No Controller users found.");
    await prisma.$disconnect();
    return;
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let missingPassword = 0;
  let passwordMismatch = 0;
  let failed = 0;

  if (cli.assignGeneratedPasswords && !cli.dryRun) {
    appendFileSync(
      generatedPasswordsPath,
      `# Grafana passwords assigned ${new Date().toISOString()}\n`,
      { flag: "w" },
    );
  }

  for (const user of users) {
    let password = resolvePasswordForUsername(user.username, passwordSource);

    if (cli.assignGeneratedPasswords) {
      password = generatedPassword();
    }

    if (!password) {
      missingPassword += 1;
      console.warn(`skip ${user.username}: no password in credentials file or --password`);
      continue;
    }

    if (cli.verifyControllerPassword && !cli.assignGeneratedPasswords) {
      const matches = await verifyPassword(password, user.passwordHash);
      if (!matches) {
        passwordMismatch += 1;
        console.warn(
          `skip ${user.username}: password does not match Controller account (use --force to override)`,
        );
        continue;
      }
    }

    if (cli.dryRun) {
      console.log(
        `would provision grafana login=${user.username}${cli.assignGeneratedPasswords ? " (generated password)" : ""}`,
      );
      continue;
    }

    if (cli.assignGeneratedPasswords) {
      appendFileSync(generatedPasswordsPath, `${user.username}=${password}\n`);
    }

    try {
      const result = await provisionGrafanaUser(
        {
          login: user.username,
          password,
          name: user.username,
        },
        {
          env: grafanaEnv,
          envSource,
          onExisting: cli.createOnly ? "skip" : "sync-password",
        },
      );

      if (!result.provisioned) {
        skipped += 1;
        console.log(`skip ${user.username}: grafana login already exists`);
        continue;
      }

      if (result.syncedExistingPassword) {
        updated += 1;
        console.log(`updated ${user.username} (grafana id ${result.userId})`);
      } else {
        created += 1;
        console.log(`created ${user.username} (grafana id ${result.userId})`);
      }
    } catch (error) {
      failed += 1;
      const message =
        error instanceof GrafanaProvisioningError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      console.error(`fail ${user.username}: ${message}`);
    }
  }

  await prisma.$disconnect();

  if (cli.dryRun) {
    console.log(`Dry run: ${users.length} Controller user(s).`);
    return;
  }

  if (cli.assignGeneratedPasswords && (created > 0 || updated > 0)) {
    console.log(`Assigned passwords written to ${generatedPasswordsPath}`);
    console.log(
      "Users must sign in to Grafana with these passwords (they differ from Controller until you align them).",
    );
  }

  console.log(
    `Done: created=${created} updated=${updated} skipped=${skipped} missing_password=${missingPassword} password_mismatch=${passwordMismatch} failed=${failed}`,
  );

  if (missingPassword > 0 || passwordMismatch > 0 || failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
