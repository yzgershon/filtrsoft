import {z} from "zod";
export const economicsInput=z.object({label:z.string().min(1).max(80),
  min_absolute_profit_cents:z.number().int().min(0).max(100000000),effective_hourly_floor_cents:z.number().int().min(0).max(100000000),
  transaction_minutes:z.number().int().min(0).max(1440),relist_minutes:z.number().int().min(0).max(1440),
  prefers_channel:z.enum(['ebay','facebook'])}).strict();
export const checkInput=z.object({url:z.string().min(1).max(4096),vision:z.boolean().optional(),
  driveMinutes:z.number().int().min(0).max(240).optional(),economics:economicsInput.optional()}).strict();

export const outcomeInput=z.object({action:z.enum(['bought','passed','no_reply','dead_listing','was_scam']),
  pricePaidCents:z.number().int().min(0).max(100000000).optional(),notes:z.string().max(500).optional(),decisionToken:z.uuid().optional()}).strict();
