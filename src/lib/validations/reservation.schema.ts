import { z } from 'zod';

export const createReservationSchema = z.object({
  productId: z.string().min(1, 'Product ID is required'),
  warehouseId: z.string().min(1, 'Warehouse ID is required'),
  quantity: z
    .number()
    .int('Quantity must be an integer')
    .positive('Quantity must be greater than zero')
    .max(10, 'A single reservation is capped at 10 items for security'),
});

export type CreateReservationInput = z.infer<typeof createReservationSchema>;
