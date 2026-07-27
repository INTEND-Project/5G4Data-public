const DEFAULT_APP_BASE_PATH = "/tmf-simulator";

export function getConfiguredAppBasePath(
  source: Partial<Record<string, string | undefined>>,
) {
  const value = source.APP_BASE_PATH?.trim();

  if (!value) {
    return DEFAULT_APP_BASE_PATH;
  }

  if (value === "/") {
    return "";
  }

  const normalizedValue = value.replace(/^\/+/, "/").replace(/\/+$/, "");

  return normalizedValue.startsWith("/") ? normalizedValue : `/${normalizedValue}`;
}

export const APP_BASE_PATH = getConfiguredAppBasePath({
  APP_BASE_PATH:
    process.env.NEXT_PUBLIC_APP_BASE_PATH ?? process.env.APP_BASE_PATH,
});

export function withAppBasePath(path: string, basePath = APP_BASE_PATH) {
  if (!basePath) {
    return path;
  }

  if (path === "/") {
    return basePath;
  }

  if (path.startsWith(basePath)) {
    return path;
  }

  return `${basePath}${path}`;
}

export function buildAppUrl(request: Request, path: string, basePath = APP_BASE_PATH) {
  return new URL(withAppBasePath(path, basePath), request.url);
}
