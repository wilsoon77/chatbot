export function Typing() {
  return (
    <div className="chatbot-message-row assistant">
      <div className="chatbot-message-bubble" style={{ padding: '8px 12px' }}>
        <div className="chatbot-typing-indicator">
          <div className="chatbot-typing-dot"></div>
          <div className="chatbot-typing-dot"></div>
          <div className="chatbot-typing-dot"></div>
        </div>
      </div>
    </div>
  );
}
