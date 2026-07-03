import { useState, useEffect, useCallback } from "react";

export const useSpotifyAuth = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Sync auth status from the background script. The background only
  // ever shares a boolean flag, never the tokens themselves.
  const syncState = useCallback(() => {
    setIsLoading(true);
    chrome.runtime.sendMessage({ command: "getState" }, (response) => {
      if (chrome.runtime.lastError) {
        // Handle potential errors if the background script isn't ready
        setError(chrome.runtime.lastError.message);
        setIsLoading(false);
        return;
      }
      if (response) {
        setIsAuthenticated(Boolean(response.isAuthenticated));
      }
      setIsLoading(false);
    });
  }, []);

  useEffect(() => {
    syncState();
    // Set up a listener for broadcasts from the background script
    const handleMessage = (message) => {
      if (message.command === "updateState") {
        setIsAuthenticated(Boolean(message.state.isAuthenticated));
      }
    };
    chrome.runtime.onMessage.addListener(handleMessage);
    // Cleanup: remove the listener when the component unmounts
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, [syncState]);

  const login = useCallback(() => {
    setIsLoading(true);
    chrome.runtime.sendMessage({ command: "login" }, () => {
      setIsLoading(false);
    });
  }, []);

  const logout = useCallback(() => {
    chrome.runtime.sendMessage({ command: "logout" });
  }, []);

  return {
    isAuthenticated,
    isLoading,
    error,
    login,
    logout,
  };
};
