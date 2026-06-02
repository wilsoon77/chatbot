import React from 'react';
import { MessageSquare, X } from 'lucide-react';

interface ChatBubbleProps {
  isOpen: boolean;
  onClick: () => void;
  color: string;
}

export function ChatBubble({ isOpen, onClick, color }: ChatBubbleProps) {
  return (
    <div
      className={`chatbot-bubble ${isOpen ? 'open' : ''}`}
      onClick={onClick}
      style={{
        backgroundColor: color,
        '--primary-color': color,
        '--primary-color-hover': color,
      } as React.CSSProperties}
      title={isOpen ? 'Cerrar chat' : 'Iniciar chat'}
    >
      {isOpen ? <X size={28} /> : <MessageSquare size={28} />}
    </div>
  );
}
