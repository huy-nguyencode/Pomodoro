importScripts("vendor/axios.min.js");

const SPOTIFY_CLIENT_ID = "889db36d555d41f1bcc56f22d1e2210c";
const TOKEN_ENDPOINT = "https://accounts.spotify.com/api/token";
const DEFAULT_DURATION = 1500; // 25 minutes

// Auth flow with PKCE (Proof Key for Code Exchange)
const generateRandomString = (length) => {
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const values = crypto.getRandomValues(new Uint8Array(length));
  return values.reduce((acc, x) => acc + possible[x % possible.length], "");
};

const sha256 = async (plain) => {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return self.crypto.subtle.digest("SHA-256", data);
};

const base64encode = (input) => {
  return btoa(String.fromCharCode(...new Uint8Array(input)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
};

async function isSpotifyConnected() {
  const { spotify_access_token, spotify_refresh_token } =
    await chrome.storage.local.get([
      "spotify_access_token",
      "spotify_refresh_token",
    ]);
  return Boolean(spotify_access_token || spotify_refresh_token);
}

// Function to make API calls to Spotify.
// `isRetry` guards against infinite recursion when a refreshed token
// still yields 401s (e.g. revoked app access).
async function callSpotifyAPI(endpoint, method = "GET", body = null, isRetry = false) {
  const { spotify_access_token: token } = await chrome.storage.local.get(
    "spotify_access_token"
  );
  if (!token) {
    if (isRetry) {
      console.error("Still no token after refresh. Logging out.");
      await handleLogout();
      return null;
    }
    try {
      await refreshToken();
      return callSpotifyAPI(endpoint, method, body, true);
    } catch (error) {
      console.error("Could not refresh token. Please log in again.", error);
      await handleLogout();
      return null;
    }
  }

  try {
    const response = await fetch(`https://api.spotify.com/v1${endpoint}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : null,
    });

    // Refresh once if the token is expired; a second 401 means the
    // session is genuinely dead, so log out instead of looping forever.
    if (response.status === 401) {
      if (isRetry) {
        console.error("Spotify rejected refreshed token. Logging out.");
        await handleLogout();
        return null;
      }
      try {
        await refreshToken();
      } catch (error) {
        console.error("Token refresh failed. Logging out.", error);
        await handleLogout();
        return null;
      }
      return callSpotifyAPI(endpoint, method, body, true);
    }

    // Log any non-2xx responses
    if (!response.ok) {
      const errorText = await response.text(); // may itself be empty
      throw new Error(`Spotify API Error ${response.status}: ${errorText}`);
    }

    // no content to return
    if (response.status === 202 || response.status === 204) return null;

    // Parse JSON response
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.startsWith("application/json")) {
      // some 200s send an empty body with a text/plain header
      return null;
    }

    return await response.json();
  } catch (err) {
    console.error("Spotify API call failed:", err);
    throw err;
  }
}

// Spotify Authentication Flow
async function handleLogin() {
  const codeVerifier = generateRandomString(64);
  const hashed = await sha256(codeVerifier);
  const codeChallenge = base64encode(hashed);
  const redirectUri = chrome.identity.getRedirectURL(); // No path needed for manifest v3

  await chrome.storage.local.set({
    spotify_code_verifier: codeVerifier,
  });

  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri,
    scope:
      "streaming user-modify-playback-state user-read-currently-playing user-read-playback-state user-read-private playlist-read-private playlist-read-collaborative",
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
  });

  const authUrl = `https://accounts.spotify.com/authorize?${params.toString()}`;

  try {
    const finalUrl = await chrome.identity.launchWebAuthFlow({
      url: authUrl,
      interactive: true,
    });
    // finalUrl is undefined when the user closes the auth window
    if (!finalUrl) return;

    const url = new URL(finalUrl);
    const code = url.searchParams.get("code");
    if (code) {
      await exchangeCodeForToken(code, redirectUri);
      await broadcastState();
    }
  } catch (e) {
    console.log("Auth flow error:", e.message);
  }
}

async function exchangeCodeForToken(code, redirectUri) {
  const { spotify_code_verifier } = await chrome.storage.local.get(
    "spotify_code_verifier"
  );

  try {
    const response = await axios.post(
      TOKEN_ENDPOINT,
      new URLSearchParams({
        client_id: SPOTIFY_CLIENT_ID,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: spotify_code_verifier,
      }),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }
    );
    const { access_token, refresh_token } = response.data;
    await chrome.storage.local.set({
      spotify_access_token: access_token,
      spotify_refresh_token: refresh_token,
    });
  } catch (error) {
    console.error("Token exchange failed:", error.message);
    throw error;
  } finally {
    await chrome.storage.local.remove("spotify_code_verifier");
  }
}

async function refreshToken() {
  const { spotify_refresh_token } = await chrome.storage.local.get(
    "spotify_refresh_token"
  );
  if (!spotify_refresh_token) throw new Error("No refresh token available.");

  const response = await axios.post(
    TOKEN_ENDPOINT,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: spotify_refresh_token,
      client_id: SPOTIFY_CLIENT_ID,
    }),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }
  );

  const { access_token, refresh_token: new_refresh_token } = response.data;
  await chrome.storage.local.set({
    spotify_access_token: access_token,
    // Spotify sometimes returns a new refresh token, so we save it.
    spotify_refresh_token: new_refresh_token || spotify_refresh_token,
  });
}

async function handleLogout() {
  await chrome.storage.local.remove([
    "spotify_access_token",
    "spotify_refresh_token",
    "spotify_code_verifier",
  ]);
  await broadcastState(); // Notify UI of logout
}

// --- Timer Logic ---
// In-memory state for fast access (storage is only for persistence)
let timerState = {
  timeLeft: DEFAULT_DURATION,
  duration: DEFAULT_DURATION,
  isRunning: false,
};
let countdownIntervalId = null;
let tickCount = 0; // Track ticks for periodic storage sync

// Initialize in-memory state from storage (called on service worker wake).
// Message handlers await this so an early `getState` never returns defaults.
async function initTimerState() {
  const stored = await chrome.storage.local.get([
    "timeLeft",
    "duration",
    "isRunning",
  ]);
  timerState = {
    timeLeft: stored.timeLeft ?? DEFAULT_DURATION,
    duration: stored.duration ?? DEFAULT_DURATION,
    isRunning: stored.isRunning ?? false,
  };

  // Resume countdown if timer was running when service worker went to sleep
  if (timerState.isRunning && !countdownIntervalId) {
    countdownIntervalId = setInterval(updateCountdown, 1000);
  }
}
const timerStateReady = initTimerState();

// Sync in-memory state to storage (for crash recovery)
async function syncToStorage() {
  await chrome.storage.local.set({
    timeLeft: timerState.timeLeft,
    duration: timerState.duration,
    isRunning: timerState.isRunning,
  });
}

function stopCountdownInterval() {
  if (countdownIntervalId) {
    clearInterval(countdownIntervalId);
    countdownIntervalId = null;
  }
}

async function startTimer() {
  if (timerState.isRunning) return;

  const isFreshStart = timerState.timeLeft === timerState.duration;
  timerState.isRunning = true;
  await syncToStorage();

  chrome.alarms.create("pomodoroTimer", {
    delayInMinutes: timerState.timeLeft / 60,
  });

  if (!countdownIntervalId) {
    tickCount = 0;
    countdownIntervalId = setInterval(updateCountdown, 1000);
  }

  if (await isSpotifyConnected()) {
    try {
      const { workPlaylistId } = await chrome.storage.local.get(
        "workPlaylistId"
      );
      if (isFreshStart && workPlaylistId) {
        await callSpotifyAPI("/me/player/play", "PUT", {
          context_uri: `spotify:playlist:${workPlaylistId}`,
        });
      } else {
        await callSpotifyAPI("/me/player/play", "PUT");
      }
    } catch (error) {
      // Playback failures (e.g. no active device) shouldn't block the timer
      console.warn("Could not start Spotify playback:", error.message);
    }
  }
  await broadcastState();
}

async function pauseTimer() {
  if (!timerState.isRunning) return;

  timerState.isRunning = false;
  await syncToStorage(); // Persist current time when pausing
  await chrome.alarms.clear("pomodoroTimer");
  stopCountdownInterval();

  // Pause Spotify from the background so the feature works even when
  // the popup is closed.
  const { pauseMusicOnPause } = await chrome.storage.local.get(
    "pauseMusicOnPause"
  );
  if (pauseMusicOnPause && (await isSpotifyConnected())) {
    try {
      await callSpotifyAPI("/me/player/pause", "PUT");
    } catch (error) {
      console.warn("Could not pause Spotify playback:", error.message);
    }
  }
  await broadcastState();
}

async function resetTimer() {
  timerState.isRunning = false;
  timerState.timeLeft = timerState.duration;
  await syncToStorage();
  await chrome.alarms.clear("pomodoroTimer");
  stopCountdownInterval();
  await broadcastState();
}

async function setTimer(newDuration) {
  timerState.duration = newDuration;
  timerState.timeLeft = newDuration;
  await syncToStorage();

  // If the timer is running, the old alarm points at the old end time.
  if (timerState.isRunning) {
    await chrome.alarms.clear("pomodoroTimer");
    chrome.alarms.create("pomodoroTimer", {
      delayInMinutes: newDuration / 60,
    });
  }
  await broadcastState();
}

// Single completion path shared by the countdown interval and the alarm.
// Guarded so whichever fires first wins and the other becomes a no-op.
async function finishTimer() {
  if (!timerState.isRunning) return;

  timerState.isRunning = false;
  timerState.timeLeft = timerState.duration;
  await syncToStorage();
  await chrome.alarms.clear("pomodoroTimer");
  stopCountdownInterval();

  if (await isSpotifyConnected()) {
    try {
      const { breakPlaylistId } = await chrome.storage.local.get(
        "breakPlaylistId"
      );
      if (breakPlaylistId) {
        await callSpotifyAPI("/me/player/play", "PUT", {
          context_uri: `spotify:playlist:${breakPlaylistId}`,
        });
      }
    } catch (error) {
      console.warn("Could not switch to break playlist:", error.message);
    }
  }

  chrome.notifications.create({
    type: "basic",
    iconUrl: "PomoSpot128.png",
    title: "Time's Up!",
    message: "Your Pomodoro session has ended.",
    priority: 2,
  });

  await broadcastState({ timerFinished: true });

  chrome.action.openPopup().catch(() => {
    // openPopup requires a user gesture in some Chrome versions; the
    // notification above is the fallback.
  });
}

async function updateCountdown() {
  if (!timerState.isRunning) {
    stopCountdownInterval();
    return;
  }

  timerState.timeLeft -= 1;
  tickCount += 1;

  if (timerState.timeLeft > 0) {
    // Only sync to storage every 10 seconds (reduces I/O by 90%)
    if (tickCount % 10 === 0) {
      await syncToStorage();
    }
    await broadcastState();
  } else {
    await finishTimer();
  }
}

// --- Event Listeners ---
chrome.runtime.onInstalled.addListener((details) => {
  // Only seed defaults on first install; updating the extension
  // should not wipe an in-progress session.
  if (details.reason === "install") {
    chrome.storage.local.set({
      timeLeft: DEFAULT_DURATION,
      duration: DEFAULT_DURATION,
      isRunning: false,
    });
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "pomodoroTimer") return;
  await timerStateReady;
  await finishTimer();
});

// MERGED MESSAGE LISTENER
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    await timerStateReady;
    try {
      switch (request.command) {
        // Auth Commands
        case "login":
          await handleLogin();
          sendResponse({ status: "ok" });
          break;
        case "logout":
          await handleLogout();
          sendResponse({ status: "ok" });
          break;

        // Timer Commands
        case "start":
          await startTimer();
          sendResponse({ status: "ok" });
          break;
        case "pause":
          await pauseTimer();
          sendResponse({ status: "ok" });
          break;
        case "reset":
          await resetTimer();
          sendResponse({ status: "ok" });
          break;
        case "setDuration":
          await setTimer(request.duration);
          sendResponse({ status: "ok" });
          break;
        case "getState":
          sendResponse(await getPublicState());
          break;

        // Spotify Player Commands
        case "getCurrentPlayback": {
          const playbackState = await callSpotifyAPI(
            "/me/player/currently-playing"
          );
          sendResponse(playbackState);
          break;
        }
        case "playSpotify":
          await callSpotifyAPI("/me/player/play", "PUT");
          sendResponse({ status: "ok" });
          break;
        case "pauseSpotify":
          await callSpotifyAPI("/me/player/pause", "PUT");
          sendResponse({ status: "ok" });
          break;
        case "nextTrack":
          await callSpotifyAPI("/me/player/next", "POST");
          sendResponse({ status: "ok" });
          break;
        case "previousTrack":
          await callSpotifyAPI("/me/player/previous", "POST");
          sendResponse({ status: "ok" });
          break;
        case "getPlaylists": {
          const playlistResponse = await callSpotifyAPI("/me/playlists?limit=50");
          if (playlistResponse && playlistResponse.items) {
            sendResponse(playlistResponse);
          } else {
            console.log("Unable to fetch playlists");
            sendResponse({ status: "unable to fetch playlist" });
          }
          break;
        }
        case "playFromPlaylist":
          await callSpotifyAPI("/me/player/play", "PUT", {
            context_uri: `spotify:playlist:${request.playlistId}`,
          });
          sendResponse({ status: "ok" });
          break;
        default:
          console.warn("Unknown command:", request.command);
          sendResponse({ status: "error", message: "Unknown command" });
      }
    } catch (error) {
      console.error(`Error handling command "${request.command}":`, error);
      sendResponse({ status: "error", message: error.message });
    }
  })();

  // Return true to indicate that the response will be sent asynchronously.
  return true;
});

// State shared with the popup. Exposes only a boolean auth flag,
// never the tokens themselves.
async function getPublicState() {
  return {
    timeLeft: timerState.timeLeft,
    isRunning: timerState.isRunning,
    duration: timerState.duration,
    isAuthenticated: await isSpotifyConnected(),
  };
}

async function broadcastState(extra = {}) {
  const state = { ...(await getPublicState()), ...extra };
  chrome.runtime.sendMessage({ command: "updateState", state }).catch((err) => {
    if (err.message.includes("Could not establish connection")) {
      // This is normal if the popup is not open.
    } else {
      console.error("Broadcast error:", err);
    }
  });
}
