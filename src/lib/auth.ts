import "server-only";
import { Entry } from "@napi-rs/keyring";
import { google } from "googleapis";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";

const SCOPES = ["https://www.googleapis.com/auth/youtube.force-ssl"];
const KEYRING = new Entry("Youtube Title Updater", "google-oauth");
type OAuthKeys = { client_id: string; client_secret: string; redirect_uris: string[] };
type AuthState = { phase: "disconnected" | "pending" | "connected" | "error"; message?: string };

const runtime = globalThis as typeof globalThis & { youtubeAuthState?: AuthState };

function setState(state: AuthState) {
  runtime.youtubeAuthState = state;
}

export function getAuthState(): AuthState {
  return runtime.youtubeAuthState ?? { phase: "disconnected" };
}

async function getOAuthKeys(): Promise<OAuthKeys> {
  const path = process.env.GOOGLE_OAUTH_CLIENT_FILE;
  if (!path) throw new Error("GOOGLE_OAUTH_CLIENT_FILE is not set. Copy .env.example to .env.local.");
  const content = JSON.parse(await readFile(path, "utf8")) as Record<string, OAuthKeys>;
  const keys = content.installed;
  if (!keys?.client_id || !keys.client_secret || !keys.redirect_uris?.length) {
    throw new Error("OAuth file must contain a valid installed-app client.");
  }
  return keys;
}

export async function loadAuthClient(): Promise<InstanceType<typeof google.auth.OAuth2> | null> {
  const value = await KEYRING.getPassword();
  if (!value) return null;
  const client = new google.auth.OAuth2();
  client.setCredentials(JSON.parse(value));
  return client;
}

export async function getYouTube() {
  const auth = await loadAuthClient();
  if (!auth) return null;
  return google.youtube({ version: "v3", auth });
}

export async function beginLocalOAuth(): Promise<void> {
  if (getAuthState().phase === "pending") return;
  const keys = await getOAuthKeys();
  const state = randomBytes(32).toString("hex");
  const client = new google.auth.OAuth2(keys.client_id, keys.client_secret, undefined);
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
  const server = createServer(async (req, res) => {
    const callback = new URL(req.url ?? "/", "http://localhost");
    if (callback.pathname !== "/oauth2callback") {
      res.writeHead(404).end("Not found");
      return;
    }
    if (callback.searchParams.get("state") !== state) {
      setState({ phase: "error", message: "OAuth state mismatch. Close this tab and retry." });
      res.writeHead(400).end("OAuth state mismatch. Return to the app and retry.");
      server.close();
      return;
    }
    const code = callback.searchParams.get("code");
    if (!code || callback.searchParams.has("error")) {
      setState({ phase: "error", message: "Google authorization was cancelled or denied." });
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" }).end("<p>Authorization cancelled. Return to Youtube Title Updater.</p>");
      server.close();
      return;
    }
    try {
      const { tokens } = await client.getToken({ code, codeVerifier, redirect_uri: redirectUri });
      if (!tokens.access_token) throw new Error("Google did not return access token.");
      await KEYRING.setPassword(JSON.stringify(tokens));
      client.setCredentials(tokens);
      const channelResponse = await google.youtube({ version: "v3", auth: client }).channels.list({ part: ["snippet"], mine: true });
      if (!channelResponse.data.items?.length) {
        await KEYRING.deletePassword();
        throw new Error("No YouTube channel found for this Google account.");
      }
      setState({ phase: "connected" });
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end("<!doctype html><meta charset=utf-8><title>Connected</title><p>YouTube connected. Return to Youtube Title Updater.</p>");
    } catch {
      try { await KEYRING.deletePassword(); } catch { /* preserve OAuth error for UI */ }
      setState({ phase: "error", message: "YouTube connection failed. Check OAuth consent and API settings, then retry." });
      res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" }).end("<p>Connection failed. Return to Youtube Title Updater and check OAuth settings.</p>");
    } finally {
      server.close();
    }
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Could not start OAuth callback listener."));
      resolve(address.port);
    });
  });
  const redirectUri = `http://localhost:${port}/oauth2callback`;
  const authUrl = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: "S256" as import("google-auth-library").CodeChallengeMethod,
  });
  setState({ phase: "pending" });
  const opener = spawn("open", [authUrl], { detached: true, stdio: "ignore" });
  opener.once("error", () => {
    setState({ phase: "error", message: "Could not open browser. Check default browser and retry." });
    server.close();
  });
  opener.unref();
  const timeout = setTimeout(() => {
    if (getAuthState().phase === "pending") {
      setState({ phase: "error", message: "Google sign-in timed out. Retry connection." });
      server.close();
    }
  }, 5 * 60_000);
  server.once("close", () => clearTimeout(timeout));
}

export async function disconnectYouTube(): Promise<void> {
  await KEYRING.deletePassword();
  setState({ phase: "disconnected" });
}
