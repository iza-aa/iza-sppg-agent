import { google } from "googleapis";
import path from "path";
import { env } from "../src/config/env.js";
import {
  hexToRgbColor,
  BGN_PALETTE,
  getOperationalDashboardValues,
  createOperationalDashboardStylingRequests,
  createOperationalDashboardChartRequest,
  createOperationalDashboardResetRequests,
  createHeaderStylingBatchRequests,
  createNumberFormattingBatchRequests,
  createDataValidationBatchRequests,
  createConditionalFormattingBatchRequests,
} from "../src/core/google/sheets-recipes.js";

async function main() {
  const keyPath = path.resolve(process.cwd(), env.GOOGLE_SERVICE_ACCOUNT_PATH);
  const auth = new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = env.GOOGLE_SHEET_ID_PATILA;

  console.log("1. Inspecting spreadsheet...");
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const firstSheet = meta.data.sheets?.[0];
  const firstId = firstSheet?.properties?.sheetId ?? 0;
  const existingCharts = firstSheet?.charts || [];
  const existingChartIds = existingCharts.map((c) => c.chartId!).filter(Boolean);

  console.log(`Target sheet: ${firstSheet?.properties?.title} (ID: ${firstId}), Charts to remove: ${existingChartIds.length}`);

  // 1. Reset requests
  console.log("2. Sending reset batchUpdate...");
  const resetReqs = createOperationalDashboardResetRequests(firstId, existingChartIds);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: resetReqs },
  });

  // 2. Clear values
  console.log("3. Clearing old values...");
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: "'01_DASHBOARD'!A1:Z50",
  });

  // 3. Write new values
  console.log("4. Writing new values & formulas...");
  const { valuesDashboard, valuesHelper, tab2Headers, tab3Headers, tab4Headers } =
    getOperationalDashboardValues("SPPG Patila");

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        { range: "'01_DASHBOARD'!A1:K28", values: valuesDashboard },
        { range: "'01_DASHBOARD'!M1:M4", values: valuesHelper },
      ],
    },
  });

  // 4. Apply styling, merges, dropdowns, and add Pie Chart
  console.log("5. Applying styling, merges, and Pie Chart...");
  const chartReq = createOperationalDashboardChartRequest(firstId);
  const stylingReqs = [
    ...createOperationalDashboardStylingRequests(firstId),
    chartReq,
  ];

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: stylingReqs },
  });

  console.log("SPPG Patila dashboard successfully rebuilt with Pie Chart!");
}

main().catch(console.error);
