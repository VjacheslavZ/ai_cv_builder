/** On the host, load the repo-root .env (docker compose passes variables directly). */
export function loadEnvFile(): void {
  try {
    process.loadEnvFile(new URL('../../../../.env', import.meta.url));
  } catch {
    // no .env file: rely on the environment
  }
}
