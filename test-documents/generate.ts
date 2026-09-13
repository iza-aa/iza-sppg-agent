import * as fs from "fs";
import * as path from "path";
import PDFDocument from "pdfkit";
import sharp from "sharp";

const OUTPUT_DIR = "/Users/heizaaa/Desktop/cdev/mbg-assistant/test-documents";

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// -------------------------------------------------------------
// 1. GENERATE FOTO NOTA PESANAN SPPG (PNG via SVG + Sharp)
// -------------------------------------------------------------
async function generateNotaPesananSppgPng() {
  const svg = `
  <svg width="850" height="1100" viewBox="0 0 850 1100" xmlns="http://www.w3.org/2000/svg">
    <rect width="850" height="1100" fill="#FFFFFF"/>
    
    <!-- Outer Border -->
    <rect x="25" y="25" width="800" height="1050" fill="none" stroke="#1E293B" stroke-width="2"/>
    <rect x="29" y="29" width="792" height="1042" fill="none" stroke="#64748B" stroke-width="0.75"/>

    <!-- Kop Surat BGN -->
    <text x="425" y="70" font-family="Arial, sans-serif" font-size="16" font-weight="bold" text-anchor="middle" fill="#0F172A">BADAN GIZI NASIONAL (BGN) REPUBLIK INDONESIA</text>
    <text x="425" y="95" font-family="Arial, sans-serif" font-size="14" font-weight="bold" text-anchor="middle" fill="#0369A1">SATUAN PELAYANAN PROGRAM GIZI (SPPG) PATILA</text>
    <text x="425" y="115" font-family="Arial, sans-serif" font-size="11" text-anchor="middle" fill="#475569">Kec. Bone-Bone, Kab. Luwu Utara, Sulawesi Selatan 92966</text>
    <line x1="50" y1="130" x2="800" y2="130" stroke="#0F172A" stroke-width="2"/>
    <line x1="50" y1="133" x2="800" y2="133" stroke="#0F172A" stroke-width="0.75"/>

    <!-- Judul Dokumen -->
    <text x="425" y="175" font-family="Arial, sans-serif" font-size="16" font-weight="bold" text-anchor="middle" fill="#0F172A">NOTA PESANAN BAHAN MAKANAN (SPPG)</text>
    <text x="425" y="195" font-family="Arial, sans-serif" font-size="12" text-anchor="middle" fill="#475569">Menu Harian Program Makanan Bergizi Gratis</text>

    <!-- Metadata Info -->
    <text x="60" y="235" font-family="Arial, sans-serif" font-size="12" font-weight="bold" fill="#1E293B">No. Pesanan (SPPG Ref)</text>
    <text x="230" y="235" font-family="Arial, sans-serif" font-size="12" font-weight="bold" fill="#0F172A">: PO-10/12/09/26</text>

    <text x="60" y="260" font-family="Arial, sans-serif" font-size="12" fill="#1E293B">Tanggal Pesanan</text>
    <text x="230" y="260" font-family="Arial, sans-serif" font-size="12" fill="#0F172A">: 2026-09-12 (12 September 2026)</text>

    <text x="60" y="285" font-family="Arial, sans-serif" font-size="12" fill="#1E293B">Unit Pelayanan</text>
    <text x="230" y="285" font-family="Arial, sans-serif" font-size="12" fill="#0F172A">: SPPG Patila, Luwu Utara</text>

    <!-- Table Header -->
    <rect x="50" y="320" width="750" height="35" fill="#0A192F"/>
    <text x="75" y="343" font-family="Arial, sans-serif" font-size="11" font-weight="bold" fill="#FFFFFF" text-anchor="middle">NO</text>
    <text x="210" y="343" font-family="Arial, sans-serif" font-size="11" font-weight="bold" fill="#FFFFFF">URAIAN BAHAN MAKANAN</text>
    <text x="390" y="343" font-family="Arial, sans-serif" font-size="11" font-weight="bold" fill="#FFFFFF" text-anchor="middle">QTY</text>
    <text x="450" y="343" font-family="Arial, sans-serif" font-size="11" font-weight="bold" fill="#FFFFFF" text-anchor="middle">SATUAN</text>
    <text x="540" y="343" font-family="Arial, sans-serif" font-size="11" font-weight="bold" fill="#FFFFFF" text-anchor="end">HARGA SATUAN</text>
    <text x="670" y="343" font-family="Arial, sans-serif" font-size="11" font-weight="bold" fill="#FFFFFF" text-anchor="end">TOTAL HARGA</text>
    <text x="740" y="343" font-family="Arial, sans-serif" font-size="11" font-weight="bold" fill="#FFFFFF">SUPPLIER</text>

    <!-- Row 1: Beras Medium -->
    <rect x="50" y="355" width="750" height="35" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="0.5"/>
    <text x="75" y="377" font-family="Arial, sans-serif" font-size="11" text-anchor="middle" fill="#0F172A">1</text>
    <text x="110" y="377" font-family="Arial, sans-serif" font-size="11" font-weight="bold" fill="#0F172A">Beras Medium</text>
    <text x="390" y="377" font-family="Arial, sans-serif" font-size="11" text-anchor="middle" fill="#0F172A">150</text>
    <text x="450" y="377" font-family="Arial, sans-serif" font-size="11" text-anchor="middle" fill="#0F172A">KG</text>
    <text x="540" y="377" font-family="Arial, sans-serif" font-size="11" text-anchor="end" fill="#0F172A">Rp 16.000</text>
    <text x="670" y="377" font-family="Arial, sans-serif" font-size="11" font-weight="bold" text-anchor="end" fill="#0F172A">Rp 2.400.000</text>
    <text x="690" y="377" font-family="Arial, sans-serif" font-size="10" fill="#334155">Hj Muliadi</text>

    <!-- Row 2: Ayam Potong -->
    <rect x="50" y="390" width="750" height="35" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="0.5"/>
    <text x="75" y="412" font-family="Arial, sans-serif" font-size="11" text-anchor="middle" fill="#0F172A">2</text>
    <text x="110" y="412" font-family="Arial, sans-serif" font-size="11" font-weight="bold" fill="#0F172A">Ayam Potong Broiler</text>
    <text x="390" y="412" font-family="Arial, sans-serif" font-size="11" text-anchor="middle" fill="#0F172A">200</text>
    <text x="450" y="412" font-family="Arial, sans-serif" font-size="11" text-anchor="middle" fill="#0F172A">Ekor</text>
    <text x="540" y="412" font-family="Arial, sans-serif" font-size="11" text-anchor="end" fill="#0F172A">Rp 60.000</text>
    <text x="670" y="412" font-family="Arial, sans-serif" font-size="11" font-weight="bold" text-anchor="end" fill="#0F172A">Rp 12.000.000</text>
    <text x="690" y="412" font-family="Arial, sans-serif" font-size="10" fill="#334155">Toko Barokah</text>

    <!-- Row 3: Minyak Goreng -->
    <rect x="50" y="425" width="750" height="35" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="0.5"/>
    <text x="75" y="447" font-family="Arial, sans-serif" font-size="11" text-anchor="middle" fill="#0F172A">3</text>
    <text x="110" y="447" font-family="Arial, sans-serif" font-size="11" font-weight="bold" fill="#0F172A">Minyak Kelapa Sawit</text>
    <text x="390" y="447" font-family="Arial, sans-serif" font-size="11" text-anchor="middle" fill="#0F172A">20</text>
    <text x="450" y="447" font-family="Arial, sans-serif" font-size="11" text-anchor="middle" fill="#0F172A">Liter</text>
    <text x="540" y="447" font-family="Arial, sans-serif" font-size="11" text-anchor="end" fill="#0F172A">Rp 18.000</text>
    <text x="670" y="447" font-family="Arial, sans-serif" font-size="11" font-weight="bold" text-anchor="end" fill="#0F172A">Rp 360.000</text>
    <text x="690" y="447" font-family="Arial, sans-serif" font-size="10" fill="#334155">Mas Pandu</text>

    <!-- Row Total -->
    <rect x="50" y="460" width="750" height="40" fill="#E2E8F0" stroke="#94A3B8" stroke-width="1"/>
    <text x="350" y="485" font-family="Arial, sans-serif" font-size="12" font-weight="bold" text-anchor="end" fill="#0F172A">TOTAL PAGU ANGGARAN (3 ITEM):</text>
    <text x="670" y="485" font-family="Arial, sans-serif" font-size="13" font-weight="bold" text-anchor="end" fill="#0369A1">Rp 14.760.000</text>

    <!-- Tanda Tangan -->
    <text x="150" y="560" font-family="Arial, sans-serif" font-size="11" text-anchor="middle" fill="#334155">Mengetahui,</text>
    <text x="150" y="575" font-family="Arial, sans-serif" font-size="11" font-weight="bold" text-anchor="middle" fill="#0F172A">Pejabat Pembuat Komitmen (PPK)</text>
    <text x="150" y="660" font-family="Arial, sans-serif" font-size="11" font-weight="bold" text-anchor="middle" fill="#0F172A">( DR. AHMAD FAUZI, M.SI )</text>
    <text x="150" y="675" font-family="Arial, sans-serif" font-size="10" text-anchor="middle" fill="#64748B">NIP. 19820514 200801 1 007</text>

    <text x="650" y="560" font-family="Arial, sans-serif" font-size="11" text-anchor="middle" fill="#334155">Luwu Utara, 12 September 2026</text>
    <text x="650" y="575" font-family="Arial, sans-serif" font-size="11" font-weight="bold" text-anchor="middle" fill="#0F172A">Kepala SPPG Patila</text>
    <text x="650" y="660" font-family="Arial, sans-serif" font-size="11" font-weight="bold" text-anchor="middle" fill="#0F172A">( M. RISAL, S.STP )</text>
    <text x="650" y="675" font-family="Arial, sans-serif" font-size="10" text-anchor="middle" fill="#64748B">Penanggung Jawab Operasional</text>
  </svg>
  `;

  const dest = path.join(OUTPUT_DIR, "01_FOTO_NOTA_PESANAN_SPPG.png");
  await sharp(Buffer.from(svg))
    .png()
    .toFile(dest);
  console.log("-> 1. Foto Nota Pesanan SPPG (PNG) berhasil dibuat:", dest);
}

// -------------------------------------------------------------
// 2. GENERATE FOTO BON BELANJA SUPPLIER (PNG via SVG + Sharp)
// -------------------------------------------------------------
async function generateBonSupplierPng() {
  const svg = `
  <svg width="600" height="850" viewBox="0 0 600 850" xmlns="http://www.w3.org/2000/svg">
    <rect width="600" height="850" fill="#FFFDF9"/>
    
    <!-- Bon Border -->
    <rect x="20" y="20" width="560" height="810" fill="none" stroke="#D97706" stroke-width="2"/>
    <rect x="24" y="24" width="552" height="802" fill="none" stroke="#F59E0B" stroke-width="0.5"/>

    <!-- Header Toko -->
    <text x="300" y="65" font-family="Courier New, monospace" font-size="20" font-weight="bold" text-anchor="middle" fill="#9A3412">TOKO UNGGAS BAROKAH</text>
    <text x="300" y="85" font-family="Arial, sans-serif" font-size="11" text-anchor="middle" fill="#78350F">Pusat Grosir Ayam Potong &amp; Telur Segar</text>
    <text x="300" y="100" font-family="Arial, sans-serif" font-size="10" text-anchor="middle" fill="#78350F">Jl. Pasar Sentral Bone-Bone, Luwu Utara | Telp/WA: 0812-4455-6677</text>
    <line x1="40" y1="115" x2="560" y2="115" stroke="#9A3412" stroke-width="1.5" stroke-dasharray="4,2"/>

    <!-- Info Nota -->
    <text x="40" y="145" font-family="Arial, sans-serif" font-size="12" font-weight="bold" fill="#1C1917">NOTA KONTAN / BON BELANJA</text>
    <text x="400" y="145" font-family="Courier New, monospace" font-size="12" font-weight="bold" fill="#1C1917">No: 2026/UB-0912</text>

    <text x="40" y="170" font-family="Arial, sans-serif" font-size="11" fill="#44403C">Kepada : Dapur SPPG Patila</text>
    <text x="400" y="170" font-family="Arial, sans-serif" font-size="11" fill="#44403C">Tgl: 12-09-2026</text>

    <text x="40" y="190" font-family="Arial, sans-serif" font-size="11" fill="#44403C">Ref PO  : PO-10/12/09/26</text>

    <!-- Table -->
    <line x1="40" y1="210" x2="560" y2="210" stroke="#44403C" stroke-width="1"/>
    <text x="50" y="225" font-family="Arial, sans-serif" font-size="11" font-weight="bold" fill="#1C1917">BANYAKNYA</text>
    <text x="160" y="225" font-family="Arial, sans-serif" font-size="11" font-weight="bold" fill="#1C1917">NAMA BARANG</text>
    <text x="360" y="225" font-family="Arial, sans-serif" font-size="11" font-weight="bold" text-anchor="end" fill="#1C1917">HARGA</text>
    <text x="540" y="225" font-family="Arial, sans-serif" font-size="11" font-weight="bold" text-anchor="end" fill="#1C1917">JUMLAH (RP)</text>
    <line x1="40" y1="235" x2="560" y2="235" stroke="#44403C" stroke-width="1"/>

    <!-- Items -->
    <text x="50" y="265" font-family="Courier New, monospace" font-size="12" fill="#1C1917">200 Ekor</text>
    <text x="160" y="265" font-family="Courier New, monospace" font-size="12" font-weight="bold" fill="#1C1917">Ayam Potong Broiler</text>
    <text x="360" y="265" font-family="Courier New, monospace" font-size="12" text-anchor="end" fill="#1C1917">55.000</text>
    <text x="540" y="265" font-family="Courier New, monospace" font-size="12" font-weight="bold" text-anchor="end" fill="#1C1917">11.000.000</text>

    <text x="50" y="300" font-family="Courier New, monospace" font-size="12" fill="#1C1917">10 Rak</text>
    <text x="160" y="300" font-family="Courier New, monospace" font-size="12" font-weight="bold" fill="#1C1917">Telur Ayam Ras</text>
    <text x="360" y="300" font-family="Courier New, monospace" font-size="12" text-anchor="end" fill="#1C1917">45.000</text>
    <text x="540" y="300" font-family="Courier New, monospace" font-size="12" font-weight="bold" text-anchor="end" fill="#1C1917">450.000</text>

    <line x1="40" y1="350" x2="560" y2="350" stroke="#44403C" stroke-width="1"/>
    
    <!-- Total -->
    <text x="360" y="375" font-family="Arial, sans-serif" font-size="13" font-weight="bold" text-anchor="end" fill="#1C1917">TOTAL BELANJA :</text>
    <text x="540" y="375" font-family="Courier New, monospace" font-size="15" font-weight="bold" text-anchor="end" fill="#B45309">Rp 11.450.000</text>

    <text x="50" y="420" font-family="Arial, sans-serif" font-size="11" fill="#44403C">Terbilang : <i>Sebelas Juta Empat Ratus Lima Puluh Ribu Rupiah</i></text>
    <text x="50" y="440" font-family="Arial, sans-serif" font-size="11" font-weight="bold" fill="#16A34A">Status     : LUNAS (CASH / TUNAI)</text>

    <!-- Stempel Cap Toko -->
    <circle cx="450" cy="530" r="50" fill="none" stroke="#DC2626" stroke-width="2" stroke-dasharray="6,3" transform="rotate(-15 450 530)"/>
    <text x="450" y="525" font-family="Arial, sans-serif" font-size="11" font-weight="bold" text-anchor="middle" fill="#DC2626" transform="rotate(-15 450 530)">LUNAS</text>
    <text x="450" y="545" font-family="Arial, sans-serif" font-size="9" font-weight="bold" text-anchor="middle" fill="#DC2626" transform="rotate(-15 450 530)">UNGGAS BAROKAH</text>

    <text x="450" y="620" font-family="Arial, sans-serif" font-size="11" text-anchor="middle" fill="#1C1917">Hormat Kami,</text>
    <text x="450" y="680" font-family="Arial, sans-serif" font-size="11" font-weight="bold" text-anchor="middle" fill="#1C1917">( H. Mansyur )</text>
  </svg>
  `;

  const dest = path.join(OUTPUT_DIR, "02_FOTO_BON_BELANJA_SUPPLIER.png");
  await sharp(Buffer.from(svg))
    .png()
    .toFile(dest);
  console.log("-> 2. Foto Bon Belanja Supplier (PNG) berhasil dibuat:", dest);
}

// -------------------------------------------------------------
// 3. GENERATE DOKUMEN PDF SURAT PESANAN BGN (PDFKit)
// -------------------------------------------------------------
function generateSuratPesananBgnPdf(): Promise<void> {
  return new Promise((resolve, reject) => {
    const dest = path.join(OUTPUT_DIR, "03_DOKUMEN_PDF_SURAT_PESANAN_BGN.pdf");
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const stream = fs.createWriteStream(dest);

    doc.pipe(stream);

    // Header BGN
    doc.fontSize(14).font("Helvetica-Bold").text("BADAN GIZI NASIONAL (BGN) REPUBLIK INDONESIA", { align: "center" });
    doc.fontSize(12).fillColor("#0369A1").text("SATUAN PELAYANAN PROGRAM GIZI (SPPG) PATILA", { align: "center" });
    doc.fontSize(9).fillColor("#475569").font("Helvetica").text("Jl. Trans Sulawesi KM 12, Patila, Kec. Bone-Bone, Kab. Luwu Utara 92966", { align: "center" });
    doc.moveDown(0.5);
    doc.moveTo(40, doc.y).lineTo(555, doc.y).lineWidth(1.5).strokeColor("#0F172A").stroke();
    doc.moveDown(1);

    // Title
    doc.fontSize(14).fillColor("#0F172A").font("Helvetica-Bold").text("SURAT PESANAN BAHAN MAKANAN (SPPG)", { align: "center" });
    doc.fontSize(10).font("Helvetica").text("Nomor: PO-11/13/09/26", { align: "center" });
    doc.moveDown(1);

    // Metadata
    doc.fontSize(10).font("Helvetica-Bold").text("Informasi Pesanan:", 40, doc.y);
    doc.font("Helvetica").text("Tanggal Pesanan : 2026-09-13 (13 September 2026)");
    doc.text("Tanggal Kirim   : 2026-09-13");
    doc.text("Unit SPPG       : SPPG Patila, Luwu Utara");
    doc.moveDown(1);

    // Table Header
    const tableTop = doc.y;
    doc.rect(40, tableTop, 515, 22).fill("#0A192F");
    doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(9);
    doc.text("NO", 45, tableTop + 6, { width: 30, align: "center" });
    doc.text("URAIAN BAHAN MAKANAN", 80, tableTop + 6, { width: 170 });
    doc.text("QTY", 255, tableTop + 6, { width: 40, align: "center" });
    doc.text("SATUAN", 300, tableTop + 6, { width: 45, align: "center" });
    doc.text("HARGA (RP)", 350, tableTop + 6, { width: 75, align: "right" });
    doc.text("TOTAL (RP)", 430, tableTop + 6, { width: 80, align: "right" });

    // Table Rows
    const items = [
      { no: 1, name: "Daging Sapi Segar", qty: 50, unit: "KG", price: 140000, total: 7000000, supplier: "Toko Daging Barokah" },
      { no: 2, name: "Sayur Bayam Hijau", qty: 60, unit: "Ikat", price: 5000, total: 300000, supplier: "Pasar Sentral" },
      { no: 3, name: "Bawang Merah Kupas", qty: 10, unit: "KG", price: 35000, total: 350000, supplier: "Toko Bumbu Berkah" },
    ];

    let rowY = tableTop + 22;
    items.forEach((it, i) => {
      const bg = i % 2 === 0 ? "#F8FAFC" : "#FFFFFF";
      doc.rect(40, rowY, 515, 20).fill(bg);
      doc.fillColor("#0F172A").font("Helvetica").fontSize(9);
      doc.text(it.no.toString(), 45, rowY + 5, { width: 30, align: "center" });
      doc.font("Helvetica-Bold").text(it.name, 80, rowY + 5, { width: 170 });
      doc.font("Helvetica").text(it.qty.toString(), 255, rowY + 5, { width: 40, align: "center" });
      doc.text(it.unit, 300, rowY + 5, { width: 45, align: "center" });
      doc.text(it.price.toLocaleString("id-ID"), 350, rowY + 5, { width: 75, align: "right" });
      doc.font("Helvetica-Bold").text(it.total.toLocaleString("id-ID"), 430, rowY + 5, { width: 80, align: "right" });
      rowY += 20;
    });

    // Total Row
    doc.rect(40, rowY, 515, 24).fill("#E2E8F0");
    doc.fillColor("#0F172A").font("Helvetica-Bold").fontSize(10);
    doc.text("TOTAL PAGU ANGGARAN:", 80, rowY + 7, { width: 340, align: "right" });
    doc.fillColor("#0369A1").text("Rp 7.650.000", 430, rowY + 7, { width: 80, align: "right" });

    // Signature
    doc.moveDown(4);
    const sigY = rowY + 50;
    doc.fillColor("#0F172A").font("Helvetica").fontSize(10);
    doc.text("Luwu Utara, 13 September 2026", 350, sigY);
    doc.text("Kepala SPPG Patila", 350, sigY + 15);
    doc.font("Helvetica-Bold").text("M. RISAL, S.STP", 350, sigY + 75);
    doc.font("Helvetica").fontSize(9).text("Penanggung Jawab MBG", 350, sigY + 90);

    doc.end();
    stream.on("finish", () => {
      console.log("-> 3. Dokumen PDF Surat Pesanan BGN berhasil dibuat:", dest);
      resolve();
    });
    stream.on("error", reject);
  });
}

// -------------------------------------------------------------
// 4. GENERATE DOKUMEN PDF FAKTUR TAGIHAN SUPPLIER (PDFKit)
// -------------------------------------------------------------
function generateFakturSupplierPdf(): Promise<void> {
  return new Promise((resolve, reject) => {
    const dest = path.join(OUTPUT_DIR, "04_DOKUMEN_PDF_FAKTUR_SUPPLIER.pdf");
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const stream = fs.createWriteStream(dest);

    doc.pipe(stream);

    // Header Supplier
    doc.fontSize(16).fillColor("#9A3412").font("Helvetica-Bold").text("CV. DISTRIBUTOR PANGAN SEJAHTERA", { align: "left" });
    doc.fontSize(9).fillColor("#57534E").font("Helvetica").text("Penyedia Daging Sapi & Bahan Pokok Segar Berizin Resmi", { align: "left" });
    doc.text("Komp. Pergudangan Sentral No. 45, Luwu | Telp: (0473) 22334 | Email: faktur@pangansejahtera.co.id");
    doc.moveDown(0.5);
    doc.moveTo(40, doc.y).lineTo(555, doc.y).lineWidth(1).strokeColor("#D97706").stroke();
    doc.moveDown(1);

    // Invoice Title
    doc.fontSize(16).fillColor("#0F172A").font("Helvetica-Bold").text("FAKTUR INVOICE TAGIHAN RESMI", { align: "center" });
    doc.fontSize(10).font("Helvetica").text("Nomor Faktur: INV-DPS/2026/09/088", { align: "center" });
    doc.moveDown(1);

    // Bill To & Date
    const infoY = doc.y;
    doc.fontSize(9).font("Helvetica-Bold").text("DITUJUKAN KEPADA:", 40, infoY);
    doc.font("Helvetica").text("Satuan Pelayanan Program Gizi (SPPG) Patila");
    doc.text("Kecamatan Bone-Bone, Kabupaten Luwu Utara");
    doc.text("Ref Pesanan: PO-11/13/09/26");

    doc.font("Helvetica-Bold").text("RINCIAN FAKTUR:", 350, infoY);
    doc.font("Helvetica").text("Tanggal Faktur : 13 September 2026", 350);
    doc.text("Jatuh Tempo    : 14 September 2026", 350);
    doc.text("Metode Bayar   : Transfer Bank Mandiri", 350);
    doc.moveDown(2);

    // Table Header
    const tableTop = doc.y + 10;
    doc.rect(40, tableTop, 515, 22).fill("#78350F");
    doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(9);
    doc.text("NO", 45, tableTop + 6, { width: 30, align: "center" });
    doc.text("DESKRIPSI BARANG / BAHAN", 80, tableTop + 6, { width: 220 });
    doc.text("KUANTITAS", 305, tableTop + 6, { width: 60, align: "center" });
    doc.text("HARGA SATUAN", 370, tableTop + 6, { width: 80, align: "right" });
    doc.text("TOTAL TAGIHAN", 455, tableTop + 6, { width: 90, align: "right" });

    // Item 1
    const rowY = tableTop + 22;
    doc.rect(40, rowY, 515, 22).fill("#FFFBEB");
    doc.fillColor("#1C1917").font("Helvetica").fontSize(9);
    doc.text("1", 45, rowY + 6, { width: 30, align: "center" });
    doc.font("Helvetica-Bold").text("Daging Sapi Segar (Grade A)", 80, rowY + 6, { width: 220 });
    doc.font("Helvetica").text("50 KG", 305, rowY + 6, { width: 60, align: "center" });
    doc.text("Rp 135.000", 370, rowY + 6, { width: 80, align: "right" });
    doc.font("Helvetica-Bold").text("Rp 6.750.000", 455, rowY + 6, { width: 90, align: "right" });

    // Total Row
    const totalY = rowY + 22;
    doc.rect(40, totalY, 515, 25).fill("#FEF3C7");
    doc.fillColor("#78350F").font("Helvetica-Bold").fontSize(10);
    doc.text("TOTAL YANG HARUS DIBAYAR:", 80, totalY + 7, { width: 370, align: "right" });
    doc.fillColor("#B45309").text("Rp 6.750.000", 455, totalY + 7, { width: 90, align: "right" });

    // Payment Info
    doc.moveDown(3);
    const payY = totalY + 40;
    doc.fontSize(9).fillColor("#1C1917").font("Helvetica-Bold").text("Rekening Pembayaran:", 40, payY);
    doc.font("Helvetica").text("Bank Mandiri: 174-00-1234567-8 a.n. CV Distributor Pangan Sejahtera");
    doc.fillColor("#15803D").font("Helvetica-Bold").text("Status: MENUNGGU PEMBAYARAN");

    // Signature
    doc.fillColor("#1C1917").font("Helvetica").fontSize(10);
    doc.text("Hormat Kami,", 380, payY);
    doc.text("Bagian Keuangan & Piutang", 380, payY + 15);
    doc.font("Helvetica-Bold").text("HENDRA WIJAYA, SE", 380, payY + 70);

    doc.end();
    stream.on("finish", () => {
      console.log("-> 4. Dokumen PDF Faktur Supplier berhasil dibuat:", dest);
      resolve();
    });
    stream.on("error", reject);
  });
}

async function main() {
  console.log("=========================================================");
  console.log("MEMBUAT 4 FILE SAMPLE DOKUMEN UJI LIVE TELEGRAM (METODE B)");
  console.log("=========================================================");

  await generateNotaPesananSppgPng();
  await generateBonSupplierPng();
  await generateSuratPesananBgnPdf();
  await generateFakturSupplierPdf();

  console.log("\n>>> SEMUA 4 FILE SAMPLE BERHASIL DIBUAT DI FOLDER test-documents/ <<<");
}

main().catch(console.error);
