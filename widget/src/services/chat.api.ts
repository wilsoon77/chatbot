export interface Message {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  isStreaming?: boolean;
}

export async function sendChatMessage(
  tenantId: string,
  sessionId: string,
  message: string
): Promise<{ reply: string }> {
  const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
  
  const response = await fetch(`${baseUrl}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true',
    },
    body: JSON.stringify({
      tenant_id: tenantId,
      session_id: sessionId,
      message: message,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Error en el chatbot (${response.status}): ${errText}`);
  }

  return response.json() as Promise<{ reply: string }>;
}

export async function sendChatMessageStream(
  tenantId: string,
  sessionId: string,
  message: string,
  onToken: (token: string) => void,
  onProducts: (products: any[]) => void,
  onAction: (action: any) => void
): Promise<void> {
  const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
  
  const response = await fetch(`${baseUrl}/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true',
    },
    body: JSON.stringify({
      tenant_id: tenantId,
      session_id: sessionId,
      message: message,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Error en el streaming (${response.status}): ${errText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('ReadableStream no soportado en la respuesta');
  }

  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    
    // Guardar fragmento incompleto en el buffer
    buffer = lines.pop() || '';

    let currentEvent = '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith('event:')) {
        currentEvent = trimmed.substring(6).trim();
      } else if (trimmed.startsWith('data:')) {
        const dataStr = trimmed.substring(5).trim();
        try {
          const parsed = JSON.parse(dataStr);
          if (currentEvent === 'token') {
            onToken(parsed.content ?? '');
          } else if (currentEvent === 'products') {
            onProducts(parsed.products ?? []);
          } else if (currentEvent === 'action') {
            onAction(parsed.action ?? null);
          } else if (currentEvent === 'error') {
            throw new Error(parsed.message ?? 'Error en stream');
          }
        } catch (e) {
          console.error('Error parseando chunk SSE:', e, line);
        }
      }
    }
  }
}

