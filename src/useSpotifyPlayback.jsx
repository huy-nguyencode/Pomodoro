import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import defaultAlbumCover from "./assets/defaultAlbumCover.png";
import { useSpotifyAuth } from "./useSpotifyAuth";

const formatSpotifyTime = (ms) => {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

const NO_TRACK_PLAYING = {
  name: "No track playing",
  artist: "Open Spotify on a device to get started",
  duration: "0:00",
  currentTime: "0:00",
  progress: 0,
  albumArt: defaultAlbumCover,
};

export const useSpotifyPlayback = () => {
  const { isAuthenticated, login } = useSpotifyAuth();
  const [currentTrack, setCurrentTrack] = useState(NO_TRACK_PLAYING);
  const [isSpotifyPlaying, setIsSpotifyPlaying] = useState(false);
  const playbackIntervalRef = useRef(null);
  // Keep the latest playing state in a ref so control callbacks stay stable
  const isPlayingRef = useRef(false);
  isPlayingRef.current = isSpotifyPlaying;

  const getCurrentPlayback = useCallback(() => {
    if (!isAuthenticated) return;
    chrome.runtime.sendMessage({ command: "getCurrentPlayback" }, (response) => {
      if (chrome.runtime.lastError) {
        console.error(
          "Error getting current playback:",
          chrome.runtime.lastError.message
        );
        setCurrentTrack(NO_TRACK_PLAYING);
        setIsSpotifyPlaying(false);
        return;
      }

      if (response && response.item) {
        setCurrentTrack({
          name: response.item.name,
          artist: response.item.artists.map((artist) => artist.name).join(", "),
          duration: formatSpotifyTime(response.item.duration_ms),
          currentTime: formatSpotifyTime(response.progress_ms),
          progress: Math.round(
            (response.progress_ms / response.item.duration_ms) * 100
          ),
          albumArt: response.item.album.images[0]?.url || defaultAlbumCover,
        });
        setIsSpotifyPlaying(response.is_playing);
      } else {
        setCurrentTrack(NO_TRACK_PLAYING);
        setIsSpotifyPlaying(false);
      }
    });
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) {
      getCurrentPlayback();
      // Poll every 3 seconds instead of 1 - reduces API calls by 66%
      // while maintaining responsive UX
      playbackIntervalRef.current = setInterval(getCurrentPlayback, 3000);
    } else {
      clearInterval(playbackIntervalRef.current);
      setCurrentTrack(NO_TRACK_PLAYING);
      setIsSpotifyPlaying(false);
    }
    return () => clearInterval(playbackIntervalRef.current);
  }, [isAuthenticated, getCurrentPlayback]);

  const sendMessageWithCallback = useCallback(
    (command, payload = {}) => {
      chrome.runtime.sendMessage({ command, ...payload }, () => {
        if (chrome.runtime.lastError) {
          console.error(
            `Error sending "${command}":`,
            chrome.runtime.lastError.message
          );
          return;
        }
        // Give Spotify a moment to apply the change before re-polling
        setTimeout(getCurrentPlayback, 500);
      });
    },
    [getCurrentPlayback]
  );

  // Memoized so consumers can safely use `controls` in effect deps
  const controls = useMemo(() => {
    const requireAuth = (fn) => () => {
      if (!isAuthenticated) {
        login();
        return;
      }
      fn();
    };

    return {
      togglePlayPause: requireAuth(() =>
        sendMessageWithCallback(
          isPlayingRef.current ? "pauseSpotify" : "playSpotify"
        )
      ),
      pauseMusic: () => {
        if (!isAuthenticated) return;
        sendMessageWithCallback("pauseSpotify");
      },
      resumeMusic: requireAuth(() => sendMessageWithCallback("playSpotify")),
      nextTrack: () => {
        if (!isAuthenticated) return;
        sendMessageWithCallback("nextTrack");
      },
      previousTrack: () => {
        if (!isAuthenticated) return;
        sendMessageWithCallback("previousTrack");
      },
      playFromPlaylist: (playlistId) =>
        sendMessageWithCallback("playFromPlaylist", { playlistId }),
    };
  }, [isAuthenticated, login, sendMessageWithCallback]);

  return {
    currentTrack,
    isSpotifyPlaying,
    isAuthenticated,
    controls,
  };
};
