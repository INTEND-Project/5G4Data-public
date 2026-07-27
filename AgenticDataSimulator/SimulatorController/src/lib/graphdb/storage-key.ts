export function graphDbBaseUrlStorageKey(userId: string): string {
  return `simulator-controller:graphdb-base-url:${userId}`;
}
