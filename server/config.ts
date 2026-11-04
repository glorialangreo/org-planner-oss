import { resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';

export type Config = {
  origin: string; databasePath: string; distPath: string; snapshotPath: string;
};
export function localOrigin(value: string) {
  const origin = new URL(value);
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' ||
      origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) {
    throw new Error('APP_ORIGIN must be an HTTP 127.0.0.1 origin. This app has no authentication and must remain local-only.');
  }
  return origin;
}
export function configuration(env = process.env): Config {
  const origin = localOrigin(env.APP_ORIGIN || 'http://127.0.0.1:4186');
  const dataDir = env.DATA_DIR || resolve(homedir(), '.org-planner');
  if (!isAbsolute(dataDir)) throw new Error('DATA_DIR must be an absolute directory.');
  return {
    origin: origin.origin, databasePath: resolve(dataDir, 'planner.json'),
    distPath: resolve('dist'), snapshotPath: resolve(dataDir, 'exports'),
  };
}
