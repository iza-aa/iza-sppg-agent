import { describe, it, expect } from "vitest";
import { metaAgent } from "../src/core/ai/meta-agent.js";
import { buildDeleteChildItemKeyboard } from "../src/core/telegram/keyboards.js";

describe("Delete Child Item Intent & Keyboard Tests", () => {
  it("should classify standard delete child item syntax", async () => {
    const res = await metaAgent.classifyAndRoute("hapus rincian ceker ayam dari EI001");
    expect(res).toEqual({
      type: "DELETE_ITEM",
      transactionId: "EI001",
      itemName: "ceker ayam",
    });
  });

  it("should classify delete bahan syntax with di preposition", async () => {
    const res = await metaAgent.classifyAndRoute("hapus bahan ati ampela di EI001");
    expect(res).toEqual({
      type: "DELETE_ITEM",
      transactionId: "EI001",
      itemName: "ati ampela",
    });
  });

  it("should classify direct item delete without prefix keyword", async () => {
    const res = await metaAgent.classifyAndRoute("hapus ceker ayam dari EI001");
    expect(res).toEqual({
      type: "DELETE_ITEM",
      transactionId: "EI001",
      itemName: "ceker ayam",
    });
  });

  it("should classify delete item with full transaction code", async () => {
    const res = await metaAgent.classifyAndRoute("hapus ceker ayam dari nota SPPG0226-EI001");
    expect(res).toEqual({
      type: "DELETE_ITEM",
      transactionId: "SPPG0226-EI001",
      itemName: "ceker ayam",
    });
  });

  it("should classify inverted order syntax (hapus dari [ID] [item])", async () => {
    const res = await metaAgent.classifyAndRoute("hapus dari EI001 rincian ceker ayam");
    expect(res).toEqual({
      type: "DELETE_ITEM",
      transactionId: "EI001",
      itemName: "ceker ayam",
    });

    const res2 = await metaAgent.classifyAndRoute("hapus di EI001 bahan tempe mendoan");
    expect(res2).toEqual({
      type: "DELETE_ITEM",
      transactionId: "EI001",
      itemName: "tempe mendoan",
    });
  });

  it("should classify delete item without transaction ID as DELETE_ITEM with empty transactionId", async () => {
    const res = await metaAgent.classifyAndRoute("hapus rincian ceker ayam");
    expect(res).toEqual({
      type: "DELETE_ITEM",
      transactionId: "",
      itemName: "ceker ayam",
    });
  });

  it("should preserve standard DELETE_TRANSACTION for whole transaction deletes", async () => {
    const r1 = await metaAgent.classifyAndRoute("hapus EI001");
    expect(r1).toEqual({
      type: "DELETE_TRANSACTION",
      transactionId: "EI001",
    });

    const r2 = await metaAgent.classifyAndRoute("hapus transaksi EI001");
    expect(r2).toEqual({
      type: "DELETE_TRANSACTION",
      transactionId: "EI001",
    });

    const r3 = await metaAgent.classifyAndRoute("hapus rincian EI001");
    expect(r3).toEqual({
      type: "DELETE_TRANSACTION",
      transactionId: "EI001",
    });
  });

  it("should generate inline keyboard within Telegram 64-byte callback limit", () => {
    const kb = buildDeleteChildItemKeyboard("SPPG0226-EI001", 2);
    expect(kb).toBeDefined();
    const inlineButtons = kb.inline_keyboard[0];
    expect(inlineButtons).toHaveLength(2);

    const yesCallback = inlineButtons[0].callback_data;
    const noCallback = inlineButtons[1].callback_data;

    expect(yesCallback).toBe("v:delit_yes:SPPG0226-EI001:2");
    expect(noCallback).toBe("v:delit_no:SPPG0226-EI001");

    expect(Buffer.byteLength(yesCallback, "utf8")).toBeLessThanOrEqual(64);
    expect(Buffer.byteLength(noCallback, "utf8")).toBeLessThanOrEqual(64);
  });

  it("should classify hapus pagu item correctly without pagu prefix in itemName", async () => {
    const res = await metaAgent.classifyAndRoute("hapus pagu ceker ayam dari PO-2026/09/SPPG2-01");
    expect(res).toEqual({
      type: "DELETE_ITEM",
      transactionId: "PO-2026/09/SPPG2-01",
      itemName: "ceker ayam",
    });
  });

  it("should generate inline keyboard for pagu deletion within Telegram 64-byte limit", () => {
    const kb = buildDeleteChildItemKeyboard("PO-2026/09/SPPG2-01", 6);
    expect(kb).toBeDefined();
    const inlineButtons = kb.inline_keyboard[0];
    expect(inlineButtons).toHaveLength(2);

    const yesCallback = inlineButtons[0].callback_data;
    const noCallback = inlineButtons[1].callback_data;

    expect(Buffer.byteLength(yesCallback, "utf8")).toBeLessThanOrEqual(64);
    expect(Buffer.byteLength(noCallback, "utf8")).toBeLessThanOrEqual(64);
  });

  it("should never overwrite Pagu item name or supplier in Tab 06 from Tab 05 edits", async () => {
    const { MarginSheetsService } = await import("../src/core/google/services/margin-sheets.service.js");
    const svc = new MarginSheetsService();

    // Col 3 (Supplier) and Col 4 (Uraian Bahan) must be rejected
    const resCol3 = await svc.cascadeRincianPengeluaranChangeToRekapMargin(
      "dummy-id",
      "PO-2026/09/SPPG2-01",
      "Beras Medium",
      3,
      "Pasar Baru"
    );
    expect(resCol3).toBe(false);

    const resCol4 = await svc.cascadeRincianPengeluaranChangeToRekapMargin(
      "dummy-id",
      "PO-2026/09/SPPG2-01",
      "Beras Medium",
      4,
      "Minyak Goreng"
    );
    expect(resCol4).toBe(false);
  });
});
