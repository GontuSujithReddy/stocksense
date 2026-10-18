import assert from "node:assert/strict";
import { after, mock, test } from "node:test";
import { rm } from "node:fs/promises";
import { build } from "esbuild";

let proxyHandler;
mock.module("@replit/connectors-sdk", {
  namedExports: {
    ReplitConnectors: class {
      proxy(...args) {
        return proxyHandler(...args);
      }
    },
  },
});

// Bundle the TypeScript module for Node's native test runner. The SDK stays
// external so the tests can safely mock its proxy and never contact Retell.
const bundlePath = new URL("./.delivery-retell.test-bundle.mjs", import.meta.url);
await build({
  entryPoints: [new URL("./delivery-retell.ts", import.meta.url).pathname],
  outfile: bundlePath.pathname,
  bundle: true,
  platform: "node",
  format: "esm",
  external: ["@replit/connectors-sdk"],
});
after(async () => rm(bundlePath, { force: true }));

const {
  createRetellDeliveryCall,
  getRetellDeliveryCallResult,
  listRetellNumbers,
  setupRetellDeliveryAgent,
} = await import(bundlePath.href);

const AGENT_ID = "dedicated-delivery-agent";
const FLOW_ID = "dedicated-delivery-flow";
const CALL_ID = "delivery-call-123";
const OPERATION_ID = 73;
const TO_NUMBER = "+12135550123";

function response(data, status = 200) {
  return new Response(data === null ? null : JSON.stringify(data), { status });
}

function dedicatedFlow() {
  const startText =
    "Hello {{customer_name}}. I am calling about delivery reference {{reference}}. Please use your phone keypad: press 1 to confirm receipt, 2 to reject receipt, or 3 to request support. Please press one key now.";
  const outcomes = {
    confirmed:
      "Thank you. Your keypad response will be verified before the delivery status is updated.",
    rejected:
      "Thank you. Your keypad response will be verified before the delivery status is updated.",
    support:
      "Thank you. Your keypad response will be verified before the delivery status is updated.",
    unanswered:
      "I could not confirm a supported keypad response. The delivery will remain awaiting confirmation.",
  };
  const ids = {
    start: "delivery_receipt_welcome",
    confirmed: "delivery_receipt_confirmed",
    rejected: "delivery_receipt_rejected",
    support: "delivery_receipt_support",
    unanswered: "delivery_receipt_unanswered",
  };
  return {
    conversation_flow_id: FLOW_ID,
    nodes: [
      {
        id: ids.start,
        type: "conversation",
        instruction: { type: "static_text", text: startText },
        edges: [
          {
            id: "digit_1",
            transition_condition: {
              type: "prompt",
              prompt: "The caller pressed the 1 key on the phone keypad.",
            },
            destination_node_id: ids.confirmed,
          },
          {
            id: "digit_2",
            transition_condition: {
              type: "prompt",
              prompt: "The caller pressed the 2 key on the phone keypad.",
            },
            destination_node_id: ids.rejected,
          },
          {
            id: "digit_3",
            transition_condition: {
              type: "prompt",
              prompt: "The caller pressed the 3 key on the phone keypad.",
            },
            destination_node_id: ids.support,
          },
        ],
        else_edge: {
          id: "unsupported_input",
          transition_condition: { type: "prompt", prompt: "Else" },
          destination_node_id: ids.unanswered,
        },
      },
      ...["confirmed", "rejected", "support", "unanswered"].map((result) => ({
        id: ids[result],
        type: "end",
        instruction: { type: "static_text", text: outcomes[result] },
      })),
    ],
  };
}

function callFixture(overrides = {}) {
  return {
    call_type: "phone_call",
    call_id: CALL_ID,
    call_status: "ended",
    agent_id: AGENT_ID,
    direction: "outbound",
    to_number: TO_NUMBER,
    metadata: { operationId: OPERATION_ID },
    transcript_with_tool_calls: [{ role: "dtmf", digit: "1" }],
    ...overrides,
  };
}

function getResult(call = callFixture()) {
  proxyHandler = async (_connector, path) => {
    assert.equal(path, `/v2/get-call/${CALL_ID}`);
    return response(call);
  };
  return getRetellDeliveryCallResult({
    callId: CALL_ID,
    operationId: OPERATION_ID,
    toNumber: TO_NUMBER,
    agentId: AGENT_ID,
  });
}

test("lists E.164 numbers across Retell pagination", async () => {
  let page = 0;
  proxyHandler = async (_connector, path) => {
    page += 1;
    if (page === 1) {
      assert.match(path, /limit=1000/);
      return response({
        items: [{ phone_number: "+14155550101" }],
        has_more: true,
        pagination_key: "next-page",
      });
    }
    assert.match(path, /pagination_key=next-page/);
    return response({
      items: [{ phone_number: "+14155550102" }],
      has_more: false,
    });
  };

  assert.deepEqual(await listRetellNumbers(), [
    "+14155550101",
    "+14155550102",
  ]);
});

test("setup creates and publishes a dedicated flow agent without number bindings", async () => {
  const requests = [];
  proxyHandler = async (_connector, path, init = {}) => {
    requests.push({ path, init });
    if (path === "/list-voices") {
      return response([{ voice_id: "valid-retell-voice", voice_name: "Test" }]);
    }
    if (path === "/create-conversation-flow") {
      const body = JSON.parse(init.body);
      assert.equal(body.model_choice.model, "gpt-4.1");
      assert.equal(body.model_choice.type, "cascading");
      assert.equal(body.start_speaker, "agent");
      assert.equal(body.nodes[0].type, "conversation");
      return response({ conversation_flow_id: FLOW_ID, version: 1 });
    }
    if (path === "/create-agent") {
      const body = JSON.parse(init.body);
      assert.equal(body.agent_name, "StockSense Delivery Receipt Approval");
      assert.equal(body.voice_id, "valid-retell-voice");
      assert.deepEqual(body.response_engine, {
        type: "conversation-flow",
        conversation_flow_id: FLOW_ID,
      });
      assert.equal(body.allow_user_dtmf, true);
      assert.deepEqual(body.user_dtmf_options, {
        digit_limit: 1,
        timeout_ms: 5000,
      });
      assert.equal(body.max_call_duration_ms, 90_000);
      assert.equal(body.end_call_after_silence_ms, 15_000);
      assert.deepEqual(body.voicemail_option, {
        action: { type: "hangup" },
      });
      return response({ agent_id: AGENT_ID, version: 1 });
    }
    if (path === `/publish-agent-version/${AGENT_ID}`) {
      assert.deepEqual(JSON.parse(init.body), { version: 1 });
      return response({});
    }
    assert.fail(`Unexpected Retell request: ${path}`);
  };

  assert.deepEqual(await setupRetellDeliveryAgent(), {
    agentId: AGENT_ID,
    flowId: FLOW_ID,
  });
  assert.equal(requests.some(({ path }) => path.includes("phone-number")), false);
  assert.equal(requests.some(({ path }) => path.includes("update-agent")), false);
});

test("end-node language defers verification and never claims spoken choices were recorded", async () => {
  proxyHandler = async (_connector, path, init = {}) => {
    if (path === "/list-voices") {
      return response([{ voice_id: "valid-retell-voice" }]);
    }
    if (path === "/create-conversation-flow") {
      const body = JSON.parse(init.body);
      for (const node of body.nodes.filter((candidate) => candidate.type === "end")) {
        if (node.id === "delivery_receipt_unanswered") {
          assert.match(node.instruction.text, /remain awaiting confirmation/i);
        } else {
          assert.match(node.instruction.text, /will be verified/i);
          assert.doesNotMatch(node.instruction.text, /recorded|confirmed|rejected/i);
        }
      }
      return response({ conversation_flow_id: FLOW_ID });
    }
    if (path === "/create-agent") return response({ agent_id: AGENT_ID, version: 1 });
    if (path === `/publish-agent-version/${AGENT_ID}`) return response({});
    assert.fail(`Unexpected Retell request: ${path}`);
  };

  await setupRetellDeliveryAgent();
});

test("outbound calls use the dedicated agent override and exact operation metadata", async () => {
  const flow = dedicatedFlow();
  let createBody;
  proxyHandler = async (_connector, path, init = {}) => {
    if (path === `/get-agent/${AGENT_ID}`) {
      return response({
        agent_id: AGENT_ID,
        agent_name: "StockSense Delivery Receipt Approval",
        response_engine: { type: "conversation-flow", conversation_flow_id: FLOW_ID },
      });
    }
    if (path === `/get-conversation-flow/${FLOW_ID}`) return response(flow);
    if (path === "/v2/create-phone-call") {
      createBody = JSON.parse(init.body);
      return response({
        call_id: CALL_ID,
        call_status: "registered",
        agent_id: AGENT_ID,
        to_number: TO_NUMBER,
        direction: "outbound",
        metadata: { operationId: OPERATION_ID },
      });
    }
    assert.fail(`Unexpected Retell request: ${path}`);
  };

  assert.deepEqual(
    await createRetellDeliveryCall({
      fromNumber: "+14155550101",
      toNumber: TO_NUMBER,
      agentId: AGENT_ID,
      operationId: OPERATION_ID,
      customerName: "A Customer",
      reference: "DEL-73",
    }),
    { callId: CALL_ID, status: "registered" },
  );
  assert.equal(createBody.override_agent_id, AGENT_ID);
  assert.deepEqual(createBody.metadata, { operationId: OPERATION_ID });
  assert.deepEqual(createBody.retell_llm_dynamic_variables, {
    customer_name: "A Customer",
    reference: "DEL-73",
  });
});

test("only a structured provider DTMF event on an ended matching call confirms", async () => {
  assert.deepEqual(await getResult(), {
    approval: "confirmed",
    status: "ended",
    error: null,
  });
  assert.deepEqual(
    await getResult(callFixture({ transcript_with_tool_calls: [{ role: "dtmf", digit: "2" }] })),
    { approval: "rejected", status: "ended", error: null },
  );
  assert.deepEqual(
    await getResult(callFixture({ transcript_with_tool_calls: [{ role: "dtmf", digit: "3" }] })),
    { approval: "support", status: "ended", error: null },
  );
});

test("speech transcript, invalid digits, repeated keys and mismatched metadata fail closed", async () => {
  const spokenOnly = await getResult({
    ...callFixture(),
    transcript_with_tool_calls: [{ role: "user", content: "I confirm receipt" }],
    transcript: "User: I confirm receipt",
    call_analysis: { call_successful: true },
  });
  assert.equal(spokenOnly.approval, "unanswered");

  const unsupportedDigit = await getResult(
    callFixture({ transcript_with_tool_calls: [{ role: "dtmf", digit: "9" }] }),
  );
  assert.equal(unsupportedDigit.approval, "unanswered");

  const repeated = await getResult(
    callFixture({
      transcript_with_tool_calls: [
        { role: "dtmf", digit: "1" },
        { role: "dtmf", digit: "2" },
      ],
    }),
  );
  assert.equal(repeated.approval, "unanswered");

  const wrongOperation = await getResult(
    callFixture({ metadata: { operationId: OPERATION_ID + 1 } }),
  );
  assert.equal(wrongOperation.approval, "failed");
  assert.match(wrongOperation.error, /did not match/);
});

test("pending, voicemail and errored calls never approve", async () => {
  assert.deepEqual(
    await getResult(callFixture({ call_status: "ongoing" })),
    { approval: "calling", status: "ongoing", error: null },
  );
  assert.equal(
    (
      await getResult(
        callFixture({
          call_status: "ended",
          disconnection_reason: "voicemail_reached",
          transcript_with_tool_calls: [],
        }),
      )
    ).approval,
    "unanswered",
  );
  assert.equal(
    (
      await getResult(
        callFixture({ call_status: "error", transcript_with_tool_calls: [] }),
      )
    ).approval,
    "failed",
  );
});

test("Retell invalid API-key failures give safe existing-integration guidance", async () => {
  proxyHandler = async () => response({ message: "Invalid API Key" }, 401);
  await assert.rejects(
    listRetellNumbers(),
    (error) =>
      error.name === "InventoryError" &&
      /update the existing Retell integration/i.test(error.message) &&
      !/secret|recording|phone number/i.test(error.message),
  );
});