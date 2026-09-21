// [[C107]] obsidianPlugin
// A property is an eager value; there is no lazy frame handle to collect.
export type FrameRef = never;

export function collectPreview(): Promise<null> {
  return Promise.resolve(null);
}

export function readFrame(): Promise<null> {
  return Promise.resolve(null);
}
