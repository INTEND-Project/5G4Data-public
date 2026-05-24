import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { readDotEnvKey, updateEnvFile } from "./envConfigWriter.js";

export interface WriteCloneDockerComposeInput {
  cloneDir: string;
  cloneName: string;
  port: string;
}

export interface RunCloneContainerResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  containerName: string;
  projectName: string;
}

function sanitizeDockerName(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned.length > 0 ? cleaned : "agent";
}

export function containerNameForClone(cloneName: string): string {
  return `simulator-agent-${sanitizeDockerName(cloneName)}`;
}

export function projectNameForClone(cloneName: string): string {
  return sanitizeDockerName(cloneName);
}

export function ensureContainerEnvDefaults(cloneEnvPath: string): void {
  const updates: Array<{ key: string; value: string }> = [];
  if (!readDotEnvKey(cloneEnvPath, "API_SERVER_ENABLED")) {
    updates.push({ key: "API_SERVER_ENABLED", value: "true" });
  }
  if (!readDotEnvKey(cloneEnvPath, "API_SERVER_HOST")) {
    updates.push({ key: "API_SERVER_HOST", value: "0.0.0.0" });
  }
  if (updates.length > 0) {
    updateEnvFile(cloneEnvPath, updates);
  }
}

export function renderCloneDockerCompose(input: WriteCloneDockerComposeInput): string {
  const containerName = containerNameForClone(input.cloneName);
  const port = input.port.trim() || "3011";
  return `services:
  agent:
    build: .
    container_name: ${containerName}
    env_file: .env
    ports:
      - "${port}:${port}"
    environment:
      API_SERVER_ENABLED: "true"
      API_SERVER_HOST: "0.0.0.0"
      API_SERVER_PORT: "${port}"
    restart: unless-stopped
`;
}

export function writeCloneDockerCompose(input: WriteCloneDockerComposeInput): string {
  const composePath = join(input.cloneDir, "docker-compose.yml");
  const content = renderCloneDockerCompose(input);
  writeFileSync(composePath, content, "utf8");
  return composePath;
}

export function dockerComposeAvailable(): boolean {
  const result = spawnSync("docker", ["compose", "version"], {
    encoding: "utf8",
    stdio: "pipe"
  });
  return result.status === 0;
}

export function runCloneContainer(
  cloneDir: string,
  cloneName: string,
  port: string
): RunCloneContainerResult {
  const containerName = containerNameForClone(cloneName);
  const projectName = projectNameForClone(cloneName);
  const result = spawnSync(
    "docker",
    [
      "compose",
      "-f",
      "docker-compose.yml",
      "--project-name",
      projectName,
      "up",
      "-d",
      "--build"
    ],
    {
      cwd: cloneDir,
      encoding: "utf8",
      stdio: "pipe",
      env: {
        ...process.env,
        API_SERVER_PORT: port
      }
    }
  );
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status,
    containerName,
    projectName
  };
}

export function healthCheckUrl(port: number): string {
  return `http://127.0.0.1:${port}/health`;
}

export async function waitForAgentHealth(
  port: number,
  timeoutMs = 60_000,
  intervalMs = 1_000
): Promise<boolean> {
  const url = healthCheckUrl(port);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
      if (response.ok) {
        return true;
      }
    } catch {
      // retry until timeout
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

export function containerLoadEnabled(): boolean {
  const raw = process.env.CONTAINER_LOAD;
  if (raw === undefined) return true;
  const normalized = raw.trim().toLowerCase();
  return !["0", "false", "no", "off"].includes(normalized);
}
