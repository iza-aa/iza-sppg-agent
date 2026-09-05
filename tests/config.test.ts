import { describe, it, expect } from "vitest";
import { env } from "../src/config/env.js";
import { SPPG_UNITS, getEnabledSppgUnits, getSppgUnitById } from "../src/config/sppg.config.js";

describe("Configuration Loader & SPPG Mapping", () => {
  it("should load environment variables correctly", () => {
    expect(env.TELEGRAM_BOT_TOKEN_PATILA).toBeDefined();
    expect(env.TELEGRAM_BOT_TOKEN_PATILA.length).toBeGreaterThan(10);
    expect(env.GOOGLE_DRIVE_FOLDER_ID).toBe("1T6iFdrOj7_y8XJiQ941KTmDkOfhwfHeR");
    expect(env.GOOGLE_SHEET_ID_PATILA).toBe("1Bjxue57nLpH-nrwXxH2uh-CZoPWTK_JKZ5YMWgwZSbM");
    expect(env.GOOGLE_SHEET_ID_MASTER).toBe("1-YbHkTZQeeZ5KCRKq4GXES9ApqRUNlXhe0zgi_LnEII");
  });

  it("should configure SPPG units accurately", () => {
    expect(SPPG_UNITS.length).toBe(3);
    const patila = getSppgUnitById("sppg_patila");
    expect(patila).toBeDefined();
    expect(patila?.name).toBe("SPPG Patila, Luwu Utara");
    expect(patila?.enabled).toBe(true);

    const enabledUnits = getEnabledSppgUnits();
    expect(enabledUnits.length).toBeGreaterThanOrEqual(1);
    expect(enabledUnits[0].id).toBe("sppg_patila");
  });
});
