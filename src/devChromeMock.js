// Dev-only mock of the chrome extension APIs so the popup can be
// previewed with `npm run dev` in a regular browser tab.
// Not imported in production builds inside the real extension context.

const isExtensionContext =
  typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);

export function installDevChromeMock() {
  if (isExtensionContext || import.meta.env.PROD) return;

  const mockState = {
    timeLeft: 1500,
    duration: 1500,
    isRunning: false,
    isAuthenticated: true,
  };

  const storageData = {
    pauseMusicOnPause: true,
    workPlaylistId: "work123",
    breakPlaylistId: null,
  };

  const mockPlayback = {
    item: {
      name: "Weightless",
      artists: [{ name: "Marconi Union" }],
      duration_ms: 480000,
      album: { images: [] },
    },
    progress_ms: 154000,
    is_playing: true,
  };

  const mockPlaylists = {
    items: [
      { id: "work123", name: "Deep Focus" },
      { id: "break456", name: "Chill Break" },
    ],
  };

  globalThis.chrome = {
    runtime: {
      lastError: undefined,
      sendMessage: (message, callback) => {
        let response = { status: "ok" };
        switch (message.command) {
          case "getState":
            response = { ...mockState };
            break;
          case "start":
            mockState.isRunning = true;
            break;
          case "pause":
            mockState.isRunning = false;
            break;
          case "reset":
            mockState.isRunning = false;
            mockState.timeLeft = mockState.duration;
            break;
          case "setDuration":
            mockState.duration = message.duration;
            mockState.timeLeft = message.duration;
            break;
          case "getCurrentPlayback":
            response = mockPlayback;
            break;
          case "getPlaylists":
            response = mockPlaylists;
            break;
          default:
            break;
        }
        callback?.(response);
      },
      onMessage: {
        addListener: () => {},
        removeListener: () => {},
      },
    },
    storage: {
      local: {
        get: (_keys, callback) => callback({ ...storageData }),
        set: (values, callback) => {
          Object.assign(storageData, values);
          callback?.();
        },
      },
    },
  };
}
