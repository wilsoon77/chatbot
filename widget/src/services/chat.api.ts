export interface Message {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  isStreaming?: boolean;
}

function resolveBaseUrl(apiUrl?: string): string {
  return (apiUrl || import.meta.env.VITE_API_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

export async function sendChatMessage(
  tenantId: string,
  sessionId: string,
  message: string,
  apiUrl?: string,
): Promise<{ reply: string }> {
  const response = await fetch(`${resolveBaseUrl(apiUrl)}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true',
    },
    body: JSON.stringify({
      tenant_id: tenantId,
      session_id: sessionId,
      message,
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
  onAction: (action: any) => void,
  apiUrl?: string,
): Promise<void> {
  const response = await fetch(`${resolveBaseUrl(apiUrl)}/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true',
    },
    body: JSON.stringify({
      tenant_id: tenantId,
      session_id: sessionId,
      message,
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
  let currentEvent = '';
  let receivedDone = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith('event:')) {
        currentEvent = trimmed.substring(6).trim();
        continue;
      }

      if (!trimmed.startsWith('data:')) continue;

      const dataStr = trimmed.substring(5).trim();
      let parsed: any;
      try {
        parsed = JSON.parse(dataStr);
      } catch {
        throw new Error('Respuesta SSE inválida');
      }

      if (currentEvent === 'token') {
        onToken(parsed.content ?? '');
      } else if (currentEvent === 'products') {
        onProducts(parsed.products ?? []);
      } else if (currentEvent === 'action') {
        onAction(parsed.action ?? null);
      } else if (currentEvent === 'error') {
        throw new Error(parsed.message ?? 'Error en stream');
      } else if (currentEvent === 'done') {
        receivedDone = true;
      }
    }
  }

  if (!receivedDone) {
    throw new Error('La conexión SSE terminó antes de completar la respuesta');
  }
}
