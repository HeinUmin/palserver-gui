/** Optional shared user-defined network. Compose creates and attaches the Agent. */
export function dockerNetworkName(): string | undefined {
  return process.env.PALSERVER_DOCKER_NETWORK?.trim() || undefined;
}

/** Independent of the display name and container ID, so restarts retain DNS. */
export function instanceHostname(id: string): string {
  return `palserver-${id}`;
}
