type Ticket = {
  id: number;
  ownerId: string;
  message: string;
  resolution: string;
  createdAt: Date;
};
type StoredMessage = {
  id: number;
  senderRole: "customer" | "staff";
  senderId: string | null;
  message: string;
  createdAt: Date | null;
  isLegacy: boolean;
};

/**
 * Keep the original ticket text and its historical one-reply field readable while
 * new owner/staff messages are stored as individual, timestamped rows.
 */
export function buildSupportConversation(ticket: Ticket, stored: StoredMessage[]) {
  const opening = {
    id: 0,
    sender: "customer" as const,
    message: ticket.message,
    createdAt: ticket.createdAt.toISOString(),
  };

  const legacy = stored
    .filter(item => item.isLegacy)
    .sort((left, right) => left.id - right.id)
    .map(item => ({
      id: item.id,
      sender: "staff" as const,
      message: item.message,
      createdAt: null,
    }));

  const hasRecordedResolution = stored.some(item =>
    item.senderRole === "staff" && item.message === ticket.resolution,
  );
  const earlierResolution = ticket.resolution.trim() && !hasRecordedResolution
    ? [{ id: -ticket.id, sender: "staff" as const, message: ticket.resolution, createdAt: null }]
    : [];

  const replies = stored
    .filter(item => !item.isLegacy)
    .sort((left, right) => {
      const byTime = (left.createdAt?.getTime() ?? 0) - (right.createdAt?.getTime() ?? 0);
      return byTime || left.id - right.id;
    })
    .map(item => ({
      id: item.id,
      sender: item.senderRole,
      message: item.message,
      createdAt: item.createdAt?.toISOString() ?? null,
    }));

  return [opening, ...legacy, ...earlierResolution, ...replies];
}