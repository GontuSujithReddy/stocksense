type ExistingResolution = {
  status: string;
  resolvedByUserId: string | null;
  resolvedByName: string | null;
  resolvedAt: Date | null;
};

export function resolutionAttributionForUpdate(
  ticket: ExistingResolution,
  nextStatus: "open" | "closed",
  staffUserId: string,
  staffName: string,
  closedAt: Date,
) {
  if (nextStatus === "open") {
    return { resolvedByUserId: null, resolvedByName: null, resolvedAt: null };
  }

  if (ticket.status === "closed") {
    return {
      resolvedByUserId: ticket.resolvedByUserId,
      resolvedByName: ticket.resolvedByName,
      resolvedAt: ticket.resolvedAt,
    };
  }

  return {
    resolvedByUserId: staffUserId,
    resolvedByName: staffName,
    resolvedAt: closedAt,
  };
}