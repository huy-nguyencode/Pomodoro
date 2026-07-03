import { useState, useEffect } from "react";
import { useSpotifyAuth } from "./useSpotifyAuth";

const SwitchPlaylist = ({ settings, onSettingChange }) => {
  const { isAuthenticated } = useSpotifyAuth();
  const [playlists, setPlaylists] = useState([]);
  const [loadError, setLoadError] = useState(false);

  const { workPlaylistId, breakPlaylistId } = settings;

  // Fetch playlists from the service worker
  useEffect(() => {
    if (!isAuthenticated) return;
    chrome.runtime.sendMessage({ command: "getPlaylists" }, (response) => {
      if (chrome.runtime.lastError || !response || !response.items) {
        console.error("Failed to fetch playlists:", response);
        setPlaylists([]);
        setLoadError(true);
        return;
      }
      setPlaylists(response.items);
      setLoadError(false);
    });
  }, [isAuthenticated]);

  // Route changes through App's settings handler so parent state and
  // chrome.storage stay in sync.
  const handlePlaylistChange = (settingKey) => (e) => {
    onSettingChange({
      ...settings,
      [settingKey]: e.target.value || null,
    });
  };

  if (!isAuthenticated) {
    return <p>Please log in to Spotify to select playlists.</p>;
  }

  return (
    <div className="playlist-container">
      {loadError && (
        <p className="playlist-error">
          Could not load your playlists. Try reconnecting Spotify.
        </p>
      )}
      <div className="playlist-selector">
        <label htmlFor="work-playlist">Work Playlist</label>
        <select
          id="work-playlist"
          value={workPlaylistId || ""}
          onChange={handlePlaylistChange("workPlaylistId")}
        >
          <option value="">Select a playlist</option>
          {playlists.map((playlist) => (
            <option key={playlist.id} value={playlist.id}>
              {playlist.name}
            </option>
          ))}
        </select>
      </div>
      <div className="playlist-selector">
        <label htmlFor="break-playlist">Break Playlist</label>
        <select
          id="break-playlist"
          value={breakPlaylistId || ""}
          onChange={handlePlaylistChange("breakPlaylistId")}
        >
          <option value="">Select a playlist</option>
          {playlists.map((playlist) => (
            <option key={playlist.id} value={playlist.id}>
              {playlist.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};

export default SwitchPlaylist;
