// Mirrored by web/lib/ticket.ts. Limits mirror AgentLaunchpad._checkLaunchFields (UTF-8 bytes), so a ticket
// that passes here does not revert BadLaunchFields.
import type { Ticket } from "./calldata.ts";

export type { Ticket } from "./calldata.ts";

export const MAX_NAME_BYTES = 64;
export const MAX_SYMBOL_BYTES = 16;
export const MAX_META_CID_BYTES = 128;

const FIELD_LIMITS = { name: MAX_NAME_BYTES, symbol: MAX_SYMBOL_BYTES, metaCid: MAX_META_CID_BYTES } as const;
type LimitedField = keyof typeof FIELD_LIMITS;

const utf8 = new TextEncoder();

function assertField(field: LimitedField, value: unknown): void {
  if (typeof value !== "string" || value === "") throw new Error(`missing ${field}`);
  const bytes = utf8.encode(value).length;
  if (bytes > FIELD_LIMITS[field]) throw new Error(`${field} is ${bytes} bytes (max ${FIELD_LIMITS[field]})`);
}

/** Validates a ticket object and returns exactly the v2 fields; throws with the offending field. */
export function validateTicket(raw: unknown): Ticket {
  if (typeof raw !== "object" || raw === null) throw new Error("ticket must be a JSON object");
  const ticket = raw as Record<string, unknown>;
  if ("salt" in ticket) throw new Error("v1 ticket (has salt): create a new ticket on the Create page");
  for (const field of Object.keys(FIELD_LIMITS) as LimitedField[]) assertField(field, ticket[field]);
  // createLaunch reverts UntaxedLaunchDisabled for plain launches, so refuse them before sending.
  if (ticket.taxed !== true) throw new Error("taxed must be true: only tax-token launches are open");
  return {
    name: ticket.name as string,
    symbol: ticket.symbol as string,
    metaCid: ticket.metaCid as string,
    taxed: true,
  };
}
