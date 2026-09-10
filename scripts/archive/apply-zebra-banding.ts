import { GoogleSheetsService } from "../src/core/google/sheets.service.js";
import { env } from "../src/config/env.js";

async function applyZebraBanding() {
  const sheetsService = new GoogleSheetsService();

  const spreadsheets = [
    { name: "Patila", id: env.GOOGLE_SHEET_ID_PATILA },
    { name: "Unit 2", id: env.GOOGLE_SHEET_ID_UNIT2 },
    { name: "Unit 3", id: env.GOOGLE_SHEET_ID_UNIT3 },
  ];

  for (const s of spreadsheets) {
    if (!s.id) continue;
    console.log(`\nApplying missing zebra banding to ${s.name} (${s.id})...`);
    await sheetsService.applyBandingToMissingSheets(s.id);
  }

  console.log("\nAll units processed!");
}

applyZebraBanding().catch(console.error);
