import { describe, it, expect } from "vitest";
import { metaAgent } from "../src/core/ai/meta-agent.js";

describe("MetaAgent Fast-Path & Heuristic Intent Classifier", () => {
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

  it("should classify transaction list inquiries as LIST_TRANSACTIONS", async () => {
    expect(await metaAgent.classifyAndRoute("transaksi")).toEqual({ type: "LIST_TRANSACTIONS", limit: 8 });
    expect(await metaAgent.classifyAndRoute("daftar belanja")).toEqual({ type: "LIST_TRANSACTIONS", limit: 8 });
    expect(await metaAgent.classifyAndRoute("5 transaksi")).toEqual({ type: "LIST_TRANSACTIONS", limit: 5 });
  });

  it("should classify detail transaction inquiries with ID", async () => {
    const res = await metaAgent.classifyAndRoute("detail SUPP-EXP-1725500000");
    expect(res).toEqual({ type: "DETAIL_TRANSACTION", transactionId: "SUPP-EXP-1725500000" });

    const res2 = await metaAgent.classifyAndRoute("cek ORD-SPPG-1725500000");
    expect(res2).toEqual({ type: "DETAIL_TRANSACTION", transactionId: "ORD-SPPG-1725500000" });
  });

  it("should classify delete transaction inquiries with ID", async () => {
    const res = await metaAgent.classifyAndRoute("hapus SUPP-EXP-1725500000");
    expect(res).toEqual({ type: "DELETE_TRANSACTION", transactionId: "SUPP-EXP-1725500000" });

    const res2 = await metaAgent.classifyAndRoute("batalkan SUPP-EXP-1725500000");
    expect(res2).toEqual({ type: "DELETE_TRANSACTION", transactionId: "SUPP-EXP-1725500000" });
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
  });

  it("should classify invite command with name and role", async () => {
    const res = await metaAgent.classifyAndRoute("undang Ayah admin");
    expect(res).toEqual({
      type: "INVITE",
      name: "Ayah",
      role: "admin",
    });

    const res2 = await metaAgent.classifyAndRoute("tambah operator Budi member");
    expect(res2).toEqual({
      type: "INVITE",
      name: "Budi",
      role: "member",
    });
  });
});
