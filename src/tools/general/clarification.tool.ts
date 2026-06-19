import { Injectable } from '@nestjs/common';
import type { ToolDefinition } from '../../llm/llm.interfaces.js';
import { BaseTool } from '../base.tool.js';
import { z } from 'zod';

export const pedirAclaracionSchema = z.object({
  pregunta: z.string({
    required_error: 'El parámetro "pregunta" es obligatorio.',
  }).trim().min(1, 'El parámetro "pregunta" no puede estar vacío.'),
});

@Injectable()
export class ClarificationTool extends BaseTool {
  readonly name = 'pedir_aclaracion';
  readonly inputSchema = pedirAclaracionSchema;

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description:
        'Usa esta herramienta EXCLUSIVAMENTE cuando la consulta del usuario pide una acción concreta ' +
        '(buscar producto, ver stock, consultar pedido, agregar al carrito) PERO faltan datos obligatorios ' +
        'para ejecutarla (ej: no indica qué buscar, o falta el ID/correo del pedido). ' +
        'NUNCA la uses ante un saludo, agradecimiento, despedida, pregunta de identidad, o pregunta general ' +
        'como "¿qué venden?". Especifica en el parámetro "pregunta" la duda exacta que le plantearás al usuario.',
      parameters: {
        type: 'object',
        properties: {
          pregunta: {
            type: 'string',
            description: 'La pregunta aclaratoria o solicitud de información que le harás al usuario.',
          },
        },
        required: ['pregunta'],
      },
    };
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const pregunta = String(args.pregunta || '').trim();
    
    // Devolvemos la pregunta formateada como JSON para que el agentic loop la capture fácilmente.
    return JSON.stringify({
      status: 'pending_clarification',
      pregunta: pregunta,
    });
  }
}
