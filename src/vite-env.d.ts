/// <reference types="vite/client" />

declare module "virtual:arch-deps" {
  const deps: { files: string[]; imports: Record<string, string[]> };
  export default deps;
}
