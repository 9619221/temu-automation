import assert from "assert";
import {
  buildFeishuText,
  createFeishuSign,
  redactWebhook,
  sendFeishuText,
} from "../services/feishuBot.js";

async function main() {
  const sign = createFeishuSign("1700000000", "secret");
  assert.strictEqual(typeof sign, "string");
  assert.ok(sign.length > 20);

  const redacted = redactWebhook("https://open.feishu.cn/open-apis/bot/v2/hook/abcdef123456");
  assert.ok(redacted.includes("123456"));
  assert.ok(!redacted.includes("abcdef123456"));

  const text = buildFeishuText({
    title: "Title",
    text: "Body",
    fields: { status: "ok", empty: "" },
  });
  assert.strictEqual(text, "Title\nBody\nstatus: ok");

  let request = null;
  const result = await sendFeishuText(
    { title: "Ping", text: "Pong" },
    {
      webhook: "https://example.test/hook",
      secret: "secret",
      fetch: async (url, options) => {
        request = { url, options, body: JSON.parse(options.body) };
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ code: 0, msg: "success" }),
        };
      },
    },
  );

  assert.strictEqual(result.ok, true);
  assert.strictEqual(request.url, "https://example.test/hook");
  assert.strictEqual(request.body.msg_type, "text");
  assert.strictEqual(request.body.content.text, "Ping\nPong");
  assert.ok(request.body.timestamp);
  assert.ok(request.body.sign);

  console.log("Feishu bot tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
