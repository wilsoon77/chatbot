import { useState, useEffect } from 'react';
import { ChatBubble } from './components/ChatBubble.tsx';
import { ChatWindow } from './components/ChatWindow.tsx';
import { sendChatMessage } from './services/chat.api.ts';
import type { Message } from './services/chat.api.ts';
import type { WooProductItem } from './components/ProductCard.tsx';

interface AppProps {
  tenant: string;
  color: string;
  botName: string;
  avatarUrl: string;
}

export default function App({ tenant, color, botName, avatarUrl }: AppProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  
  // Almacena las listas de productos vinculadas al índice del mensaje del asistente
  const [products, setProducts] = useState<Record<number, WooProductItem[]>>({});
  const [sessionId, setSessionId] = useState<string>('');

  useEffect(() => {
    if (!tenant) return;

    // 1. Inicializar session_id único de forma persistente para este navegador
    let sId = localStorage.getItem(`chat_session_${tenant}`);
    if (!sId) {
      sId = `sess_${Math.random().toString(36).substring(2, 15)}_${Date.now()}`;
      localStorage.setItem(`chat_session_${tenant}`, sId);
    }
    setSessionId(sId);

    // 2. Cargar historial y productos del localStorage si existen para esta sesión
    const storedHistory = localStorage.getItem(`chat_history_${tenant}_${sId}`);
    const storedProducts = localStorage.getItem(`chat_products_${tenant}_${sId}`);
    
    if (storedHistory) {
      setMessages(JSON.parse(storedHistory));
      if (storedProducts) {
        setProducts(JSON.parse(storedProducts));
      }
    } else {
      // Mensaje de bienvenida por defecto inicial
      const welcomeMsg: Message = {
        role: 'assistant',
        content: `¡Hola! Soy tu asistente de compras. ¿En qué te puedo ayudar hoy? Puedes preguntarme por los productos de nuestra tienda, sus precios o consultar la disponibilidad en stock.`
      };
      setMessages([welcomeMsg]);
    }
  }, [tenant]);

  // Guardar el estado del chat en el localStorage del cliente
  const saveToLocal = (updatedMsgs: Message[], updatedProds: Record<number, WooProductItem[]>) => {
    if (!sessionId) return;
    localStorage.setItem(`chat_history_${tenant}_${sessionId}`, JSON.stringify(updatedMsgs));
    localStorage.setItem(`chat_products_${tenant}_${sessionId}`, JSON.stringify(updatedProds));
  };

  const handleSendMessage = async (text: string) => {
    if (!text.trim()) return;

    // 1. Añadir mensaje de usuario a la pantalla
    const userMsg: Message = { role: 'user', content: text };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    saveToLocal(updatedMessages, products);

    // 2. Mostrar cargando / animando escritura
    setIsTyping(true);

    try {
      // 3. Enviar consulta HTTP al backend de NestJS
      const res = await sendChatMessage(tenant, sessionId, text);

      // 4. Agregar respuesta del bot al chat
      const assistantMsg: Message = { role: 'assistant', content: res.reply };
      const newMessages = [...updatedMessages, assistantMsg];
      
      const newProducts = { ...products };
      
      // Asocia metadatos de productos estructurados si la respuesta del API los incluye
      if ((res as any).products && Array.isArray((res as any).products)) {
        newProducts[newMessages.length - 1] = (res as any).products;
      }

      setMessages(newMessages);
      setProducts(newProducts);
      saveToLocal(newMessages, newProducts);
    } catch (error) {
      console.error('Error al enviar mensaje:', error);
      const errorMsg: Message = {
        role: 'assistant',
        content: 'Lo siento, en este momento tengo dificultades para conectarme. Por favor, intenta de nuevo más tarde.'
      };
      setMessages([...updatedMessages, errorMsg]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div style={{ display: 'contents' }}>
      <ChatBubble
        isOpen={isOpen}
        onClick={() => setIsOpen(!isOpen)}
        color={color}
      />
      <ChatWindow
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        botName={botName}
        avatarUrl={avatarUrl}
        color={color}
        messages={messages}
        onSendMessage={handleSendMessage}
        isTyping={isTyping}
        products={products}
      />
    </div>
  );
}
