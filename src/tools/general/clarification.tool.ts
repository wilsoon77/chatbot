import { Injectable } from '@nestjs/common';
import type { ToolDefinition } from '../../llm/llm.interfaces.js';
import { BaseTool } from '../base.tool.js';
import { z } from 'zod';

export const pedirAclaracionSchema = z.object({
  pregunta: z
    .string({
      required_error: 'El parámetro "pregunta" es obligatorio.',
    })
    .trim()
    .min(1, 'El parámetro "pregunta" no puede estar vacío.'),
});

@Injectable()
export class ClarificationTool extends BaseTool {
  readonly name = 'pedir_aclaracion';
  readonly inputSchema = pedirAclaracionSchema;
  readonly promptDescription = 'pedir aclaración cuando falta un dato obligatorio';

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description:
        'Pídela SOLO cuando el usuario quiere una acción concreta (ver stock, ' +
        'consultar pedido, agregar al carrito) pero falta un dato obligatorio que NO está en el contexto ' +
        'de la conversación (y NO se puede obtener con una búsqueda). ' +
        'Antes de usarla, revisa si el dato ya fue mostrado (productos, IDs) y, de ser así, resuélvelo directamente. ' +
        'NUNCA la uses para refinar una búsqueda de productos (marca, modelo, etc.) — busca primero con lo que tengas. ' +
        'No la uses para saludos, opiniones, ni para confirmar una acción ya completada (como agregar al carrito). ' +
        'Escribe en "pregunta" la duda exacta que plantearás al usuario.',
      parameters: {
        type: 'object',
        properties: {
          pregunta: {
            type: 'string',
            description:
              'La pregunta aclaratoria o solicitud de información que le harás al usuario.',
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
