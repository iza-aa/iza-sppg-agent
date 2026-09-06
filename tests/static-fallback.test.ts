import { describe, it, expect } from "vitest";
import {
  parseIndonesianCurrency,
  staticParseTransaction,
  staticConversationalReply,
  staticImageFailureMessage,
} from "../src/core/ai/static-fallback.js";

describe("Layer 3 Static Fallback Unit Tests", () => {
  describe("parseIndonesianCurrency", () => {
    it("should parse 200rb into 200000", () => {
      expect(parseIndonesianCurrency("200rb")).toBe(200000);
      expect(parseIndonesianCurrency("200 ribu")).toBe(200000);
      expect(parseIndonesianCurrency("200k")).toBe(200000);
    });

    it("should parse 1.5jt into 1500000", () => {
      expect(parseIndonesianCurrency("1.5jt")).toBe(1500000);
      expect(parseIndonesianCurrency("1,5 juta")).toBe(1500000);
    });

    it("should parse plain numbers", () => {
      expect(parseIndonesianCurrency("700000")).toBe(700000);
      expect(parseIndonesianCurrency("700.000")).toBe(700000);
    });

    it("should return null for non-currency strings", () => {
      expect(parseIndonesianCurrency("halo")).toBeNull();
    });
  });

  describe("staticParseTransaction", () => {
    it("should parse 'beli ayam 200rb di pasar ayam tunai'", () => {
      const result = staticParseTransaction("beli ayam 200rb di pasar ayam tunai");
      expect(result).not.toBeNull();
      expect(result?.type).toBe("SUPPLIER_EXPENSE");
      if (result?.type === "SUPPLIER_EXPENSE") {
        expect(result.data.total_amount).toBe(200000);
        expect(result.data.supplier_name.toLowerCase()).toContain("pasar ayam");
        expect(result.data.payment_method).toBe("Cash");
      }
    });

    it("should parse 'beli beras 2 karung 700.000 di Hj Muliadi'", () => {
      const result = staticParseTransaction("beli beras 2 karung 700.000 di Hj Muliadi");
      expect(result).not.toBeNull();
      expect(result?.type).toBe("SUPPLIER_EXPENSE");
      if (result?.type === "SUPPLIER_EXPENSE") {
        expect(result.data.total_amount).toBe(700000);
        expect(result.data.supplier_name).toBe("Hj Muliadi");
        expect(result.data.items[0].qty).toBe(2);
        expect(result.data.items[0].unit).toBe("karung");
      }
    });

    it("should parse 'bayar Hj Muliadi 1.5jt minyak goreng'", () => {
      const result = staticParseTransaction("bayar Hj Muliadi 1.5jt minyak goreng");
      expect(result).not.toBeNull();
      expect(result?.type).toBe("SUPPLIER_EXPENSE");
      if (result?.type === "SUPPLIER_EXPENSE") {
        expect(result.data.total_amount).toBe(1500000);
        expect(result.data.supplier_name).toBe("Hj Muliadi");
      }
    });

    it("should not parse questions or general chat as transaction", () => {
      expect(staticParseTransaction("apa kabar bot?")).toBeNull();
      expect(staticParseTransaction("bagaimana cara buat resep gizi?")).toBeNull();
      expect(staticParseTransaction("siapa nama supplier telur?")).toBeNull();
    });
  });

  describe("static messages", () => {
    it("should return static maintenance message containing working commands", () => {
      const reply = staticConversationalReply("SPPG Patila");
      expect(reply).toContain("Sistem AI Sedang Dalam Pemeliharaan");
      expect(reply).toContain("rekap");
      expect(reply).toContain("pdf");
      expect(reply).toContain("sheets");
      expect(reply).toContain("transaksi");
      expect(reply).toContain("SPPG Patila");
    });

    it("should return image failure message with guidance", () => {
      const msg = staticImageFailureMessage();
      expect(msg).toContain("Google Drive");
      expect(msg).toContain("Maintenance");
      expect(msg).toContain("beli [barang] [nominal] di [nama toko]");
    });
  });
});
