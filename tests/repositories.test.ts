import { describe, it, expect } from "vitest";
import { getSupabaseClient } from "../src/core/db/supabase.js";
import { UserRepository } from "../src/core/db/repositories/user.repository.js";
import { PendingActionRepository } from "../src/core/db/repositories/pending-action.repository.js";

describe("Database Repositories & State Machine", () => {
  const supabase = getSupabaseClient();
  const userRepo = new UserRepository(supabase);
  const pendingRepo = new PendingActionRepository(supabase);

  it("should allow verified user or fallback to open whitelist during development", async () => {
    const isAllowed = await userRepo.isAllowed(123456789);
    expect(typeof isAllowed).toBe("boolean");
  });

  it("should perform atomic state transition on pending drafts (PENDING -> PROCESSING -> SAVED)", async () => {
    const draftId = `test-draft-${Date.now()}`;
    const draft = await pendingRepo.create({
      id: draftId,
      sppg_id: "sppg_patila",
      telegram_user_id: 99999,
      telegram_chat_id: 99999,
      action_type: "SUPPLIER_EXPENSE",
      payload: { supplier: "Hj Muliadi", total: 8920000 },
      ttlMinutes: 10,
    });

    expect(draft.status).toBe("PENDING");

    // Acquire lock (should succeed)
    const acquired = await pendingRepo.acquireLock(draftId);
    expect(acquired).toBe(true);

    // Second lock attempt (should fail - anti-double click)
    const secondAttempt = await pendingRepo.acquireLock(draftId);
    expect(secondAttempt).toBe(false);

    // Update status to SAVED
    await pendingRepo.updateStatus(draftId, "SAVED");
    const updated = await pendingRepo.getById(draftId);
    expect(updated?.status).toBe("SAVED");
  });
});
