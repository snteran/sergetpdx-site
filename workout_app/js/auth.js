// Sign-in with Amazon Cognito's hosted sign-in page (OAuth "authorization code + PKCE").
// Flow: signIn() sends the browser to Cognito → user signs in / signs up → Cognito sends the
// browser back here with ?code=… → finishSignIn() trades the code for tokens.
// No passwords ever touch this app's code.
import { CONFIG } from "./config.js";

const TOKENS_KEY = "workoutApp.auth";
const PKCE_KEY = "workoutApp.pkce";

export const authConfigured = () => Boolean(CONFIG.apiUrl && CONFIG.authDomain && CONFIG.clientId);

// Where Cognito sends people back to: this page, without "index.html" or query string.
const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, "");

function readTokens() {
  try { return JSON.parse(localStorage.getItem(TOKENS_KEY)) || null; } catch { return null; }
}
function writeTokens(t) {
  try {
    if (t) localStorage.setItem(TOKENS_KEY, JSON.stringify(t));
    else localStorage.removeItem(TOKENS_KEY);
  } catch { /* private mode: stays signed in for this page only */ }
}

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const randomString = (n = 48) => b64url(crypto.getRandomValues(new Uint8Array(n)));

function decodeJwt(token) {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(decodeURIComponent(escape(atob(part))));
  } catch { return {}; }
}

export function isSignedIn() {
  const t = readTokens();
  return Boolean(t && t.refreshToken);
}

export function userEmail() {
  const t = readTokens();
  return t ? decodeJwt(t.idToken).email || "" : "";
}

export async function signIn({ signUp = false } = {}) {
  const verifier = randomString();
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const state = randomString(16);
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state }));
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CONFIG.clientId,
    redirect_uri: redirectUri(),
    scope: "openid email profile",
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
  });
  location.assign(`https://${CONFIG.authDomain}/${signUp ? "signup" : "oauth2/authorize"}?${params}`);
}

async function tokenRequest(body) {
  const res = await fetch(`https://${CONFIG.authDomain}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CONFIG.clientId, ...body }),
  });
  if (!res.ok) throw new Error(`Sign-in failed (${res.status})`);
  return res.json();
}

// Call once on page load. Returns true if we just came back from the sign-in page.
export async function finishSignIn() {
  const url = new URL(location.href);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code && !url.searchParams.get("error")) return false;

  // Clean the address bar either way.
  history.replaceState(null, "", redirectUri());
  if (!code) return false;
  let saved = {};
  try { saved = JSON.parse(sessionStorage.getItem(PKCE_KEY)) || {}; } catch { /* ignore */ }
  sessionStorage.removeItem(PKCE_KEY);
  if (!saved.verifier || saved.state !== state) return false;

  const t = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    code_verifier: saved.verifier,
  });
  writeTokens({
    idToken: t.id_token,
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: Date.now() + t.expires_in * 1000,
  });
  return true;
}

// A valid access token for API calls, refreshing it quietly when it's about to expire.
export async function getAccessToken() {
  const t = readTokens();
  if (!t) return null;
  if (t.accessToken && t.expiresAt - Date.now() > 60_000) return t.accessToken;
  try {
    const n = await tokenRequest({ grant_type: "refresh_token", refresh_token: t.refreshToken });
    const next = { ...t, idToken: n.id_token, accessToken: n.access_token, expiresAt: Date.now() + n.expires_in * 1000 };
    writeTokens(next);
    return next.accessToken;
  } catch (err) {
    if (navigator.onLine) writeTokens(null); // refresh token expired or revoked: sign in again
    throw err;
  }
}

export function signOut() {
  writeTokens(null);
  const params = new URLSearchParams({ client_id: CONFIG.clientId, logout_uri: redirectUri() });
  location.assign(`https://${CONFIG.authDomain}/logout?${params}`);
}
