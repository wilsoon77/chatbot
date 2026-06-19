import { z } from 'zod';

export const buscarProductosSchema = z.object({
  query: z.string({
    required_error: 'El parámetro "query" es obligatorio.',
    invalid_type_error: 'El parámetro "query" debe ser un texto.',
  }).trim().min(1, 'El parámetro "query" no puede estar vacío.'),
  
  categoria: z.union([z.string(), z.number()]).optional().refine(
    (val) => {
      if (val === undefined) return true;
      const strVal = String(val).trim();
      return strVal === '' || /^\d+$/.test(strVal);
    },
    {
      message: 'El parámetro "categoria" debe ser un ID numérico válido (ej: "17" o 17).',
    }
  ),

  limite: z.coerce.number({
    invalid_type_error: 'El parámetro "limite" debe ser un número.',
  }).min(1, 'El límite mínimo es 1.').max(10, 'El límite máximo es 10.').optional(),
});

export const verStockSchema = z.object({
  producto_id: z.coerce.number({
    required_error: 'El parámetro "producto_id" es obligatorio.',
    invalid_type_error: 'El parámetro "producto_id" debe ser un número.',
  }).int('El ID del producto debe ser un número entero.').positive('El ID del producto debe ser un número positivo.'),
});

export const verEstadoPedidoSchema = z.object({
  pedido_id: z.coerce.number({
    required_error: 'El parámetro "pedido_id" es obligatorio.',
    invalid_type_error: 'El parámetro "pedido_id" debe ser un número.',
  }).int('El ID del pedido debe ser un número entero.').positive('El ID del pedido debe ser un número positivo.'),
  
  email: z.string({
    required_error: 'El parámetro "email" es obligatorio.',
  }).trim().email('El correo electrónico no tiene un formato válido.'),
});

export const obtenerCategoriasSchema = z.object({});

export const agregarAlCarritoSchema = z.object({
  producto_id: z.coerce.number({
    required_error: 'El parámetro "producto_id" es obligatorio.',
    invalid_type_error: 'El parámetro "producto_id" debe ser un número.',
  }).int('El ID del producto debe ser un número entero.').positive('El ID del producto debe ser un número positivo.'),
  
  cantidad: z.coerce.number({
    invalid_type_error: 'La cantidad debe ser un número.',
  }).int('La cantidad debe ser un número entero.').min(1, 'La cantidad mínima es 1.').optional(),
});
