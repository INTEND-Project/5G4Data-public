export function prometheusBaseUrlStorageKey(userId: string): string {
  return `simulator-controller:prometheus-base-url:${userId}`;
}
