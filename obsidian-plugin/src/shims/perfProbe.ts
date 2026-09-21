// [[C107]] obsidianPlugin
// No graph pass to time, and a plugin writes no globals; the app's probe registers two.
export function perfEnabled(): boolean { return false; }
export function recordNode(): void {}
export function recordIpc(): void {}
export function ipcSnapshot(): { calls: number; ms: number } { return { calls: 0, ms: 0 }; }
export function beginPass(): void {}
export function passTopNodes(): Array<{ id: string; type: string; ms: number }> { return []; }
