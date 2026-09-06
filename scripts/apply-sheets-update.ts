import { googleSheetsService } from "../src/core/google/sheets.service.js";
import { env } from "../src/config/env.js";

async function run() {
  console.log("1. Applying to SPPG Patila...");
  await googleSheetsService.ensureHeadersAndFormulas(env.GOOGLE_SHEET_ID_PATILA, "SPPG Patila", true);

  console.log("2. Applying to SPPG Unit 2...");
  await googleSheetsService.ensureHeadersAndFormulas(env.GOOGLE_SHEET_ID_UNIT2, "SPPG Unit 2", true);

  console.log("3. Applying to SPPG Unit 3...");
  await googleSheetsService.ensureHeadersAndFormulas(env.GOOGLE_SHEET_ID_UNIT3, "SPPG Unit 3", true);

  console.log("4. Applying to Master Dashboard...");
  await googleSheetsService.ensureMasterDashboardStructure(env.GOOGLE_SHEET_ID_MASTER, true);

  console.log("All 4 spreadsheets updated successfully!");
}

run().catch(console.error);
