import { useSpotifyAuth } from "./useSpotifyAuth";
import spotifyIcon from "./assets/spotifyIcon.png";
import SwitchPlaylist from "./SwitchPlaylist";

// Defined at module level so it isn't recreated on every Settings render
const ToggleSwitch = ({ isOn, onToggle, label }) => {
  return (
    <div className="toggle-container">
      <span className="toggle-label">{label}</span>
      <div
        className={`toggle-switch ${isOn ? "active" : ""}`}
        onClick={onToggle}
      >
        <div className="toggle-slider"></div>
      </div>
    </div>
  );
};

function Settings({ onSettingChange, onCloseSettings, settings }) {
  // Getting current settings
  const { pauseMusicOnPause } = settings;
  //Get hooks from spotifyAuth
  const { isAuthenticated, isLoading, error, login, logout } =
    useSpotifyAuth();

  //Handling login and logout
  const handleSpotifyConnection = () => {
    if (isAuthenticated) {
      logout();
    } else {
      login();
    }
  };

  const handleToggle = (settingKey) => {
    const newSettings = {
      ...settings, // copy all current settings
      [settingKey]: !settings[settingKey], // Flip the value of the one that was clicked
    };
    // Call the function from App.jsx to update the master state
    onSettingChange(newSettings);
  };

  return (
    <>
      <div className="settings-container">
        <h1>Settings</h1>
        <button className="back-btn" onClick={onCloseSettings}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth="1.5"
            stroke="currentColor"
            className="size-6"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3"
            />
          </svg>
        </button>
        <div className="spotify-connection">
          {isAuthenticated ? (
            <div className="connected-state">
              <div className="spotify-info">
                <div className="spotify-setting-logo">
                  <img src={spotifyIcon} alt="Spotify" />
                </div>
              </div>
              <button
                className="disconnect-btn"
                onClick={handleSpotifyConnection}
                disabled={isLoading}
              >
                {isLoading ? "Loading" : "Disconnect"}
              </button>
            </div>
          ) : (
            <button
              className="connect-btn"
              onClick={handleSpotifyConnection}
              disabled={isLoading}
            >
              {isLoading ? "Loading" : "Connect"}
            </button>
          )}
          {error && <p className="settings-error">{error}</p>}
        </div>

        {isAuthenticated && (
          <SwitchPlaylist settings={settings} onSettingChange={onSettingChange} />
        )}

        <div className="timer-settings">
          <div className="setting-item">
            <ToggleSwitch
              isOn={pauseMusicOnPause}
              onToggle={() => handleToggle("pauseMusicOnPause")}
              label="Pause music on timer pause"
            />
          </div>
        </div>
      </div>
    </>
  );
}

export default Settings;
