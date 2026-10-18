import { ReplitConnectors } from "@replit/connectors-sdk";
import { InventoryError } from "./inventory-error.js";

type JsonRecord = Record<string, unknown>;

export type RetellCallResult = {
  approval:
    | "calling"
    | "confirmed"
    | "rejected"
    | "support"
    | "unanswered"
    | "failed";
  status: string;
  error: string | null;
};

const RETELL_CONNECTOR = "retell-ai";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_NUMBER_PAGES = 100;
const DEDICATED_AGENT_NAME = "StockSense Delivery Receipt Approval";

const FLOW_NODE_IDS = {
  start: "delivery_receipt_welcome",
  confirmed: "delivery_receipt_confirmed",
  rejected: "delivery_receipt_rejected",
  support: "delivery_receipt_support",
  unanswered: "delivery_receipt_unanswered",
} as const;

const WELCOME_TEXT =
  "Hello {{customer_name}}. I am calling about delivery reference {{reference}}. Please use your phone keypad: press 1 to confirm receipt, 2 to reject receipt, or 3 to request support. Please press one key now.";

const EDGE_PROMPTS = {
  confirmed: "The caller pressed the 1 key on the phone keypad.",
  rejected: "The caller pressed the 2 key on the phone keypad.",
  support: "The caller pressed the 3 key on the phone keypad.",
} as const;

const END_TEXT = {
  confirmed: "Thank you. Your keypad response will be verified before the delivery status is updated.",
  rejected: "Thank you. Your keypad response will be verified before the delivery status is updated.",
  support: "Thank you. Your keypad response will be verified before the delivery status is updated.",
  unanswered:
    "I could not confirm a supported keypad response. The delivery will remain awaiting confirmation.",
} as const;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeError(message: string, status = 502): InventoryError {
  return new InventoryError(message, status);
}

function authenticationError(): InventoryError {
  return safeError(
    "Retell authentication failed. Update the existing Retell integration in Replit, then try again.",
    503,
  );
}

function isInvalidApiKey(message: string): boolean {
  return /invalid api[\s_-]*key|api[\s_-]*key is missing or invalid/i.test(
    message,
  );
}

function validateE164(value: string, field: string): void {
  if (!/^\+[1-9]\d{7,14}$/.test(value)) {
    throw new InventoryError(`${field} must be a valid E.164 phone number.`);
  }
}

function requireNonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new InventoryError(`${field} is required.`);
  }
  return normalized;
}

async function retellRequest(
  path: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<unknown> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    // Recreate the connector SDK client for every request so connector
    // credentials are always resolved fresh and remain inside the proxy.
    const connectors = new ReplitConnectors();
    const response = await Promise.race([
      connectors.proxy(RETELL_CONNECTOR, path, init),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Retell request timed out")),
          REQUEST_TIMEOUT_MS,
        );
      }),
    ]);

    let responseBody: unknown;
    try {
      responseBody = await response.json();
    } catch {
      responseBody = null;
    }

    if (!response.ok) {
      const providerMessage =
        isRecord(responseBody) && typeof responseBody.message === "string"
          ? responseBody.message
          : "";
      if (isInvalidApiKey(providerMessage)) {
        throw authenticationError();
      }
      throw safeError(
        `Retell could not complete the request (HTTP ${response.status}). Check the Retell integration and try again.`,
        502,
      );
    }
    return responseBody;
  } catch (error) {
    if (error instanceof InventoryError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : "";
    if (isInvalidApiKey(message)) {
      throw authenticationError();
    }
    if (message === "Retell request timed out") {
      if (path === "/v2/create-phone-call") {
        throw safeError(
          "Retell did not confirm whether the delivery call was created. Check Retell call history before trying again to avoid a duplicate call.",
          504,
        );
      }
      throw safeError(
        "Retell did not respond before the request timed out. Check the integration and try again.",
        504,
      );
    }
    throw safeError(
      "Retell could not be reached. Check the existing Retell integration and try again.",
      502,
    );
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function e164NumbersFromPage(payload: unknown): string[] {
  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    throw safeError("Retell returned an invalid phone-number list.");
  }
  const numbers: string[] = [];
  for (const item of payload.items) {
    if (
      !isRecord(item) ||
      typeof item.phone_number !== "string" ||
      !/^\+[1-9]\d{7,14}$/.test(item.phone_number)
    ) {
      throw safeError("Retell returned an invalid phone-number record.");
    }
    numbers.push(item.phone_number);
  }
  return numbers;
}

function createDeliveryFlow(): JsonRecord {
  return {
    model_choice: { model: "gpt-4.1", type: "cascading" },
    start_speaker: "agent",
    start_node_id: FLOW_NODE_IDS.start,
    global_prompt:
      "This is a short delivery-receipt keypad flow. Do not infer, record, or claim a keypad choice unless the caller presses one of the requested phone keypad digits. Do not accept a spoken answer as a keypad response. Ask only for one keypad digit, then end the call.",
    nodes: [
      {
        id: FLOW_NODE_IDS.start,
        type: "conversation",
        instruction: { type: "static_text", text: WELCOME_TEXT },
        reminder_max_count: 0,
        edges: [
          {
            id: "digit_1",
            transition_condition: {
              type: "prompt",
              prompt: EDGE_PROMPTS.confirmed,
            },
            destination_node_id: FLOW_NODE_IDS.confirmed,
          },
          {
            id: "digit_2",
            transition_condition: {
              type: "prompt",
              prompt: EDGE_PROMPTS.rejected,
            },
            destination_node_id: FLOW_NODE_IDS.rejected,
          },
          {
            id: "digit_3",
            transition_condition: {
              type: "prompt",
              prompt: EDGE_PROMPTS.support,
            },
            destination_node_id: FLOW_NODE_IDS.support,
          },
        ],
        else_edge: {
          id: "unsupported_input",
          transition_condition: { type: "prompt", prompt: "Else" },
          destination_node_id: FLOW_NODE_IDS.unanswered,
        },
      },
      ...(["confirmed", "rejected", "support", "unanswered"] as const).map(
        (outcome) => ({
          id: FLOW_NODE_IDS[outcome],
          type: "end",
          speak_during_execution: true,
          instruction: { type: "static_text", text: END_TEXT[outcome] },
        }),
      ),
    ],
  };
}

function hasExactDedicatedFlow(payload: unknown, flowId: string): boolean {
  if (
    !isRecord(payload) ||
    payload.conversation_flow_id !== flowId ||
    !Array.isArray(payload.nodes) ||
    payload.nodes.length !== 5
  ) {
    return false;
  }
  const nodes = payload.nodes.filter(isRecord);
  if (nodes.length !== 5) return false;
  const start = nodes.find((node) => node.id === FLOW_NODE_IDS.start);
  if (
    !start ||
    start.type !== "conversation" ||
    !isRecord(start.instruction) ||
    start.instruction.type !== "static_text" ||
    start.instruction.text !== WELCOME_TEXT ||
    !Array.isArray(start.edges) ||
    start.edges.length !== 3 ||
    !isRecord(start.else_edge) ||
    !isRecord(start.else_edge.transition_condition) ||
    start.else_edge.transition_condition.type !== "prompt" ||
    start.else_edge.transition_condition.prompt !== "Else" ||
    start.else_edge.destination_node_id !== FLOW_NODE_IDS.unanswered
  ) {
    return false;
  }

  const expectedEdges = [
    { id: "digit_1", prompt: EDGE_PROMPTS.confirmed, nodeId: FLOW_NODE_IDS.confirmed },
    { id: "digit_2", prompt: EDGE_PROMPTS.rejected, nodeId: FLOW_NODE_IDS.rejected },
    { id: "digit_3", prompt: EDGE_PROMPTS.support, nodeId: FLOW_NODE_IDS.support },
  ];
  for (const expected of expectedEdges) {
    const edge = start.edges.find(
      (candidate: unknown) =>
        isRecord(candidate) && candidate.id === expected.id,
    );
    if (
      !isRecord(edge) ||
      edge.destination_node_id !== expected.nodeId ||
      !isRecord(edge.transition_condition) ||
      edge.transition_condition.type !== "prompt" ||
      edge.transition_condition.prompt !== expected.prompt
    ) {
      return false;
    }
  }

  for (const outcome of ["confirmed", "rejected", "support", "unanswered"] as const) {
    const end = nodes.find((node) => node.id === FLOW_NODE_IDS[outcome]);
    if (
      !end ||
      end.type !== "end" ||
      !isRecord(end.instruction) ||
      end.instruction.type !== "static_text" ||
      end.instruction.text !== END_TEXT[outcome]
    ) {
      return false;
    }
  }
  return true;
}

async function assertDedicatedAgent(agentId: string): Promise<void> {
  const agentPayload = await retellRequest(
    `/get-agent/${encodeURIComponent(agentId)}`,
  );
  if (
    !isRecord(agentPayload) ||
    agentPayload.agent_id !== agentId ||
    agentPayload.agent_name !== DEDICATED_AGENT_NAME ||
    !isRecord(agentPayload.response_engine) ||
    agentPayload.response_engine.type !== "conversation-flow" ||
    typeof agentPayload.response_engine.conversation_flow_id !== "string"
  ) {
    throw new InventoryError(
      "The configured Retell agent is not the dedicated delivery approval agent. Run delivery voice setup again.",
      409,
    );
  }

  const flowId = agentPayload.response_engine.conversation_flow_id;
  const flowPayload = await retellRequest(
    `/get-conversation-flow/${encodeURIComponent(flowId)}`,
  );
  if (!hasExactDedicatedFlow(flowPayload, flowId)) {
    throw new InventoryError(
      "The configured Retell agent does not use the dedicated delivery keypad flow. Run delivery voice setup again.",
      409,
    );
  }
}

function setupId(payload: unknown, field: string): string {
  if (!isRecord(payload) || typeof payload[field] !== "string" || !payload[field]) {
    throw safeError(`Retell did not return the required ${field}.`);
  }
  return payload[field];
}

export async function listRetellNumbers(): Promise<string[]> {
  const numbers: string[] = [];
  let paginationKey: string | undefined;

  for (let page = 0; page < MAX_NUMBER_PAGES; page += 1) {
    const query = new URLSearchParams({ limit: "1000" });
    if (paginationKey) query.set("pagination_key", paginationKey);
    const payload = await retellRequest(
      `/v2/list-phone-numbers?${query.toString()}`,
    );
    if (!isRecord(payload) || typeof payload.has_more !== "boolean") {
      throw safeError("Retell returned an invalid phone-number page.");
    }
    numbers.push(...e164NumbersFromPage(payload));

    if (!payload.has_more) return numbers;
    if (
      typeof payload.pagination_key !== "string" ||
      !payload.pagination_key ||
      payload.pagination_key === paginationKey
    ) {
      throw safeError("Retell returned an invalid phone-number pagination key.");
    }
    paginationKey = payload.pagination_key;
  }

  throw safeError("Retell phone-number listing exceeded the safe page limit.");
}

export async function setupRetellDeliveryAgent(): Promise<{
  agentId: string;
  flowId: string;
}> {
  const voices = await retellRequest("/list-voices");
  if (!Array.isArray(voices)) {
    throw safeError("Retell returned an invalid voice list.");
  }
  const voiceId = voices.find(
    (voice) => isRecord(voice) && typeof voice.voice_id === "string" && voice.voice_id,
  );
  if (!isRecord(voiceId) || typeof voiceId.voice_id !== "string") {
    throw safeError(
      "Retell has no available voice for the delivery approval agent.",
    );
  }

  const flowPayload = await retellRequest("/create-conversation-flow", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(createDeliveryFlow()),
  });
  const flowId = setupId(flowPayload, "conversation_flow_id");

  const agentPayload = await retellRequest("/create-agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agent_name: DEDICATED_AGENT_NAME,
      version_description:
        "Dedicated delivery receipt keypad confirmation agent.",
      response_engine: {
        type: "conversation-flow",
        conversation_flow_id: flowId,
      },
      voice_id: voiceId.voice_id,
      reminder_max_count: 0,
      allow_user_dtmf: true,
      user_dtmf_options: {
        digit_limit: 1,
        timeout_ms: 5000,
      },
      max_call_duration_ms: 90_000,
      end_call_after_silence_ms: 15_000,
      voicemail_option: {
        action: { type: "hangup" },
      },
    }),
  });
  const agentId = setupId(agentPayload, "agent_id");
  if (!isRecord(agentPayload) || typeof agentPayload.version !== "number") {
    throw safeError("Retell did not return the new delivery agent version.");
  }

  // Publish only the newly created dedicated agent. No phone-number binding or
  // existing Retell resource is modified by this setup operation.
  await retellRequest(
    `/publish-agent-version/${encodeURIComponent(agentId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: agentPayload.version }),
    },
  );

  return { agentId, flowId };
}

export async function createRetellDeliveryCall(input: {
  fromNumber: string;
  toNumber: string;
  agentId: string;
  operationId: number;
  customerName: string;
  reference: string;
}): Promise<{ callId: string; status: string }> {
  const fromNumber = requireNonEmpty(input.fromNumber, "fromNumber");
  const toNumber = requireNonEmpty(input.toNumber, "toNumber");
  const agentId = requireNonEmpty(input.agentId, "agentId");
  const customerName = requireNonEmpty(input.customerName, "customerName");
  const reference = requireNonEmpty(input.reference, "reference");
  validateE164(fromNumber, "fromNumber");
  validateE164(toNumber, "toNumber");
  if (!Number.isSafeInteger(input.operationId) || input.operationId < 1) {
    throw new InventoryError("operationId must be a positive safe integer.");
  }

  await assertDedicatedAgent(agentId);

  // This is a billable, state-changing request: deliberately make exactly one
  // attempt and never automatically retry to avoid duplicate outbound calls.
  const callPayload = await retellRequest("/v2/create-phone-call", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      from_number: fromNumber,
      to_number: toNumber,
      override_agent_id: agentId,
      metadata: { operationId: input.operationId },
      retell_llm_dynamic_variables: {
        customer_name: customerName,
        reference,
      },
    }),
  });
  const callId = setupId(callPayload, "call_id");
  if (
    !isRecord(callPayload) ||
    typeof callPayload.call_status !== "string" ||
    callPayload.agent_id !== agentId ||
    callPayload.to_number !== toNumber ||
    callPayload.direction !== "outbound" ||
    !isRecord(callPayload.metadata) ||
    callPayload.metadata.operationId !== input.operationId
  ) {
    throw new InventoryError(
      "Retell returned call details that do not match this delivery. The delivery remains awaiting confirmation.",
      502,
    );
  }
  return { callId, status: callPayload.call_status };
}

function failedResult(status: string, error: string): RetellCallResult {
  return { approval: "failed", status, error };
}

function parseRetellDeliveryCallResult(
  payload: unknown,
  expected: {
    callId: string;
    operationId: number;
    toNumber: string;
    agentId: string;
  },
): RetellCallResult {
  if (
    !isRecord(payload) ||
    payload.call_id !== expected.callId ||
    payload.agent_id !== expected.agentId ||
    payload.call_type !== "phone_call" ||
    payload.direction !== "outbound" ||
    payload.to_number !== expected.toNumber ||
    !isRecord(payload.metadata) ||
    payload.metadata.operationId !== expected.operationId
  ) {
    return failedResult(
      "failed",
      "Retell call details did not match the stored delivery call. No approval was accepted.",
    );
  }

  if (typeof payload.call_status !== "string") {
    return failedResult(
      "failed",
      "Retell returned an invalid call status. No approval was accepted.",
    );
  }
  const status = payload.call_status;
  if (status === "registered" || status === "ongoing") {
    return { approval: "calling", status, error: null };
  }
  if (status !== "ended" && status !== "error" && status !== "not_connected") {
    return failedResult(
      status,
      "Retell returned an unknown call status. No approval was accepted.",
    );
  }
  if (status === "error") {
    return failedResult(
      status,
      "The Retell call failed. The delivery remains awaiting confirmation.",
    );
  }

  const disconnectionReason =
    typeof payload.disconnection_reason === "string"
      ? payload.disconnection_reason
      : "";
  if (
    disconnectionReason === "voicemail_reached" ||
    disconnectionReason === "dial_no_answer" ||
    disconnectionReason === "dial_busy" ||
    disconnectionReason === "user_declined" ||
    disconnectionReason === "inactivity"
  ) {
    return {
      approval: "unanswered",
      status,
      error: "No supported keypad response was received. The delivery remains awaiting confirmation.",
    };
  }
  if (disconnectionReason.startsWith("error_") || disconnectionReason === "dial_failed") {
    return failedResult(
      status,
      "The Retell call failed before a delivery response could be confirmed.",
    );
  }
  if (status === "not_connected") {
    return failedResult(
      status,
      "The Retell call did not connect. The delivery remains awaiting confirmation.",
    );
  }

  // This provider-owned call response field contains structured DTMF utterances
  // with role "dtmf" and a single digit. Do not use transcript text,
  // call_analysis, custom analysis, or collected variables as approval evidence.
  const events = Array.isArray(payload.transcript_with_tool_calls)
    ? payload.transcript_with_tool_calls.filter(
        (event) => isRecord(event) && event.role === "dtmf",
      )
    : [];
  if (events.length !== 1 || !isRecord(events[0])) {
    return {
      approval: "unanswered",
      status,
      error: "No single supported keypad response was received. The delivery remains awaiting confirmation.",
    };
  }

  const digit = events[0].digit;
  if (digit === "1") return { approval: "confirmed", status, error: null };
  if (digit === "2") return { approval: "rejected", status, error: null };
  if (digit === "3") return { approval: "support", status, error: null };

  return {
    approval: "unanswered",
    status,
    error: "The keypad response was not supported. The delivery remains awaiting confirmation.",
  };
}

export async function getRetellDeliveryCallResult(input: {
  callId: string;
  operationId: number;
  toNumber: string;
  agentId: string;
}): Promise<RetellCallResult> {
  const callId = requireNonEmpty(input.callId, "callId");
  const toNumber = requireNonEmpty(input.toNumber, "toNumber");
  const agentId = requireNonEmpty(input.agentId, "agentId");
  validateE164(toNumber, "toNumber");
  if (!Number.isSafeInteger(input.operationId) || input.operationId < 1) {
    throw new InventoryError("operationId must be a positive safe integer.");
  }

  const payload = await retellRequest(
    `/v2/get-call/${encodeURIComponent(callId)}`,
  );
  return parseRetellDeliveryCallResult(payload, {
    callId,
    operationId: input.operationId,
    toNumber,
    agentId,
  });
}