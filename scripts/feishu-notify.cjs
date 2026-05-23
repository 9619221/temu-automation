#!/usr/bin/env node

async function main() {
  const { sendFeishuText } = await import("../cloud/services/feishuBot.js");
  const [title, ...rest] = process.argv.slice(2);
  const text = rest.join(" ").trim();
  const result = await sendFeishuText({
    title: title || "Temu Automation",
    text: text || "Feishu notification test",
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
