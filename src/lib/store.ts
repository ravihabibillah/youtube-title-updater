import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type VideoRow = {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
  categoryId: string;
  thumbnailUrl: string | null;
  proposedTitle: string | null;
  status: "eligible" | "unchanged" | "empty" | "invalid" | "unavailable" | "updated" | "failed" | "conflict" | "pending" | "blocked";
  reason: string | null;
};

export type BatchItem = {
  videoId: string;
  oldTitle: string;
  newTitle: string;
  status: "pending" | "updated" | "failed" | "conflict" | "blocked";
  error?: string;
};

export type Store = {
  channelId: string | null;
  channelTitle: string | null;
  rows: VideoRow[];
  batch: { id: string; status: "running" | "paused" | "complete"; items: BatchItem[] } | null;
};

const stateDir = process.env.YTU_STATE_DIR ?? join(process.cwd(), "state");
const file = join(stateDir, "app.json");
let queue = Promise.resolve();

export async function updateStore<T>(fn: (store: Store) => T | Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    let store: Store;
    try {
      store = JSON.parse(await readFile(file, "utf8")) as Store;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      store = { channelId: null, channelTitle: null, rows: [], batch: null };
    }
    const result = await fn(store);
    const temp = `${file}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(store), { mode: 0o600 });
    await rename(temp, file);
    return result;
  });
  queue = run.then(() => undefined, () => undefined);
  return run;
}

export async function readStore(): Promise<Store> {
  return updateStore((store) => structuredClone(store));
}
