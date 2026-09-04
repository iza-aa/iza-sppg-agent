import { env } from "./env.js";

export interface SPPGUnitConfig {
  id: string; // e.g. 'sppg_patila'
  name: string; // e.g. 'SPPG Patila, Luwu Utara'
  token: string;
  spreadsheetId: string;
  driveFolderId: string;
  enabled: boolean;
}

export const SPPG_UNITS: SPPGUnitConfig[] = [
  {
    id: "sppg_patila",
    name: "SPPG Patila, Luwu Utara",
    token: env.TELEGRAM_BOT_TOKEN_PATILA,
    spreadsheetId: env.GOOGLE_SHEET_ID_PATILA,
    driveFolderId: env.GOOGLE_DRIVE_FOLDER_ID,
    enabled: true,
  },
  {
    id: "sppg_unit2",
    name: "SPPG Dapur Unit 2",
    token: env.TELEGRAM_BOT_TOKEN_UNIT2,
    spreadsheetId: env.GOOGLE_SHEET_ID_UNIT2,
    driveFolderId: env.GOOGLE_DRIVE_FOLDER_ID,
    enabled: !!env.TELEGRAM_BOT_TOKEN_UNIT2 && !!env.GOOGLE_SHEET_ID_UNIT2,
  },
  {
    id: "sppg_unit3",
    name: "SPPG Dapur Unit 3",
    token: env.TELEGRAM_BOT_TOKEN_UNIT3,
    spreadsheetId: env.GOOGLE_SHEET_ID_UNIT3,
    driveFolderId: env.GOOGLE_DRIVE_FOLDER_ID,
    enabled: !!env.TELEGRAM_BOT_TOKEN_UNIT3 && !!env.GOOGLE_SHEET_ID_UNIT3,
  },
];

export function getEnabledSppgUnits(): SPPGUnitConfig[] {
  return SPPG_UNITS.filter((unit) => unit.enabled && unit.token.trim().length > 0);
}

export function getSppgUnitById(id: string): SPPGUnitConfig | undefined {
  return SPPG_UNITS.find((unit) => unit.id === id);
}
