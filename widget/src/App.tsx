import { useState, useEffect } from 'react';
import { ChatBubble } from './components/ChatBubble.tsx';
import { ChatWindow } from './components/ChatWindow.tsx';
import { sendChatMessage, sendChatMessageStream } from './services/chat.api.ts';
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

    // 1. Verificar si la última actividad ha expirado (más de 30 minutos)
    const TTL_MS = 30 * 60 * 1000; // 30 minutos
    const storedLastActivity = localStorage.getItem(`chat_last_activity_${tenant}`);
    if (storedLastActivity) {
      const lastActivity = Number(storedLastActivity);
      if (Date.now() - lastActivity > TTL_MS) {
        // Expirado: Limpiar datos de la sesión anterior
        const oldSessionId = localStorage.getItem(`chat_session_${tenant}`);
        if (oldSessionId) {
          localStorage.removeItem(`chat_history_${tenant}_${oldSessionId}`);
          localStorage.removeItem(`chat_products_${tenant}_${oldSessionId}`);
        }
        localStorage.removeItem(`chat_session_${tenant}`);
        localStorage.removeItem(`chat_last_activity_${tenant}`);
      }
    }

    // 2. Inicializar session_id único de forma persistente para este navegador
    let sId = localStorage.getItem(`chat_session_${tenant}`);
    if (!sId) {
      sId = `sess_${Math.random().toString(36).substring(2, 15)}_${Date.now()}`;
      localStorage.setItem(`chat_session_${tenant}`, sId);
      // Establecer actividad inicial
      localStorage.setItem(`chat_last_activity_${tenant}`, Date.now().toString());
    }
    setSessionId(sId);

    // 3. Cargar historial y productos del localStorage si existen para esta sesión
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
    localStorage.setItem(`chat_last_activity_${tenant}`, Date.now().toString());
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
      // 3. Intentar procesar con streaming (SSE)
      let hasStartedAssistantMessage = false;
      const assistantMsgIndex = updatedMessages.length;

      await sendChatMessageStream(
        tenant,
        sessionId,
        text,
        // Al recibir un token de texto
        (token) => {
          if (!hasStartedAssistantMessage) {
            hasStartedAssistantMessage = true;
            setIsTyping(false); // Quitar typing indicator tan pronto como inicie el texto

            const initialMsg: Message = {
              role: 'assistant',
              content: token,
              isStreaming: true,
            };
            setMessages((prev) => [...prev, initialMsg]);
          } else {
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.role === 'assistant') {
                next[next.length - 1] = {
                  ...last,
                  content: last.content + token,
                };
              }
              return next;
            });
          }
        },
        // Al recibir productos recomendados
        (foundProducts) => {
          setProducts((prev) => {
            const next = { ...prev };
            next[assistantMsgIndex] = foundProducts;
            return next;
          });
        },
        // Al recibir una acción automatizada
        (action) => {
          if (action && action.type === 'add_to_cart') {
            const event = new CustomEvent('chatbot:add_to_cart', {
              bubbles: true,
              detail: {
                productId: action.payload.productId,
                quantity: action.payload.quantity,
              },
            });
            window.dispatchEvent(event);
          }
        }
      );

      // Una vez finalizado el stream con éxito
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === 'assistant') {
          next[next.length - 1] = {
            ...last,
            isStreaming: false, // Quitar el cursor parpadeante
          };
        }
        
        // Guardar la versión final del historial
        setProducts((prevProds) => {
          saveToLocal(next, prevProds);
          return prevProds;
        });

        return next;
      });

    } catch (streamError) {
      console.warn('Falló el streaming de chat o no está soportado. Usando fallback sincrónico...', streamError);
      
      // Asegurarse de que el typing indicator esté activo de nuevo para el fallback
      setIsTyping(true);

      // Limpiar un mensaje de asistente a medias si quedó en el estado antes de fallar
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === 'assistant' && last.isStreaming) {
          return prev.slice(0, -1);
        }
        return prev;
      });

      try {
        // 4. Fallback sincrónico
        const res = await sendChatMessage(tenant, sessionId, text);

        // Agregar respuesta del bot al chat
        const assistantMsg: Message = { role: 'assistant', content: res.reply };
        const newMessages = [...updatedMessages, assistantMsg];
        
        const newProducts = { ...products };
        if ((res as any).products && Array.isArray((res as any).products)) {
          newProducts[newMessages.length - 1] = (res as any).products;
        }

        if ((res as any).action) {
          const action = (res as any).action;
          if (action.type === 'add_to_cart') {
            const event = new CustomEvent('chatbot:add_to_cart', {
              bubbles: true,
              detail: {
                productId: action.payload.productId,
                quantity: action.payload.quantity,
              },
            });
            window.dispatchEvent(event);
          }
        }

        setMessages(newMessages);
        setProducts(newProducts);
        saveToLocal(newMessages, newProducts);
      } catch (syncError) {
        console.error('Error en fallback sincrónico:', syncError);
        const errorMsg: Message = {
          role: 'assistant',
          content: 'Lo siento, en este momento tengo dificultades para conectarme. Por favor, intenta de nuevo más tarde.'
        };
        setMessages([...updatedMessages, errorMsg]);
      } finally {
        setIsTyping(false);
      }
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
