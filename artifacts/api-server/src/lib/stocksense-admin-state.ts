export type StocksenseAdminRequestStatus = "pending" | "accepted" | "denied";
export type StocksenseAdminAccessStatus = "active" | "inactive" | "terminated";

export function stocksenseAdminAccountStatus(
  requestStatus: StocksenseAdminRequestStatus,
  accessStatus: StocksenseAdminAccessStatus | null,
) {
  if (requestStatus === "pending") return "pending" as const;
  if (requestStatus === "denied") return "denied" as const;
  return accessStatus ?? "inactive";
}

export function stocksenseAdminRole(
  requestStatus: StocksenseAdminRequestStatus,
  accessStatus: StocksenseAdminAccessStatus | null,
): "owner" | null | undefined {
  if (requestStatus === "pending") return null;
  if (requestStatus === "accepted") return accessStatus === "active" ? "owner" : null;
  return undefined;
}

export function stocksenseAdminAccessUnavailableStatus(
  requestStatus: StocksenseAdminRequestStatus,
  accessStatus: StocksenseAdminAccessStatus | null,
): "inactive" | "terminated" | null {
  if (requestStatus !== "accepted") return null;
  if (accessStatus === "terminated") return "terminated";
  return accessStatus === "active" ? null : "inactive";
}

export function stocksenseAdminCanReviewSupportAccess(
  requestStatus: StocksenseAdminRequestStatus,
  accessStatus: StocksenseAdminAccessStatus | null,
) {
  return requestStatus === "accepted" && accessStatus === "active";
}

export function stocksenseAdminAccountCounts(
  accounts: ReadonlyArray<{
    requestStatus: StocksenseAdminRequestStatus;
    accessStatus: StocksenseAdminAccessStatus | null;
  }>,
) {
  return accounts.reduce((counts, account) => {
    if (account.requestStatus === "pending") counts.pending += 1;
    if (account.requestStatus === "denied") counts.denied += 1;
    if (account.accessStatus === "terminated") counts.terminated += 1;
    if (account.requestStatus === "accepted" && account.accessStatus === "active") {
      counts.accepted += 1;
      counts.active += 1;
    }
    if (account.requestStatus === "accepted" && account.accessStatus === "inactive") {
      counts.accepted += 1;
      counts.inactive += 1;
    }
    return counts;
  }, { pending: 0, accepted: 0, denied: 0, active: 0, inactive: 0, terminated: 0 });
}