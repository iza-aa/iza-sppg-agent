import { describe, it, expect, vi, beforeEach } from "vitest";
import { metaAgent } from "../src/core/ai/meta-agent.js";
import { agyConnector } from "../src/core/ai/agy-connector.js";

describe("MetaAgent Fast-Path & Heuristic Intent Classifier", () => {
  beforeEach(() => {
    vi.spyOn(agyConnector, "executeReasoning").mockResolvedValue(null);
  });
  it("should classify rekap and margin inquiries as GET_REKAP", async () => {
    expect(await metaAgent.classifyAndRoute("rekap")).toEqual({ type: "GET_REKAP" });
    expect(await metaAgent.classifyAndRoute("rekap hari ini")).toEqual({ type: "GET_REKAP" });
    expect(await metaAgent.classifyAndRoute("margin")).toEqual({ type: "GET_REKAP" });
    expect(await metaAgent.classifyAndRoute("berapa sisa margin")).toEqual({ type: "GET_REKAP" });
  });

  it("should classify PDF and SPJ print inquiries as GET_PDF", async () => {
    expect(await metaAgent.classifyAndRoute("pdf")).toEqual({ type: "GET_PDF" });
    expect(await metaAgent.classifyAndRoute("cetak spj")).toEqual({ type: "GET_PDF" });
    expect(await metaAgent.classifyAndRoute("kirim pdf")).toEqual({ type: "GET_PDF" });
    expect(await metaAgent.classifyAndRoute("cetak laporan")).toEqual({ type: "GET_PDF" });
  });

  it("should classify sheets and spreadsheet inquiries as GET_SHEETS", async () => {
    expect(await metaAgent.classifyAndRoute("sheets")).toEqual({ type: "GET_SHEETS" });
    expect(await metaAgent.classifyAndRoute("spreadsheet")).toEqual({ type: "GET_SHEETS" });
    expect(await metaAgent.classifyAndRoute("buka spreadsheet")).toEqual({ type: "GET_SHEETS" });
    expect(await metaAgent.classifyAndRoute("lihat tabel")).toEqual({ type: "GET_SHEETS" });
  });

  it("should classify identity and authorization inquiries as GET_MY_ID", async () => {
    expect(await metaAgent.classifyAndRoute("myid")).toEqual({ type: "GET_MY_ID" });
    expect(await metaAgent.classifyAndRoute("id saya")).toEqual({ type: "GET_MY_ID" });
    expect(await metaAgent.classifyAndRoute("siapa saya")).toEqual({ type: "GET_MY_ID" });
    expect(await metaAgent.classifyAndRoute("status akun")).toEqual({ type: "GET_MY_ID" });
  });

  it("should classify transaction list inquiries as LIST_TRANSACTIONS with proper filterType", async () => {
    expect(await metaAgent.classifyAndRoute("transaksi")).toEqual({ type: "LIST_TRANSACTIONS", limit: 8, filterType: "picker" });
    expect(await metaAgent.classifyAndRoute("daftar belanja")).toEqual({ type: "LIST_TRANSACTIONS", limit: 8, filterType: "expense" });
    expect(await metaAgent.classifyAndRoute("pengeluaran")).toEqual({ type: "LIST_TRANSACTIONS", limit: 8, filterType: "expense" });
    expect(await metaAgent.classifyAndRoute("riwayat pengeluaran")).toEqual({ type: "LIST_TRANSACTIONS", limit: 8, filterType: "expense" });
    expect(await metaAgent.classifyAndRoute("pendapatan")).toEqual({ type: "LIST_TRANSACTIONS", limit: 8, filterType: "income" });
    expect(await metaAgent.classifyAndRoute("riwayat pendapatan")).toEqual({ type: "LIST_TRANSACTIONS", limit: 8, filterType: "income" });
    expect(await metaAgent.classifyAndRoute("5 transaksi")).toEqual({ type: "LIST_TRANSACTIONS", limit: 5, filterType: "picker" });
  });

  it("should classify detail transaction inquiries with ID", async () => {
    const res = await metaAgent.classifyAndRoute("detail SUPP-EXP-1725500000");
    expect(res).toEqual({ type: "DETAIL_TRANSACTION", transactionId: "SUPP-EXP-1725500000" });

    const res2 = await metaAgent.classifyAndRoute("cek ORD-SPPG-1725500000");
    expect(res2).toEqual({ type: "DETAIL_TRANSACTION", transactionId: "ORD-SPPG-1725500000" });
  });

  it("should classify delete transaction inquiries with ID", async () => {
    const res = await metaAgent.classifyAndRoute("hapus SUPP-EXP-1725500000");
    expect(res).toEqual({
      type: "DELETE_TRANSACTION",
      transactionId: "SUPP-EXP-1725500000",
      transactionIds: ["SUPP-EXP-1725500000"],
    });

    const res2 = await metaAgent.classifyAndRoute("batalkan SUPP-EXP-1725500000");
    expect(res2).toEqual({
      type: "DELETE_TRANSACTION",
      transactionId: "SUPP-EXP-1725500000",
      transactionIds: ["SUPP-EXP-1725500000"],
    });

    // Multi-transaction delete with descriptors
    const res3 = await metaAgent.classifyAndRoute("hapus pendapatan ii001 dan ii002");
    expect(res3).toEqual({
      type: "DELETE_TRANSACTION",
      transactionId: "ii001",
      transactionIds: ["ii001", "ii002"],
    });

    const res4 = await metaAgent.classifyAndRoute("hapus pagu ii001 dan ii002");
    expect(res4).toEqual({
      type: "DELETE_TRANSACTION",
      transactionId: "ii001",
      transactionIds: ["ii001", "ii002"],
    });

    const res5 = await metaAgent.classifyAndRoute("hapus belanja ei001, ei002");
    expect(res5).toEqual({
      type: "DELETE_TRANSACTION",
      transactionId: "ei001",
      transactionIds: ["ei001", "ei002"],
    });

    // Ingredients delete with pagu descriptor should NOT be treated as transaction
    const res6 = await metaAgent.classifyAndRoute("hapus pagu wortel dan telur");
    expect(res6).toEqual({
      type: "DELETE_ITEM",
      transactionId: "",
      itemName: "wortel",
      itemNames: ["wortel", "telur"],
    });
  });

  it("should classify edit transaction inquiries with parsed nominal", async () => {
    const res = await metaAgent.classifyAndRoute("edit SUPP-EXP-1725500000 nominal 500rb");
    expect(res).toEqual({
      type: "EDIT_TRANSACTION",
      transactionId: "SUPP-EXP-1725500000",
      newAmount: 500000,
    });

    const res2 = await metaAgent.classifyAndRoute("ubah SUPP-EXP-1725500000 nominal 1.5jt");
    expect(res2).toEqual({
      type: "EDIT_TRANSACTION",
      transactionId: "SUPP-EXP-1725500000",
      newAmount: 1500000,
    });

    const res3 = await metaAgent.classifyAndRoute("edit ei005 total belanja jadi 1500000");
    expect(res3).toEqual({
      type: "EDIT_TRANSACTION",
      transactionId: "ei005",
      newAmount: 1500000,
    });

    const res4 = await metaAgent.classifyAndRoute("ubah ei005 jadi 1.5jt");
    expect(res4).toEqual({
      type: "EDIT_TRANSACTION",
      transactionId: "ei005",
      newAmount: 1500000,
    });

    const res5 = await metaAgent.classifyAndRoute("edit total belanja ei005 jadi 1500000");
    expect(res5).toEqual({
      type: "EDIT_TRANSACTION",
      transactionId: "ei005",
      newAmount: 1500000,
    });
  });

  it("should classify invite command with name and role", async () => {
    const res = await metaAgent.classifyAndRoute("undang Ahmad admin");
    expect(res).toEqual({
      type: "INVITE",
      name: "Ahmad",
      role: "admin",
    });

    const res2 = await metaAgent.classifyAndRoute("tambah operator Budi member");
    expect(res2).toEqual({
      type: "INVITE",
      name: "Budi",
      role: "member",
    });
  });

  it("should classify short transaction codes and detail queries as DETAIL_TRANSACTION", async () => {
    const r1 = await metaAgent.classifyAndRoute("EI002");
    expect(r1).toEqual({ type: "DETAIL_TRANSACTION", transactionId: "EI002" });

    const r2 = await metaAgent.classifyAndRoute("cek EI002");
    expect(r2).toEqual({ type: "DETAIL_TRANSACTION", transactionId: "EI002" });

    const r3 = await metaAgent.classifyAndRoute("rincian untuk kode transaksi EI002");
    expect(r3).toEqual({ type: "DETAIL_TRANSACTION", transactionId: "EI002" });

    const r4 = await metaAgent.classifyAndRoute("SPPG0126-EI002");
    expect(r4).toEqual({ type: "DETAIL_TRANSACTION", transactionId: "SPPG0126-EI002" });

    // Multi-month tests (Jan: EA, Mar: EC, Aug: EH, Dec: EL)
    const rJan = await metaAgent.classifyAndRoute("EA001");
    expect(rJan).toEqual({ type: "DETAIL_TRANSACTION", transactionId: "EA001" });

    const rMar = await metaAgent.classifyAndRoute("cek EC005");
    expect(rMar).toEqual({ type: "DETAIL_TRANSACTION", transactionId: "EC005" });

    const rAug = await metaAgent.classifyAndRoute("SPPG0126-EH001");
    expect(rAug).toEqual({ type: "DETAIL_TRANSACTION", transactionId: "SPPG0126-EH001" });

    const rDec = await metaAgent.classifyAndRoute("EL012");
    expect(rDec).toEqual({ type: "DETAIL_TRANSACTION", transactionId: "EL012" });
  });

  it("should NOT classify correction phrases like 'salah di pagu ii002 harusnya' as DETAIL_TRANSACTION", async () => {
    const res1 = await metaAgent.classifyAndRoute("salah di pagu ii002 harusnya");
    expect(res1.type).not.toBe("DETAIL_TRANSACTION");

    const res2 = await metaAgent.classifyAndRoute("harusnya di pagu ii001");
    expect(res2.type).not.toBe("DETAIL_TRANSACTION");

    const res3 = await metaAgent.classifyAndRoute("ganti pagu ke ii001");
    expect(res3.type).not.toBe("DETAIL_TRANSACTION");
  });
});
