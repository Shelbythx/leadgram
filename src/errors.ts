export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function exitWithError(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}
