import "server-only";
import { randomUUID } from "node:crypto";
import { youtube_v3 } from "googleapis";
import { validateTitle, makeTitleProposal } from "./title-proposal";
import { readStore, updateStore, type BatchItem, type Store, type VideoRow } from "./store";
import { getYouTube } from "./auth";
import { isYoutubeQuotaError, youtubeErrorMessage } from "./youtube-errors";

export async function getChannelVideos(): Promise<Pick<Store, "channelId" | "channelTitle" | "rows">> {
  const youtube = await getYouTube();
  if (!youtube) throw new Error("Connect YouTube first.");
  const channels = await youtube.channels.list({ part: ["snippet", "contentDetails"], mine: true });
  const channel = channels.data.items?.[0];
  if (!channel?.id) throw new Error("No YouTube channel found for this Google account.");
  const playlistId = channel.contentDetails?.relatedPlaylists?.uploads;
  if (!playlistId) throw new Error("Could not find channel uploads playlist.");

  const playlist: Array<{ id: string; publishedAt: string }> = [];
  let pageToken: string | undefined;
  do {
    const page = await youtube.playlistItems.list({
      part: ["contentDetails"],
      playlistId,
      maxResults: 50,
      pageToken,
    });
    for (const item of page.data.items ?? []) {
      const id = item.contentDetails?.videoId;
      if (id) playlist.push({ id, publishedAt: item.contentDetails?.videoPublishedAt ?? "" });
    }
    pageToken = page.data.nextPageToken ?? undefined;
  } while (pageToken);

  const details = new Map<string, youtube_v3.Schema$Video>();
  for (let i = 0; i < playlist.length; i += 50) {
    const ids = playlist.slice(i, i + 50).map((item) => item.id);
    const response = await youtube.videos.list({ part: ["snippet"], id: ids });
    for (const item of response.data.items ?? []) if (item.id) details.set(item.id, item);
  }

  const rows: VideoRow[] = playlist.map(({ id, publishedAt }) => {
    const video = details.get(id);
    const snippet = video?.snippet;
    const title = snippet?.title ?? "Unavailable video";
    const description = snippet?.description ?? "";
    const proposedTitle = makeTitleProposal(description);
    let status: VideoRow["status"] = "eligible";
    let reason: string | null = null;
    if (!video || !snippet || !snippet.categoryId) {
      status = "unavailable";
      reason = "Video unavailable or missing category metadata.";
    } else if (!proposedTitle) {
      status = "empty";
      reason = "Description has no non-empty line.";
    } else if (proposedTitle === title) {
      status = "unchanged";
      reason = "Title already matches description.";
    } else {
      const invalid = validateTitle(proposedTitle);
      if (invalid) {
        status = "invalid";
        reason = invalid;
      }
    }
    return {
      videoId: id,
      title,
      description,
      publishedAt,
      categoryId: snippet?.categoryId ?? "",
      thumbnailUrl: snippet?.thumbnails?.default?.url ?? null,
      proposedTitle,
      status,
      reason,
    };
  });
  return { channelId: channel.id, channelTitle: channel.snippet?.title ?? "YouTube channel", rows };
}

export async function saveVideoInventory(): Promise<{ total: number; eligible: number }> {
  const inventory = await getChannelVideos();
  await updateStore((store) => {
    store.channelId = inventory.channelId;
    store.channelTitle = inventory.channelTitle;
    store.rows = inventory.rows;
    store.batch = null;
  });
  return { total: inventory.rows.length, eligible: inventory.rows.filter((row) => row.status === "eligible").length };
}

export async function createBatch(selection: unknown): Promise<{ id: string; count: number; quotaEstimate: number }> {
  if (!Array.isArray(selection) || selection.length === 0 || selection.length > 5000) throw new Error("Select at least one eligible title.");
  const entries = selection.map((item) => {
    if (!item || typeof item !== "object" || !("videoId" in item) || !("title" in item)) throw new Error("Invalid title selection.");
    return { videoId: String(item.videoId), title: String(item.title) };
  });
  const ids = entries.map((item) => item.videoId);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate video IDs in selection.");
  const quotaEstimate = ids.length * 52; // 50-unit write plus one latest-snippet read and one verification read.
  return updateStore((store) => {
    if (!store.channelId || !store.rows.length) throw new Error("Load channel videos first.");
    if (store.batch?.status === "running") throw new Error("A batch is already running.");
    const rows = new Map(store.rows.map((row) => [row.videoId, row]));
    const items: BatchItem[] = entries.map(({ videoId, title }) => {
      const row = rows.get(videoId);
      const overLimit = row?.status === "invalid" && row.reason === "Title exceeds YouTube's 100-character limit";
      if (!row || (row.status !== "eligible" && !overLimit) || validateTitle(title)) {
        throw new Error("Selection includes an ineligible or invalid title. Reload the list.");
      }
      return { videoId, oldTitle: row.title, newTitle: title.trim(), status: "pending" };
    });
    const id = randomUUID();
    store.batch = { id, status: "paused", items };
    return { id, count: items.length, quotaEstimate };
  });
}

async function refreshSnippet(videoId: string) {
  const youtube = await getYouTube();
  if (!youtube) throw new Error("YouTube is disconnected.");
  const response = await youtube.videos.list({ part: ["snippet"], id: [videoId] });
  const video = response.data.items?.[0];
  if (!video?.snippet?.categoryId) throw new Error("Video is unavailable or has no category metadata.");
  return { youtube, snippet: video.snippet };
}

let activeJob: string | null = null;

export async function runBatch(jobId: string): Promise<void> {
  if (activeJob) throw new Error("Another batch is already running.");
  activeJob = jobId;
  try {
    await updateStore((store) => {
      if (!store.batch || store.batch.id !== jobId) throw new Error("Batch not found.");
      if (store.batch.status === "running") throw new Error("Batch is already running.");
      store.batch.status = "running";
    });

    while (true) {
      const item = await updateStore((store) => {
        const batch = store.batch;
        if (!batch || batch.id !== jobId || batch.status !== "running") return null;
        return batch.items.find((entry) => entry.status === "pending") ?? null;
      });
      if (!item) break;
      try {
        const { youtube, snippet } = await refreshSnippet(item.videoId);
        if (snippet.title !== item.oldTitle) {
          await updateStore((store) => {
            const entry = store.batch?.items.find((value) => value.videoId === item.videoId);
            if (entry) { entry.status = "conflict"; entry.error = "Title changed since preview. Reload and review."; }
          });
          continue;
        }
        const nextSnippet = {
          title: item.newTitle,
          categoryId: snippet.categoryId,
          description: snippet.description ?? "",
          ...(snippet.tags ? { tags: snippet.tags } : {}),
          ...(snippet.defaultLanguage ? { defaultLanguage: snippet.defaultLanguage } : {}),
          ...(snippet.defaultAudioLanguage ? { defaultAudioLanguage: snippet.defaultAudioLanguage } : {}),
        };
        await youtube.videos.update({ part: ["snippet"], requestBody: { id: item.videoId, snippet: nextSnippet } });
        const verify = await youtube.videos.list({ part: ["snippet"], id: [item.videoId] });
        const actual = verify.data.items?.[0]?.snippet?.title;
        if (actual !== item.newTitle) throw new Error("YouTube readback did not match requested title.");
        await updateStore((store) => {
          const entry = store.batch?.items.find((value) => value.videoId === item.videoId);
          const row = store.rows.find((value) => value.videoId === item.videoId);
          if (entry) entry.status = "updated";
          if (row) { row.title = item.newTitle; row.status = "updated"; row.reason = null; }
        });
      } catch (error) {
        const message = youtubeErrorMessage(error);
        const quota = isYoutubeQuotaError(error);
        await updateStore((store) => {
          const batch = store.batch;
          const entry = batch?.items.find((value) => value.videoId === item.videoId);
          if (entry) { entry.status = quota ? "blocked" : "failed"; entry.error = message; }
          if (quota && batch) {
            for (const remaining of batch.items) {
              if (remaining.status === "pending") { remaining.status = "blocked"; remaining.error = message; }
            }
          }
        });
        if (quota) break;
      }
    }
  } finally {
    await updateStore((store) => {
      if (store.batch?.id === jobId && store.batch.status === "running") {
        store.batch.status = store.batch.items.some((item) => item.status === "pending") ? "paused" : "complete";
      }
    });
    activeJob = null;
  }
}

export async function resumeBatch(jobId: string): Promise<{ pending: number }> {
  const pending = await updateStore((store) => {
    if (!store.batch || store.batch.id !== jobId || store.batch.status === "running") throw new Error("Batch cannot be resumed.");
    for (const item of store.batch.items) if (item.status === "blocked") { item.status = "pending"; delete item.error; }
    store.batch.status = "paused";
    return store.batch.items.filter((item) => item.status === "pending").length;
  });
  return { pending };
}

export async function cancelBatch(jobId: string): Promise<void> {
  await updateStore((store) => {
    if (!store.batch || store.batch.id !== jobId) throw new Error("Batch not found.");
    for (const item of store.batch.items) if (item.status === "pending") item.status = "blocked";
    store.batch.status = "paused";
  });
}

export async function getBatchState() {
  const store = await readStore();
  const items = store.batch?.items ?? [];
  return {
    ...store,
    batch: store.batch ? {
      ...store.batch,
      counts: {
        total: items.length,
        updated: items.filter((item) => item.status === "updated").length,
        pending: items.filter((item) => item.status === "pending").length,
        failed: items.filter((item) => item.status === "failed").length,
        conflicts: items.filter((item) => item.status === "conflict").length,
        blocked: items.filter((item) => item.status === "blocked").length,
      },
    } : null,
  };
}
