import React, { useState, useRef, useEffect } from 'react';
import { Send, X, Bot } from 'lucide-react';
import type { Message } from '../services/chat.api.ts';
import { ProductCard } from './ProductCard.tsx';
import type { WooProductItem } from './ProductCard.tsx';
import { Typing } from './Typing.tsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';

interface ChatWindowProps {
  isOpen: boolean;
  onClose: () => void;
  botName: string;
  avatarUrl: string;
  color: string;
  messages: Message[];
  onSendMessage: (text: string) => void;
  isTyping: boolean;
  products: Record<number, WooProductItem[]>; // Mapeo de index de mensaje -> productos
}

export function ChatWindow({
  isOpen,
  onClose,
  botName,
  avatarUrl,
  color,
  messages,
  onSendMessage,
  isTyping,
  products,
}: ChatWindowProps) {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll al final cuando llegan nuevos mensajes o typing cambia
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  const handleSend = () => {
    if (!inputText.trim()) return;
    onSendMessage(inputText.trim());
    setInputText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const isDisabled = isTyping || messages.some((m) => m.isStreaming);

  return (
    <div
      className={`chatbot-window ${isOpen ? 'open' : ''}`}
      style={{
        '--primary-color': color,
        '--bg-chat-header': color,
        '--bg-msg-user': color,
      } as React.CSSProperties}
    >
      {/* ─── Encabezado ─── */}
      <div className="chatbot-header">
        <div className="chatbot-header-info">
          <div className="chatbot-avatar">
            {avatarUrl ? (
              <img src={avatarUrl} alt={botName} />
            ) : (
              <Bot size={20} className="chatbot-avatar-text" />
            )}
          </div>
          <div className="chatbot-title-container">
            <span className="chatbot-bot-name">{botName}</span>
            <span className="chatbot-status">En línea</span>
          </div>
        </div>
        <button className="chatbot-close-btn" onClick={onClose} title="Cerrar chat">
          <X size={18} />
        </button>
      </div>

      {/* ─── Contenedor de Mensajes ─── */}
      <div className="chatbot-messages-container">
        {messages.map((msg, index) => {
          // Ignorar los mensajes internos con rol "system" o "tool" en la interfaz
          if (msg.role === 'system' || msg.role === 'tool') return null;

          // Si es un mensaje de "Llamando herramientas" interno, no mostrarlo
          if (msg.role === 'assistant' && msg.content.startsWith('[Llamando herramientas:')) {
            return null;
          }

          const isUser = msg.role === 'user';
          
          return (
            <div key={index} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div className={`chatbot-message-row ${isUser ? 'user' : 'assistant'}`}>
                <div className="chatbot-message-bubble">
                  {isUser ? (
                    msg.content
                  ) : (
                    <div className={`chatbot-markdown-content ${msg.isStreaming ? 'is-streaming' : ''}`}>
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeSanitize]}
                      >
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              </div>

              {/* RENDERIZADO DE PRODUCTOS CAROUSEL SI EXISTEN PARA ESTE MENSAJE */}
              {!isUser && products[index] && products[index].length > 0 && (
                <div className="chatbot-products-carousel">
                  {products[index].map((prod) => (
                    <ProductCard key={prod.id} product={prod} />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {isTyping && <Typing />}
        <div ref={messagesEndRef} />
      </div>

      {/* ─── Entrada de Texto ─── */}
      <div className="chatbot-input-container">
        <textarea
          className="chatbot-textarea"
          rows={1}
          placeholder={isDisabled ? 'El asistente está escribiendo...' : 'Escribe tu mensaje...'}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isDisabled}
        />
        <button
          className="chatbot-send-btn"
          onClick={handleSend}
          disabled={!inputText.trim() || isDisabled}
          title="Enviar"
        >
          <Send size={16} />
        </button>
      </div>

      {/* ─── Marca / Branding ─── */}
      <div className="chatbot-powered-by">
        Powered by <a href="#" target="_blank" rel="noopener noreferrer">Asistente</a>
      </div>
    </div>
  );
}
