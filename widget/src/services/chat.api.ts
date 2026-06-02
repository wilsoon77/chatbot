export interface Message {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
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
