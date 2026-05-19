/**
 * Interfaces del módulo LLM.
 * Define los contratos que todos los providers (Google, OpenAI, Anthropic, Ollama) deben implementar.
 */

// ─── Mensajes ───────────────────────────────────────────────

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface Message {
  role: MessageRole;
  content: string;
  /** ID del tool_call al que responde (solo para role = 'tool') */
  toolCallId?: string;
  /** Nombre de la tool que generó esta respuesta (solo para role = 'tool') */
  toolName?: string;
}

// ─── Tool Definitions ───────────────────────────────────────

export interface ToolParameterProperty {
  type: string;
  description: string;
  enum?: string[];
  items?: { type: string };
}

export interface ToolParameters {
  type: 'object';
  properties: Record<string, ToolParameterProperty>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameters;
}

// ─── Respuestas del LLM ────────────────────────────────────

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface LlmResponse {
  /** Texto de respuesta final (puede ser null si hay tool_calls) */
  text: string | null;
  /** Tool calls solicitados por el modelo */
  toolCalls: ToolCall[];
  /** Indica si el modelo quiere llamar a tools */
  hasToolCalls: boolean;
}

// ─── Provider Interface ────────────────────────────────────

export interface ILlmProvider {
  /** Envía mensajes al LLM con tools disponibles y retorna la respuesta */
  chat(messages: Message[], tools: ToolDefinition[]): Promise<LlmResponse>;

  /** Health check del provider — verifica que el servicio esté accesible */
  validateConnection(): Promise<boolean>;

  /** Metadata del modelo activo */
  getModelInfo(): { provider: string; model: string; supportsStreaming: boolean };
}

/** Token de inyección para el provider de LLM */
export const LLM_PROVIDER_TOKEN = 'LLM_PROVIDER_TOKEN';
