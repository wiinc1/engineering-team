import { describe, expect, it } from "vitest";
import {
  buildPmOverviewSections,
  buildRoleInboxItems,
  mapAgentOptions,
  resolveRoleInboxMembership,
} from "../../src/app/task-owner.mjs";

describe("role inbox persisted agent routing", () => {
  it("routes inactive persisted owners from the full roster without unknown-owner fallback", () => {
    const roster = new Map(
      mapAgentOptions([
        {
          agentId: "qa-paused",
          displayName: "Paused QA",
          role: "qa",
          active: false,
          assignable: false,
        },
      ]).map((agent) => [agent.id, agent]),
    );
    const task = {
      task_id: "TSK-PAUSED-QA",
      current_owner: "qa-paused",
      owner: {
        agentId: "qa-paused",
        displayName: "Paused QA",
        role: "qa",
        active: false,
        assignable: false,
      },
    };

    expect(resolveRoleInboxMembership(task, roster)).toMatchObject({
      inboxRole: "qa",
      reason: "matched",
      isFallback: false,
    });

    const rows = buildRoleInboxItems([task], "qa", roster);
    expect(rows).toHaveLength(1);
    expect(rows[0].ownerPresentation.label).toContain("Paused QA");
    expect(rows[0].ownerPresentation.detail).toContain("inactive");

    const sections = buildPmOverviewSections([task], roster);
    const qaSection = sections.find((section) => section.key === "qa");
    expect(qaSection.items).toHaveLength(1);
    expect(qaSection.items[0].pmBucket.routingCue).toBe("QA route");
  });
});
