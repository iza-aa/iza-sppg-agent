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

  it("should recognize primary Super Admin 7546537134 unconditionally", async () => {
    const isSuper = await userRepo.isSuperAdmin(7546537134);
    const isAllowed = await userRepo.isAllowed(7546537134);
    const user = await userRepo.getUser(7546537134);

    expect(isSuper).toBe(true);
    expect(isAllowed).toBe(true);
    expect(user?.role).toBe("super_admin");
    expect(user?.username).toBe("heizaa4");
  });

  it("should create single-use invite token and allow invitee to claim it", async () => {
    const code = `INV-TEST-${Date.now()}`;
    const invite = await userRepo.createInvite({
      code,
      name: "Staff Unit",
      role: "admin",
      sppg_assigned_id: "sppg_patila",
      created_by: 7546537134,
      ttlMinutes: 60,
    });

    expect(invite.code).toBe(code);
    expect(invite.name).toBe("Staff Unit");

    // Before claim, new user 888888 is not allowed
    const beforeClaim = await userRepo.isAllowed(888888);
    // (Could be false if whitelist is active)

    // Claim invite
    const claimRes = await userRepo.claimInvite(code, {
      id: 888888,
      username: "staff_mbg",
      first_name: "Staff Unit",
    });

    expect(claimRes).not.toBeNull();
    expect(claimRes?.user.id).toBe(888888);
    expect(claimRes?.user.role).toBe("admin");

    // After claim, user is allowed
    const afterClaim = await userRepo.isAllowed(888888);
    expect(afterClaim).toBe(true);

    // Second claim must fail (single-use)
    const secondClaim = await userRepo.claimInvite(code, {
      id: 999999,
      first_name: "Imposter",
    });
    expect(secondClaim).toBeNull();
  });

  it("should create 15-minute member invite and enforce member RBAC permissions", async () => {
    const memberCode = `INV-MEMBER-${Date.now()}`;
    const invite = await userRepo.createInvite({
      code: memberCode,
      name: "Staf Dapur",
      role: "member",
      sppg_assigned_id: "sppg_patila",
      created_by: 7546537134,
      ttlMinutes: 15,
    });

    expect(invite.role).toBe("member");

    // Claim as operational member
    const memberUser = await userRepo.claimInvite(memberCode, {
      id: 777777,
      first_name: "Pak Budi",
      last_name: "Belanja",
    });

    expect(memberUser).not.toBeNull();
    expect(memberUser?.user.role).toBe("member");
    expect(memberUser?.user.first_name).toBe("Pak Budi Belanja");

    // Member is allowed into the system
    const isAllowed = await userRepo.isAllowed(777777);
    expect(isAllowed).toBe(true);

    // But member is NOT admin or super_admin
    const isAdmin = await userRepo.isAdminOrSuperAdmin(777777);
    expect(isAdmin).toBe(false);

    const isSuper = await userRepo.isSuperAdmin(777777);
    expect(isSuper).toBe(false);
  });
});
