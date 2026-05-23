import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import {
  getFeishuConfig,
  isFeishuConfigured,
  redactWebhook,
  sendFeishuText,
} from "../services/feishuBot.js";

const r = Router();

r.get("/v1/feishu/status", authMiddleware, (_req, res) => {
  const cfg = getFeishuConfig();
  res.json({
    configured: isFeishuConfigured(),
    webhook: redactWebhook(cfg.webhook),
    signed: Boolean(cfg.secret),
  });
});

r.post("/v1/feishu/test", authMiddleware, async (req, res, next) => {
  try {
    const result = await sendFeishuText({
      title: req.body?.title || "Temu Automation Feishu connection test",
      text: req.body?.text || "If you can see this message, the Feishu bot webhook is connected.",
      fields: {
        source: "temu-monitor-cloud",
        time: new Date().toISOString(),
      },
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

r.post("/v1/feishu/send", authMiddleware, async (req, res, next) => {
  try {
    const result = await sendFeishuText({
      title: req.body?.title,
      text: req.body?.text,
      fields: req.body?.fields,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default r;
