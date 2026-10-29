import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeFunctionData } from "viem";
import { describe, expect, it } from "vitest";
import launchpadAbi from "../src/abi/launchpad.json" with { type: "json" };
import { parseCommand } from "../src/commands/parse.ts";
import { buildTx } from "../src/commands/write.ts";
import { MAX_META_CID_BYTES, MAX_NAME_BYTES, MAX_SYMBOL_BYTES, validateTicket } from "../src/ticket.ts";

// Shared with web/test/ticket.test.ts.
const VALID = { name: "Agent", symbol: "AGT", metaCid: "bafy123", taxed: true };
const CTX = { targets: { launchpad: "0x3333333333333333333333333333333333333333" } } as const;

function writeTicket(ticket: unknown): string {
  const file = join(mkdtempSync(join(tmpdir(), "ticket-")), "ticket.json");
  writeFileSync(file, JSON.stringify(ticket));
  return file;
}

describe("validateTicket (mirrored by web/lib/ticket.ts)", () => {
  it("acceptsTicketAtEveryLengthLimit", () => {
    const ticket = {
      ...VALID,
      name: "n".repeat(MAX_NAME_BYTES),
      symbol: "S".repeat(MAX_SYMBOL_BYTES),
      metaCid: "c".repeat(MAX_META_CID_BYTES),
    };
    expect(validateTicket(ticket)).toEqual(ticket);
  });

  it("acceptsATaxedTicketAndDropsUnknownFields", () => {
    expect(validateTicket({ ...VALID, extra: 1 })).toEqual(VALID);
  });

  it.each([
    [{ ...VALID, name: "n".repeat(MAX_NAME_BYTES + 1) }, /name is 65 bytes \(max 64\)/],
    [{ ...VALID, symbol: "S".repeat(MAX_SYMBOL_BYTES + 1) }, /symbol is 17 bytes \(max 16\)/],
    [{ ...VALID, metaCid: "c".repeat(MAX_META_CID_BYTES + 1) }, /metaCid is 129 bytes \(max 128\)/],
    // 22 three-byte characters are 66 UTF-8 bytes: over the contract's byte limit though only 22 chars.
    [{ ...VALID, name: "币".repeat(22) }, /name is 66 bytes \(max 64\)/],
    [{ ...VALID, name: "" }, /missing name/],
    [{ name: "Agent", symbol: "AGT", metaCid: "bafy123" }, /taxed must be true/],
    [{ ...VALID, taxed: false }, /only tax-token launches are open/],
    [{ ...VALID, taxed: "true" }, /taxed must be true/],
    [{ ...VALID, salt: `0x${"00".repeat(32)}` }, /v1 ticket/],
    [null, /JSON object/],
  ])("rejects %j", (ticket, message) => {
    expect(() => validateTicket(ticket)).toThrow(message);
  });
});

describe("create reads and validates the ticket file", () => {
  it("encodesAValidTicketWithTheTaxFlag", async () => {
    const tx = await buildTx(parseCommand(["create", writeTicket(VALID)]), CTX);
    expect(tx.to).toBe(CTX.targets.launchpad);
    expect(tx.gasLimit).toBeUndefined();
    expect(decodeFunctionData({ abi: launchpadAbi, data: tx.data }).args).toEqual(["Agent", "AGT", "bafy123", true]);
  });

  it("refusesAPlainTicketBeforeSending", async () => {
    const file = writeTicket({ ...VALID, taxed: false });
    await expect(buildTx(parseCommand(["create", file]), CTX)).rejects.toThrow(/only tax-token launches are open/);
  });

  it("refusesAV1TicketWithSalt", async () => {
    const file = writeTicket({ name: "A", symbol: "B", metaCid: "c", salt: `0x${"ab".repeat(32)}` });
    await expect(buildTx(parseCommand(["create", file]), CTX)).rejects.toThrow(/ticket .*ticket\.json: v1 ticket/);
  });
});
