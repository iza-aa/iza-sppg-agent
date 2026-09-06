import { googleSheetsService } from "../src/core/google/sheets.service.js";
import { env } from "../src/config/env.js";
import { logger } from "../src/core/utils/logger.js";

async function setupAllUnits() {
  const units = [
    { name: "SPPG Patila", id: env.GOOGLE_SHEET_ID_PATILA },
    { name: "SPPG Unit 2", id: env.GOOGLE_SHEET_ID_UNIT2 },
    { name: "SPPG Unit 3", id: env.GOOGLE_SHEET_ID_UNIT3 },
  ];

  for (const unit of units) {
    if (!unit.id) {
      logger.warn(`Skipping ${unit.name} (No ID provided in .env)`);
      continue;
    }

    console.log(`\n========================================`);
    console.log(`Setting up 5-Tab Architecture for ${unit.name}...`);
    console.log(`Spreadsheet ID: ${unit.id}`);
    console.log(`========================================`);

    try {
      await googleSheetsService.ensure5TabStructure(unit.id);
      await googleSheetsService.ensureHeadersAndFormulas(unit.id, unit.name, true);
      console.log(`✅ ${unit.name} successfully configured!`);
    } catch (err: any) {
      console.error(`❌ Failed configuring ${unit.name}:`, err.message);
    }
  }

  console.log("\nAll unit spreadsheets configured!");
}

setupAllUnits().catch(console.error);
