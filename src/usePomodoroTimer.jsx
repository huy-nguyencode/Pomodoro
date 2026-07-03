import { useState, useEffect, useCallback } from "react";

export const usePomodoroTimer = () => {
  const [timeLeft, setTimeLeft] = useState(null); // Start as null
  const [duration, setDuration] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [timerFinished, setTimerFinished] = useState(false);

  const updateLocalState = useCallback((state) => {
    if (state) {
      setTimeLeft(state.timeLeft);
      setDuration(state.duration);
      setIsRunning(state.isRunning);
      if (state.timerFinished) {
        setTimerFinished(true);
      }
    }
  }, []);

  useEffect(() => {
    // Request state when component mounts
    chrome.runtime.sendMessage({ command: "getState" }, (response) => {
      if (!chrome.runtime.lastError) {
        updateLocalState(response);
      }
    });

    // Listen for state broadcasts
    const messageListener = (message) => {
      if (message.command === "updateState") {
        updateLocalState(message.state);
      }
    };
    chrome.runtime.onMessage.addListener(messageListener);

    return () => chrome.runtime.onMessage.removeListener(messageListener);
  }, [updateLocalState]);

  const toggleTimer = () => {
    chrome.runtime.sendMessage({ command: isRunning ? "pause" : "start" });
  };

  const resetTimer = () => {
    chrome.runtime.sendMessage({ command: "reset" });
  };

  const setTimer = (seconds) => {
    // Tell the background to set a new duration
    chrome.runtime.sendMessage({ command: "setDuration", duration: seconds });
  };

  const dismissTimerFinished = () => setTimerFinished(false);

  const formatTime = (seconds) => {
    if (seconds === null || typeof seconds !== "number") return "00:00"; // Handle null state
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    const HH = String(hours).padStart(2, "0");
    const MM = String(mins).padStart(2, "0");
    const SS = String(secs).padStart(2, "0");

    return hours > 0 ? `${HH}:${MM}` : `${MM}:${SS}`;
  };

  return {
    timeLeft,
    duration,
    isRunning,
    timerFinished,
    dismissTimerFinished,
    formattedTime: formatTime(timeLeft),
    toggleTimer,
    resetTimer,
    setTimer,
  };
};
