export function TimerUpPopup({ onClose }) {
  return (
    <div className="timer-up-overlay" onClick={onClose}>
      <div className="timer-up-popup" onClick={(e) => e.stopPropagation()}>
        <h2>Time's up!</h2>
        <p>Nice work. Take a breather before your next session.</p>
        <button className="dismiss-btn" onClick={onClose}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
