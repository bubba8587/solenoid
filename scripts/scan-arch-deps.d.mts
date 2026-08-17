export type ArchDeps = { files: string[]; imports: Record<string, string[]> };
export function scanArchDeps(rootDir: string): ArchDeps;
