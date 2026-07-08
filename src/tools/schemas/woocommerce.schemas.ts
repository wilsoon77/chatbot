import { z } from 'zod';

export const buscarProductosSchema = z.object({
  query: z.string({
    invalid_type_error: 'El parámetro "query" debe ser un texto.',
  }).trim().optional(),
  
  categoria: z.union([z.string(), z.number()]).optional().transform(
    (val) => (val !== undefined ? String(val).trim() : undefined),
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
