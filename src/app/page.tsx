"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import type { BatchItem, VideoRow } from "@/lib/store";

type State = {
  auth: { phase: "disconnected" | "pending" | "connected" | "error"; message?: string };
  channelTitle: string | null;
  channelId: string | null;
  rows: VideoRow[];
  batch: ({ id: string; status: "running" | "paused" | "complete"; items: BatchItem[]; counts: { total: number; updated: number; pending: number; failed: number; conflicts: number; blocked: number } }) | null;
};

const initial: State = { auth: { phase: "disconnected" }, channelTitle: null, channelId: null, rows: [], batch: null };

async function request<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Request failed.");
  return data as T;
}

export default function Home() {
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");

  const refresh = useCallback(async () => {
    try { setState(await request<State>("/api/state")); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not load app state."); setMessageIsError(true); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    request<State>("/api/state").then((value) => { if (!cancelled) setState(value); }).catch((error: unknown) => { if (!cancelled) setMessage(error instanceof Error ? error.message : "Could not load app state."); });
    return () => { cancelled = true; };
  }, []);
  const batchId = state.batch?.id;
  const batchStatus = state.batch?.status;
  useEffect(() => {
    if (!batchId || batchStatus !== "running") return;
    const timer = window.setInterval(() => void refresh(), 1200);
    return () => window.clearInterval(timer);
  }, [batchId, batchStatus, refresh]);
  const refreshAfterAuth = state.auth.phase === "pending";
  useEffect(() => {
    if (!refreshAfterAuth) return;
    const timer = window.setInterval(() => void refresh(), 1200);
    return () => window.clearInterval(timer);
  }, [refreshAfterAuth, refresh]);

  function canSelect(row: VideoRow) {
    return row.status === "eligible" || (row.status === "invalid" && row.reason === "Title exceeds YouTube's 100-character limit");
  }

  const rows = useMemo(() => state.rows.filter((row) => {
    const text = `${row.title} ${row.proposedTitle ?? ""} ${row.videoId}`.toLocaleLowerCase();
    return text.includes(query.toLocaleLowerCase()) && (filter === "all" || row.status === filter);
  }), [state.rows, query, filter]);
  const eligible = state.rows.filter((row) => row.status === "eligible").length;
  const selectedRows = selected.map((id) => state.rows.find((row) => row.videoId === id)).filter((row): row is VideoRow => Boolean(row));
  const selectedQuota = selectedRows.length * 52;

  async function act(label: string, fn: () => Promise<unknown>) {
    setBusy(true); setMessage(""); setMessageIsError(false);
    try { await fn(); await refresh(); if (label) setMessage(label); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Request failed."); setMessageIsError(true); }
    finally { setBusy(false); }
  }

  function toggle(id: string) { setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]); }
  function toggleVisible() {
    const visibleEligible = rows.filter((row) => row.status === "eligible").map((row) => row.videoId);
    const allSelected = visibleEligible.length > 0 && visibleEligible.every((id) => selected.includes(id));
    setSelected((current) => allSelected ? current.filter((id) => !visibleEligible.includes(id)) : [...new Set([...current, ...visibleEligible])]);
  }

  async function startBatch() {
    const payload = selectedRows.map((row) => ({ videoId: row.videoId, title: edits[row.videoId] ?? row.proposedTitle ?? "" }));
    if (!payload.length) return;
    const confirmed = window.confirm(`Update ${payload.length} YouTube titles for ${state.channelTitle ?? "this channel"}?\n\nEstimated quota: at least ${selectedQuota} units (50 per write plus reads).\n\nThis changes public video titles. Continue?`);
    if (!confirmed) return;
    await act("Batch started.", async () => {
      const batch = await request<{ id: string; count: number; quotaEstimate: number }>("/api/batches", "POST", { videoIds: payload });
      await request(`/api/batches/${batch.id}/start`, "POST");
      setSelected([]);
    });
  }

  const authPending = state.auth.phase === "pending";
  const currentBatch = state.batch;

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">YT</div>
        <div className="brand-copy"><strong>Youtube Title Updater</strong><span>Factopedia channel tools</span></div>
        <div className="top-actions">
          {state.auth.phase === "connected" ? <>
            <span className="connected"><span className="status-dot" />{state.channelTitle ?? "Connected"}</span>
            <button className="button button-quiet" disabled={busy} onClick={() => void act("Disconnected.", () => request("/api/auth/disconnect", "POST"))}>Disconnect</button>
          </> : <button className="button button-dark" disabled={busy || authPending} onClick={() => void act("Google sign-in opened in browser.", () => request("/api/auth/connect", "POST"))}>{authPending ? "Waiting for Google…" : "Connect YouTube"}</button>}
        </div>
      </header>

      <section className="page-heading">
        <div><p className="overline">CHANNEL EDITOR</p><h1>Review titles before they change.</h1><p className="lede">Compare each current title with a proposal from its description. Nothing updates until you select rows and confirm.</p></div>
        <div className="heading-actions">
          <button className="button button-dark" disabled={busy || state.auth.phase !== "connected"} onClick={() => void act("Video list refreshed.", () => request("/api/videos/sync", "POST"))}>{busy ? "Working…" : "Load videos"}</button>
        </div>
      </section>

      {message && <div className={`notice ${messageIsError ? "notice-error" : ""}`} role={messageIsError ? "alert" : "status"}>{message}<button aria-label="Dismiss message" onClick={() => { setMessage(""); setMessageIsError(false); }}>×</button></div>}
      {state.auth.phase === "error" && state.auth.message && <div className="notice notice-error" role="alert">{state.auth.message}</div>}
      {state.auth.phase !== "connected" && <section className="connect-panel"><div><h2>Connect your YouTube channel</h2><p>Google sign-in opens in your default browser. Grant YouTube access, then return here. Tokens stay in macOS Keychain.</p></div><button className="button button-dark" disabled={busy || authPending} onClick={() => void act("Google sign-in opened in browser.", () => request("/api/auth/connect", "POST"))}>{authPending ? "Waiting for Google…" : "Connect YouTube"}</button></section>}

      {currentBatch && <section className="batch-panel" aria-live="polite"><div className="batch-title"><div><span className={`batch-state state-${currentBatch.status}`}>{currentBatch.status}</span><h2>Batch results</h2></div><strong className="batch-count-updated">{currentBatch.counts.updated}/{currentBatch.counts.total} updated</strong></div><div className="batch-counts"><span className="count-pending">Pending {currentBatch.counts.pending}</span><span className="count-failed">Failed {currentBatch.counts.failed}</span><span className="count-conflicts">Conflicts {currentBatch.counts.conflicts}</span><span className="count-blocked">Blocked {currentBatch.counts.blocked}</span></div>{currentBatch.status === "paused" && currentBatch.counts.blocked > 0 && <button className="button button-quiet" disabled={busy} onClick={() => void act("Batch resumed.", () => request(`/api/batches/${currentBatch.id}/resume`, "POST"))}>Resume blocked titles</button>} {currentBatch.status === "running" && <button className="button button-quiet" disabled={busy} onClick={() => void act("Batch paused.", () => request(`/api/batches/${currentBatch.id}/cancel`, "POST"))}>Pause batch</button>}</section>}

      {state.auth.phase === "connected" && <>
        <section className="inventory-head"><div className="inventory-title"><h2>Video inventory</h2><span>{state.rows.length} videos</span><span>{eligible} eligible</span></div><div className="inventory-tools"><label className="search-box"><span className="sr-only">Search videos</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title or video ID" /></label><label className="filter-box"><span className="sr-only">Filter status</span><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All statuses</option><option value="eligible">Eligible</option><option value="updated">Updated</option><option value="empty">Empty description</option><option value="unchanged">Unchanged</option><option value="invalid">Invalid title</option><option value="conflict">Conflict</option><option value="failed">Failed</option><option value="unavailable">Unavailable</option></select></label></div></section>

        {state.rows.length === 0 ? <section className="empty-state"><h2>No video list loaded</h2><p>Load channel uploads to preview title changes. This only reads your channel.</p><button className="button button-dark" disabled={busy} onClick={() => void act("Video list loaded.", () => request("/api/videos/sync", "POST"))}>Load videos</button></section> : <>
          <div className="table-scroll"><table><thead><tr><th className="select-col"><input aria-label="Select all eligible visible videos" type="checkbox" checked={rows.filter((r) => r.status === "eligible").length > 0 && rows.filter((r) => r.status === "eligible").every((r) => selected.includes(r.videoId))} onChange={toggleVisible} /></th><th>Video</th><th>Current title</th><th>Proposed title</th><th>Status</th></tr></thead><tbody>{rows.map((row) => {
            const isSelected = selected.includes(row.videoId);
            const proposed = edits[row.videoId] ?? row.proposedTitle ?? "";
            const rowStatus = row.status;
            return <tr key={row.videoId}>
              <td className="select-col"><input aria-label={`Select ${row.title}`} type="checkbox" disabled={!canSelect(row)} checked={isSelected} onChange={() => toggle(row.videoId)} /></td>
              <td className="video-cell">{row.thumbnailUrl ? <Image src={row.thumbnailUrl} alt="" width={96} height={54} unoptimized /> : <div className="thumb-fallback" aria-hidden="true">YT</div>}<div><a href={`https://www.youtube.com/watch?v=${encodeURIComponent(row.videoId)}`} target="_blank" rel="noreferrer">Open video</a><span>{row.publishedAt ? new Date(row.publishedAt).toLocaleDateString("id-ID") : "Date unavailable"}</span></div></td>
              <td className="title-cell">{row.title}</td>
              <td className="proposal-cell">{canSelect(row) ? <><label className="sr-only" htmlFor={`title-${row.videoId}`}>Proposed title for {row.title}</label><textarea id={`title-${row.videoId}`} rows={2} maxLength={300} value={proposed} onChange={(event) => setEdits((current) => ({ ...current, [row.videoId]: event.target.value }))} /><span className={Array.from(proposed.trim()).length > 100 ? "char-count over" : "char-count"}>{Array.from(proposed.trim()).length}/100</span></> : <span className="muted">{proposed || "No proposal"}</span>}</td>
              <td><span className={`status status-${rowStatus}`}>{rowStatus}</span>{row.reason && <small className="reason">{row.reason}</small>}</td>
            </tr>;
          })}</tbody></table></div>
          {rows.length === 0 && <section className="empty-state"><p>No videos match current search/filter.</p></section>}
        </>}

        {selected.length > 0 && <div className="selection-bar"><div><strong>{selected.length} selected</strong><span>Estimated at least {selectedQuota} quota units</span></div><button className="button button-quiet" onClick={() => setSelected([])}>Clear</button><button className="button button-accent" disabled={busy || selectedRows.some((row) => Array.from((edits[row.videoId] ?? row.proposedTitle ?? "").trim()).length > 100 || !(edits[row.videoId] ?? row.proposedTitle ?? "").trim())} onClick={() => void startBatch()}>{busy ? "Starting…" : "Review and update"}</button></div>}
      </>}

      <footer><span>Titles change only after confirmation.</span><span>Writes use YouTube Data API quota.</span></footer>
    </main>
  );
}
