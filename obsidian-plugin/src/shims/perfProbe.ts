// [[obsidian-plugin#An Obsidian plugin shows Solenoid's values with the app's own chips]]
export function perfEnabled(): boolean { return false; }
export function recordNode(_id: string, _type: string, _ms: number): void {}
export function recordIpc(_command: string, _ms: number, _bytes: number): void {}
export function ipcSnapshot(): { calls: number; ms: number } { return { calls: 0, ms: 0 }; }
export function beginPass(): void {}
export function passTopNodes(_n: number): Array<{ id: string; type: string; ms: number }> { return []; }
