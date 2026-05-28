import { loadAppEnv } from "@/lib/env";

export type GrafanaProvisioningEnv = {
  baseUrl: string;
  adminUser: string;
  adminPassword?: string;
  emailDomain: string;
  orgId?: number;
};

export type ProvisionGrafanaUserInput = {
  login: string;
  password: string;
  name?: string;
};

export type ProvisionGrafanaUserResult = {
  provisioned: boolean;
  userId?: number;
  syncedExistingPassword?: boolean;
};

export class GrafanaProvisioningError extends Error {
  readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "GrafanaProvisioningError";
    this.statusCode = statusCode;
  }
}

export function grafanaProvisioningEnvFromProcess(
  source: Partial<Record<string, string | undefined>> = process.env,
): GrafanaProvisioningEnv | null {
  const env = loadAppEnv(source);
  const baseUrl = env.grafanaBaseUrl?.replace(/\/$/, "");

  if (!baseUrl) {
    return null;
  }

  const adminPassword = source.GRAFANA_ADMIN_PASSWORD?.trim();
  const apiKey = source.GRAFANA_API_KEY?.trim();
  if (!adminPassword && !apiKey) {
    return null;
  }

  const orgIdRaw = source.GRAFANA_ORG_ID?.trim();
  let orgId: number | undefined;
  if (orgIdRaw) {
    const parsed = Number.parseInt(orgIdRaw, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      throw new GrafanaProvisioningError("GRAFANA_ORG_ID must be a positive integer.");
    }
    orgId = parsed;
  }

  return {
    baseUrl,
    adminUser: source.GRAFANA_ADMIN_USER?.trim() || env.grafanaAdminUser,
    adminPassword: adminPassword || undefined,
    emailDomain: source.GRAFANA_USER_EMAIL_DOMAIN?.trim() || env.grafanaUserEmailDomain,
    orgId,
  };
}

function basicAuthHeader(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`, "utf8").toString("base64")}`;
}

function resolveGrafanaAdminAuth(
  config: GrafanaProvisioningEnv,
  source: Partial<Record<string, string | undefined>>,
): { authorization: string; mode: "basic" | "bearer" } | null {
  const apiKey = source.GRAFANA_API_KEY?.trim();
  if (apiKey) {
    return { authorization: `Bearer ${apiKey}`, mode: "bearer" };
  }

  const adminPassword = config.adminPassword ?? source.GRAFANA_ADMIN_PASSWORD?.trim();
  if (adminPassword) {
    return {
      authorization: basicAuthHeader(config.adminUser, adminPassword),
      mode: "basic",
    };
  }

  return null;
}

export function grafanaEmailForLogin(login: string, emailDomain: string): string {
  const trimmed = login.trim();
  if (trimmed.includes("@")) {
    return trimmed;
  }
  return `${trimmed}@${emailDomain}`;
}

function buildGrafanaUserPayload(
  input: ProvisionGrafanaUserInput,
  config: GrafanaProvisioningEnv,
): Record<string, unknown> {
  const login = input.login.trim();
  const payload: Record<string, unknown> = {
    name: input.name?.trim() || login,
    email: grafanaEmailForLogin(login, config.emailDomain),
    login,
    password: input.password,
  };

  if (config.orgId !== undefined) {
    payload.OrgId = config.orgId;
  }

  return payload;
}

async function readGrafanaErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    if (typeof body.message === "string" && body.message.trim()) {
      return body.message.trim();
    }
  } catch {
    // ignore parse errors
  }

  return `Grafana request failed (${response.status}).`;
}

async function grafanaAdminFetch(
  config: GrafanaProvisioningEnv,
  path: string,
  init: RequestInit,
  fetchFn: typeof fetch,
  source: Partial<Record<string, string | undefined>> = process.env,
): Promise<Response> {
  const auth = resolveGrafanaAdminAuth(config, source);
  if (!auth) {
    throw new GrafanaProvisioningError(
      "Grafana admin credentials are not configured (GRAFANA_ADMIN_PASSWORD or GRAFANA_API_KEY).",
    );
  }

  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("Authorization", auth.authorization);

  return fetchFn(`${config.baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
}

async function lookupGrafanaUserId(
  login: string,
  config: GrafanaProvisioningEnv,
  fetchFn: typeof fetch,
  source: Partial<Record<string, string | undefined>> = process.env,
): Promise<number | null> {
  const params = new URLSearchParams({ loginOrEmail: login });
  const response = await grafanaAdminFetch(
    config,
    `/api/users/lookup?${params.toString()}`,
    { method: "GET" },
    fetchFn,
    source,
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const message = await readGrafanaErrorMessage(response);
    if (response.status === 401) {
      throw new GrafanaProvisioningError(
        `${message} Check GRAFANA_ADMIN_USER/GRAFANA_ADMIN_PASSWORD (scripts/grafana-admin.env overrides .env).`,
        response.status,
      );
    }
    if (response.status === 403 && message.includes("users:create")) {
      throw new GrafanaProvisioningError(
        `${message} User provisioning requires Grafana server-admin basic auth; GRAFANA_API_KEY cannot create users.`,
        response.status,
      );
    }
    throw new GrafanaProvisioningError(message, response.status);
  }

  const body = (await response.json()) as { id?: number };
  return typeof body.id === "number" ? body.id : null;
}

async function updateGrafanaUserPassword(
  userId: number,
  password: string,
  config: GrafanaProvisioningEnv,
  fetchFn: typeof fetch,
  source: Partial<Record<string, string | undefined>> = process.env,
): Promise<void> {
  const response = await grafanaAdminFetch(
    config,
    `/api/admin/users/${userId}/password`,
    {
      method: "PUT",
      body: JSON.stringify({ password }),
    },
    fetchFn,
    source,
  );

  if (!response.ok) {
    const message = await readGrafanaErrorMessage(response);
    if (response.status === 401) {
      throw new GrafanaProvisioningError(
        `${message} Check GRAFANA_ADMIN_USER/GRAFANA_ADMIN_PASSWORD (scripts/grafana-admin.env overrides .env).`,
        response.status,
      );
    }
    if (response.status === 403 && message.includes("users:create")) {
      throw new GrafanaProvisioningError(
        `${message} User provisioning requires Grafana server-admin basic auth; GRAFANA_API_KEY cannot create users.`,
        response.status,
      );
    }
    throw new GrafanaProvisioningError(message, response.status);
  }
}

async function createGrafanaUser(
  input: ProvisionGrafanaUserInput,
  config: GrafanaProvisioningEnv,
  fetchFn: typeof fetch,
  onExisting: "sync-password" | "skip" | "fail",
  source: Partial<Record<string, string | undefined>> = process.env,
): Promise<{ userId: number; syncedExistingPassword: boolean; skippedExisting: boolean }> {
  const response = await grafanaAdminFetch(
    config,
    "/api/admin/users",
    {
      method: "POST",
      body: JSON.stringify(buildGrafanaUserPayload(input, config)),
    },
    fetchFn,
    source,
  );

  if (response.ok) {
    const body = (await response.json()) as { id?: number };
    if (typeof body.id !== "number") {
      throw new GrafanaProvisioningError("Grafana did not return a user id.");
    }
    return { userId: body.id, syncedExistingPassword: false, skippedExisting: false };
  }

  if (response.status !== 412) {
    throw new GrafanaProvisioningError(
      await readGrafanaErrorMessage(response),
      response.status,
    );
  }

  const login = input.login.trim();
  const userId = await lookupGrafanaUserId(login, config, fetchFn, source);
  if (userId === null) {
    throw new GrafanaProvisioningError(
      "Grafana reported the user already exists, but lookup failed.",
      412,
    );
  }

  if (onExisting === "fail") {
    throw new GrafanaProvisioningError(
      `Grafana login '${login}' already exists.`,
      412,
    );
  }

  if (onExisting === "skip") {
    return { userId, syncedExistingPassword: false, skippedExisting: true };
  }

  await updateGrafanaUserPassword(userId, input.password, config, fetchFn, source);
  return { userId, syncedExistingPassword: true, skippedExisting: false };
}

export type ProvisionGrafanaUserOptions = {
  env?: GrafanaProvisioningEnv | null;
  envSource?: Partial<Record<string, string | undefined>>;
  fetchFn?: typeof fetch;
  /** When Grafana login already exists: update password, skip, or fail. Default: sync-password. */
  onExisting?: "sync-password" | "skip" | "fail";
};

export async function provisionGrafanaUser(
  input: ProvisionGrafanaUserInput,
  options?: ProvisionGrafanaUserOptions,
): Promise<ProvisionGrafanaUserResult> {
  const envSource = options?.envSource ?? process.env;
  const config = options?.env ?? grafanaProvisioningEnvFromProcess(envSource);
  if (!config) {
    return { provisioned: false };
  }

  const fetchFn = options?.fetchFn ?? fetch;
  const onExisting = options?.onExisting ?? "sync-password";
  const result = await createGrafanaUser(input, config, fetchFn, onExisting, envSource);

  if (result.skippedExisting) {
    return {
      provisioned: false,
      userId: result.userId,
      syncedExistingPassword: false,
    };
  }

  return {
    provisioned: true,
    userId: result.userId,
    syncedExistingPassword: result.syncedExistingPassword,
  };
}
