import React, { useState } from 'react';
import './ChatSidebar.css';

interface ChatMessage {
  id: string;
  sender: 'user' | 'bot';
  content: string;
}

interface ChatSidebarProps {
  isVisible: boolean;
  onClose?: () => void;
}

const ChatSidebar: React.FC<ChatSidebarProps> = ({ isVisible, onClose }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: '1', sender: 'bot', content: 'How can I help you regarding your workflow today?' }
  ]);
  const [inputValue, setInputValue] = useState('');

  if (!isVisible) return null;

  const handleSendMessage = () => {
    if (!inputValue.trim()) return;

    const newMessage: ChatMessage = {
      id: Date.now().toString(),
      sender: 'user',
      content: inputValue
    };

    setMessages(prev => [...prev, newMessage]);
    setInputValue('');

    // Simulate bot response
    setTimeout(() => {
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        sender: 'bot',
        content: "I'm a placeholder for the real Copilot. I can help with step configurations."
      }]);
    }, 1000);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="chat-sidebar">
      <div className="chat-sidebar-header">
        <span>Copilot Chat</span>
        {onClose && (
            <button 
                onClick={onClose} 
                style={{ 
                    background: 'none', 
                    border: 'none', 
                    color: 'inherit', 
                    cursor: 'pointer',
                    fontSize: '16px' 
                }}
            >
                ✕
            </button>
        )}
      </div>
      <div className="chat-messages">
        {messages.map(msg => (
          <div key={msg.id} className={`chat-message ${msg.sender}`}>
             <strong>{msg.sender === 'user' ? 'You' : 'Copilot'}</strong>
             <div>{msg.content}</div>
          </div>
        ))}
      </div>
      <div className="chat-input-area">
        <textarea
          className="chat-input"
          placeholder="Ask Copilot a question..."
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
        />
      </div>
    </div>
  );
};

export default ChatSidebar;
