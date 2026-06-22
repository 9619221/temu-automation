import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Select, InputNumber, Button, Space, message, Typography, Divider, Alert } from "antd";
import { PrinterOutlined, SettingOutlined } from "@ant-design/icons";
import JsBarcode from "jsbarcode";
import { jsPDF } from "jspdf";
import { TEMPLATES, TEMPLATE_CATEGORIES, getTemplatesByCategory } from "./label-templates/templateDefs";
import type { LabelTemplate } from "./label-templates/templateDefs";
import { fetchComplianceProperties } from "../utils/cloudClient";

const { Text } = Typography;

let notoFontBase64: string | null = null;
async function loadNotoFont(): Promise<string | null> {
  if (notoFontBase64) return notoFontBase64;
  try {
    const resp = await fetch("/fonts/NotoSansSC-Bold.ttf");
    const buf = await resp.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    notoFontBase64 = btoa(binary);
    return notoFontBase64;
  } catch { return null; }
}

let notoCanvasFontLoaded = false;
async function ensureNotoCanvasFont(): Promise<boolean> {
  if (notoCanvasFontLoaded) return true;
  try {
    const face = new FontFace("NotoSansSC", "url(/fonts/NotoSansSC-Bold.ttf)");
    await face.load();
    document.fonts.add(face);
    notoCanvasFontLoaded = true;
    return true;
  } catch { return false; }
}

const SETTINGS_KEY = "temu.barcode-label.settings";
const COMPLIANCE_KEY = "temu.barcode-label.compliance";

const ORIGIN_OPTIONS = [
  { label: "Made In China", value: "Made In China" },
  { label: "Hecho en China", value: "Hecho en China" },
];

interface ComplianceData {
  manufacturer: string;
  manufacturerAddress: string;
  manufacturerEmail: string;
  ecRepName: string;
  ecRepAddress: string;
  ecRepEmail: string;
  turRepName: string;
  turRepAddress: string;
}

interface BarcodeLabelModalProps {
  open: boolean;
  rows: Array<{
    rawCloud?: {
      sku_ext_code?: string | null;
      spec_name?: string | null;
      product_name?: string | null;
      mall_id?: string | null;
      skc_id?: string | null;
      label_codes?: string | null;
    } | null;
  }>;
  onClose: () => void;
}

function loadJson<T>(key: string, fallback: T): T {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback; } catch { return fallback; }
}
function saveJson(key: string, val: unknown) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

const DEFAULT_COMPLIANCE: ComplianceData = {
  manufacturer: "",
  manufacturerAddress: "",
  manufacturerEmail: "",
  ecRepName: "",
  ecRepAddress: "",
  ecRepEmail: "",
  turRepName: "",
  turRepAddress: "",
};

function generateBarcodeDataUrl(code: string, barWidth = 2, barHeight = 80): string {
  const canvas = document.createElement("canvas");
  try {
    JsBarcode(canvas, code, { format: "CODE128", lineColor: "#000", width: barWidth, height: barHeight, displayValue: false, margin: 0 });
    return canvas.toDataURL("image/png");
  } catch { return ""; }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.crossOrigin = "anonymous";
    img.src = src;
  });
}

async function renderPreviewDataUrl(
  template: LabelTemplate,
  code: string,
  skuExtCode: string,
  specName: string,
  originText: string,
  compliance: ComplianceData
): Promise<string> {
  const pw = template.width;
  const ph = template.height;
  const CANVAS_W = 500;
  const mmToPx = CANVAS_W / pw;
  const CANVAS_H = Math.round(ph * mmToPx);

  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const ptToPx = (pt: number) => pt * 0.3528 * mmToPx;

  if (template.id === "tm") {
    await ensureNotoCanvasFont();
    const fontFamily = notoCanvasFontLoaded ? "NotoSansSC, sans-serif" : "sans-serif";

    ctx.strokeStyle = "#000";
    ctx.lineWidth = 0.3 * mmToPx;
    ctx.strokeRect(0.5 * mmToPx, 0.5 * mmToPx, (pw - 1) * mmToPx, (ph - 1) * mmToPx);

    ctx.fillStyle = "#000";
    ctx.textBaseline = "alphabetic";

    ctx.font = `bold ${ptToPx(7)}px ${fontFamily}`;
    ctx.textAlign = "left";
    ctx.fillText(skuExtCode || code, 2 * mmToPx, 3.5 * mmToPx);
    if (specName) {
      const spec = specName.length > 15 ? specName.substring(0, 15) : specName;
      ctx.textAlign = "right";
      ctx.fillText(spec, (pw - 2) * mmToPx, 3.5 * mmToPx);
    }

    const barcodeCanvas = document.createElement("canvas");
    try {
      JsBarcode(barcodeCanvas, code || "SAMPLE123", {
        format: "CODE128", lineColor: "#000", width: 2, height: 80,
        displayValue: false, margin: 0,
      });
      const bX = 4 * mmToPx;
      const bY = 5 * mmToPx;
      const bW = (pw - 8) * mmToPx;
      const bH = 11.5 * mmToPx;
      ctx.drawImage(barcodeCanvas, bX, bY, bW, bH);
    } catch {}

    ctx.font = `bold ${ptToPx(7)}px ${fontFamily}`;
    ctx.textAlign = "left";
    ctx.fillText(code, 2 * mmToPx, 18.5 * mmToPx);
    ctx.textAlign = "right";
    ctx.fillText(originText, (pw - 2) * mmToPx, 18.5 * mmToPx);
  } else {
    if (template.bgImage) {
      try {
        const img = await loadImage(`/label-templates/${template.bgImage}`);
        ctx.drawImage(img, 0, 0, CANVAS_W, CANVAS_H);
      } catch {}
    }

    const fieldValues: Record<string, string> = {
      manufacturer: compliance.manufacturer,
      manufacturerAddress: compliance.manufacturerAddress,
      manufacturerEmail: compliance.manufacturerEmail,
      ecRepName: compliance.ecRepName,
      ecRepAddress: compliance.ecRepAddress,
      ecRepEmail: compliance.ecRepEmail,
      turRepName: compliance.turRepName,
      turRepAddress: compliance.turRepAddress,
      batchNumber: code,
    };

    ctx.fillStyle = "#000";
    ctx.textBaseline = "alphabetic";
    for (const field of template.fields) {
      const val = fieldValues[field.key] || "";
      if (!val) continue;
      ctx.font = `${ptToPx(field.fontSize)}px sans-serif`;
      ctx.textAlign = (field.align || "left") as CanvasTextAlign;
      ctx.fillText(val, field.x * mmToPx, field.y * mmToPx, field.maxWidth * mmToPx);
    }
  }

  return canvas.toDataURL("image/png");
}

async function loadBgImage(filename: string): Promise<string> {
  const resp = await fetch(`/label-templates/${filename}`);
  const blob = await resp.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function drawBarcodeTemplate(
  doc: jsPDF, code: string, skuExtCode: string, specName: string, originText: string, pageW: number, pageH: number, fontName: string
) {
  doc.setDrawColor(0);
  doc.setLineWidth(0.3);
  doc.rect(0.5, 0.5, pageW - 1, pageH - 1);

  doc.setFont(fontName, "bold");
  doc.setFontSize(7);
  doc.text(skuExtCode || code, 2, 3.5);
  if (specName) {
    const spec = specName.length > 15 ? specName.substring(0, 15) : specName;
    doc.text(spec, pageW - 2, 3.5, { align: "right" });
  }

  const barcodeDataUrl = generateBarcodeDataUrl(code, 2, 80);
  if (barcodeDataUrl) {
    doc.addImage(barcodeDataUrl, "PNG", 4, 5, pageW - 8, 11.5);
  }

  doc.setFontSize(7);
  doc.text(code, 2, 18.5);
  doc.text(originText, pageW - 2, 18.5, { align: "right" });
  doc.setFont(fontName, "normal");
}

interface RowData {
  skuCode: string;
  skcId: string;
  specName: string;
  labelCode: string;
}

async function buildPdf(
  templates: LabelTemplate[],
  rowItems: RowData[],
  originText: string,
  compliance: ComplianceData,
  copies: number
): Promise<jsPDF> {
  const first = templates[0];
  const firstOri = first.width > first.height ? "landscape" : "portrait";
  const firstFmt: [number, number] = [Math.min(first.width, first.height), Math.max(first.width, first.height)];
  const doc = new jsPDF({ orientation: firstOri, unit: "mm", format: firstFmt, hotfixes: ["px_scaling"] });

  const fontData = await loadNotoFont();
  if (fontData) {
    doc.addFileToVFS("NotoSansSC-Bold.ttf", fontData);
    doc.addFont("NotoSansSC-Bold.ttf", "NotoSansSC", "bold");
  }

  const bgCache = new Map<string, string>();
  for (const tpl of templates) {
    if (tpl.bgImage && tpl.id !== "tm" && !bgCache.has(tpl.bgImage)) {
      try { bgCache.set(tpl.bgImage, await loadBgImage(tpl.bgImage)); } catch {}
    }
  }

  let pageIdx = 0;
  for (const item of rowItems) {
    for (const tpl of templates) {
      const pw = tpl.width, ph = tpl.height;
      const ori = pw > ph ? "landscape" : "portrait";
      const fmt: [number, number] = [Math.min(pw, ph), Math.max(pw, ph)];

      for (let c = 0; c < copies; c++) {
        if (pageIdx > 0) doc.addPage(fmt, ori);
        pageIdx++;

        if (tpl.id === "tm") {
          drawBarcodeTemplate(doc, item.labelCode || item.skuCode, item.skuCode, item.specName, originText, pw, ph, fontData ? "NotoSansSC" : "helvetica");
        } else {
          const bgUrl = tpl.bgImage ? bgCache.get(tpl.bgImage) : undefined;
          if (bgUrl) {
            const ext = tpl.bgImage!.endsWith(".jpg") ? "JPEG" : "PNG";
            doc.addImage(bgUrl, ext, 0, 0, pw, ph);
          }
          if (fontData) doc.setFont("NotoSansSC", "bold");
          const fieldValues: Record<string, string> = {
            manufacturer: compliance.manufacturer,
            manufacturerAddress: compliance.manufacturerAddress,
            manufacturerEmail: compliance.manufacturerEmail,
            ecRepName: compliance.ecRepName,
            ecRepAddress: compliance.ecRepAddress,
            ecRepEmail: compliance.ecRepEmail,
            turRepName: compliance.turRepName,
            turRepAddress: compliance.turRepAddress,
            batchNumber: item.skuCode,
          };
          for (const field of tpl.fields) {
            const val = fieldValues[field.key] || "";
            if (!val) continue;
            doc.setFontSize(field.fontSize);
            doc.text(val, field.x, field.y, {
              align: field.align || "left",
              maxWidth: field.maxWidth,
            });
          }
          if (fontData) doc.setFont("helvetica", "normal");
        }
      }
    }
  }

  return doc;
}

export default function BarcodeLabelModal({ open, rows, onClose }: BarcodeLabelModalProps) {
  const mallId = rows[0]?.rawCloud?.mall_id || "";
  const skcId = rows[0]?.rawCloud?.skc_id || "";
  const labelCode = rows[0]?.rawCloud?.label_codes || "";
  const complianceCacheKey = mallId ? `${COMPLIANCE_KEY}.${mallId}` : COMPLIANCE_KEY;
  const savedSettings = useMemo(() => (open ? loadJson(SETTINGS_KEY, {} as Record<string, unknown>) : {}), [open]);
  const savedCompliance = useMemo(() => (open ? loadJson(complianceCacheKey, DEFAULT_COMPLIANCE) : DEFAULT_COMPLIANCE), [open, complianceCacheKey]);

  const [templateId, setTemplateId] = useState("tm");
  const [category, setCategory] = useState("条码标签");
  const [printers, setPrinters] = useState<Array<{ name: string; displayName: string; isDefault: boolean }>>([]);
  const [printerName, setPrinterName] = useState("");
  const [originText, setOriginText] = useState("Made In China");
  const [copies, setCopies] = useState(1);
  const [printing, setPrinting] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [compliance, setCompliance] = useState<ComplianceData>(DEFAULT_COMPLIANCE);
  const [extraTemplateIds, setExtraTemplateIds] = useState<string[]>([]);

  const renderSeqRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    const s = savedSettings;
    setTemplateId((s.templateId as string) || "tm");
    setCategory((s.category as string) || "条码标签");
    setOriginText((s.originText as string) || "Made In China");
    setCopies((s.copies as number) || 1);
    setPrinterName((s.printerName as string) || "");
    setExtraTemplateIds((s.extraTemplateIds as string[]) || []);
    setCompliance(savedCompliance);
    window.electronAPI?.app?.getPrinters?.().then((list: Array<{ name: string; displayName: string; isDefault: boolean }>) => {
      setPrinters(list || []);
      if (!s.printerName) {
        const def = (list || []).find((p: { isDefault: boolean }) => p.isDefault);
        if (def) setPrinterName(def.name);
      }
    });

    const hasLocal = savedCompliance.manufacturer || savedCompliance.ecRepName || savedCompliance.turRepName;
    if (!hasLocal) {

      fetchComplianceProperties({ mall_id: mallId || undefined, skc_id: skcId || undefined, limit: 1 })
        .then((cloudRows) => {
          if (!cloudRows.length) return;
          const r = cloudRows[0];
          const fromCloud: ComplianceData = {
            manufacturer: r.manufacturer_name || "",
            manufacturerAddress: r.manufacturer_address || "",
            manufacturerEmail: r.manufacturer_email || "",
            ecRepName: r.ec_rep_name || "",
            ecRepAddress: r.ec_rep_address || "",
            ecRepEmail: r.ec_rep_email || "",
            turRepName: r.tur_rep_name || "",
            turRepAddress: r.tur_rep_address || "",
          };
          if (fromCloud.manufacturer || fromCloud.ecRepName || fromCloud.turRepName) {
            setCompliance(fromCloud);
            saveJson(complianceCacheKey, fromCloud);
          }
        })
        .catch(() => {});
    }
  }, [open, savedSettings, savedCompliance, mallId, skcId, complianceCacheKey]);

  const skuCode = rows[0]?.rawCloud?.sku_ext_code || "";
  const specName = rows[0]?.rawCloud?.spec_name || "";
  const template = useMemo(() => TEMPLATES.find((t) => t.id === templateId) || TEMPLATES[0], [templateId]);
  const categoryTemplates = useMemo(() => getTemplatesByCategory(category), [category]);
  const hasCode = !!skuCode;
  useEffect(() => {
    if (!open) { setPreviewUrl(""); return; }
    const seq = ++renderSeqRef.current;
    const code = labelCode || skuCode || "SAMPLE123";
    renderPreviewDataUrl(template, code, skuCode, specName, originText, compliance)
      .then((url) => { if (renderSeqRef.current === seq) setPreviewUrl(url); })
      .catch(() => { if (renderSeqRef.current === seq) setPreviewUrl(""); });
  }, [open, template, skuCode, labelCode, specName, originText, compliance]);

  const doPrint = useCallback(async (silent: boolean) => {
    const rowItems: RowData[] = rows
      .map((r) => ({
        skuCode: r.rawCloud?.sku_ext_code || "",
        skcId: r.rawCloud?.skc_id || "",
        specName: r.rawCloud?.spec_name || "",
        labelCode: r.rawCloud?.label_codes || "",
      }))
      .filter((r) => template.id !== "tm" || (r.labelCode || r.skuCode));

    if (template.id === "tm" && rowItems.length === 0) {
      message.warning("选中行没有 SKU 编码，无法打印条码");
      return;
    }
    if (silent && !printerName) { message.warning("请先选择打印机"); return; }
    setPrinting(true);
    const hide = message.loading(`打印 ${rowItems.length} 个商品 × ${copies} 份...`, 0);
    try {
      saveJson(SETTINGS_KEY, { templateId, category, printerName, originText, copies, extraTemplateIds });
      saveJson(complianceCacheKey, compliance);

      const allTemplates = [template, ...extraTemplateIds.map((id) => TEMPLATES.find((t) => t.id === id)).filter(Boolean) as LabelTemplate[]];
      const doc = await buildPdf(allTemplates, rowItems, originText, compliance, copies);
      const arrayBuf = doc.output("arraybuffer");
      const bytes = new Uint8Array(arrayBuf);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);

      await window.electronAPI?.app?.printPdfSilent?.({
        base64,
        printerName: silent ? printerName : undefined,
        copies: 1,
      });
      const totalPages = rowItems.length * (1 + extraTemplateIds.length) * copies;
      message.success(`已发送 ${totalPages} 页标签到打印机（${rowItems.length} 商品 × ${1 + extraTemplateIds.length} 模板 × ${copies} 份）`);
    } catch (e: unknown) {
      message.error((e as Error)?.message || "打印失败");
    } finally {
      hide();
      setPrinting(false);
    }
  }, [template, rows, printerName, copies, originText, compliance, templateId, category, complianceCacheKey, extraTemplateIds]);

  return (
    <Modal
      title="条码标签打印"
      open={open}
      onCancel={onClose}
      width={880}
      destroyOnClose
      footer={
        <Space>
          <Button onClick={onClose}>关闭</Button>
          <Button icon={<SettingOutlined />} onClick={() => doPrint(false)} disabled={printing}>
            高级打印
          </Button>
          <Button type="primary" icon={<PrinterOutlined />} loading={printing} onClick={() => doPrint(true)}>
            打印
          </Button>
        </Space>
      }
    >
      {template.id === "tm" && !hasCode && (
        <Alert type="warning" message="选中行缺少 SKU 外部编码，无法生成条码" showIcon style={{ marginBottom: 12 }} />
      )}

      <div style={{ display: "flex", gap: 16 }}>
        {/* 左侧配置 */}
        <div style={{ width: 280, flexShrink: 0, maxHeight: 520, overflowY: "auto" }}>
          <Text strong>模板分类</Text>
          <Select
            size="small"
            style={{ width: "100%", marginTop: 4, marginBottom: 8 }}
            value={category}
            onChange={(v) => {
              setCategory(v);
              const first = getTemplatesByCategory(v)[0];
              if (first) setTemplateId(first.id);
            }}
            options={TEMPLATE_CATEGORIES.map((c) => ({ label: c, value: c }))}
          />

          <Text strong>模板</Text>
          <Select
            size="small"
            style={{ width: "100%", marginTop: 4, marginBottom: 8 }}
            value={templateId}
            onChange={setTemplateId}
            options={categoryTemplates.map((t) => ({
              label: `${t.name} (${t.width}×${t.height})`,
              value: t.id,
            }))}
          />

          <Divider style={{ margin: "8px 0" }} />
          <Text strong>打印机</Text>
          <Select
            size="small"
            style={{ width: "100%", marginTop: 4, marginBottom: 8 }}
            value={printerName || undefined}
            onChange={setPrinterName}
            placeholder="选择打印机"
            options={printers.map((p) => ({
              label: p.displayName + (p.isDefault ? " (默认)" : ""),
              value: p.name,
            }))}
          />

          {template.id === "tm" && (
            <>
              <Text strong>产地标识</Text>
              <Select
                size="small"
                style={{ width: "100%", marginTop: 4, marginBottom: 8 }}
                value={originText}
                onChange={setOriginText}
                options={ORIGIN_OPTIONS}
              />
            </>
          )}

          <Text strong>打印份数</Text>
          <InputNumber
            size="small"
            min={1}
            max={100}
            value={copies}
            onChange={(v) => setCopies(v || 1)}
            style={{ width: "100%", marginTop: 4, marginBottom: 8 }}
          />

          <Divider style={{ margin: "8px 0" }} />
          <Text strong>附加标签</Text>
          <div style={{ marginTop: 4, marginBottom: 8 }}>
            <Select
              mode="multiple"
              size="small"
              style={{ width: "100%" }}
              value={extraTemplateIds}
              onChange={setExtraTemplateIds}
              placeholder="每个商品额外附加的标签"
              maxTagCount={2}
              options={TEMPLATES.filter((t) => t.id !== templateId).map((t) => ({
                label: `${t.name} (${t.width}×${t.height})`,
                value: t.id,
              }))}
            />
          </div>

          <Text type="secondary" style={{ display: "block", marginTop: 8, fontSize: 11 }}>
            {rows.length} 商品 × {1 + extraTemplateIds.length} 模板 × {copies} 份 = {rows.length * (1 + extraTemplateIds.length) * copies} 页
            {skuCode && ` | 预览: ${skuCode}`}
          </Text>
        </div>

        {/* 右侧 PDF 预览 */}
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#f5f5f5",
            borderRadius: 8,
            minHeight: 300,
          }}
        >
          {previewUrl ? (
            <img
              src={previewUrl}
              style={{ maxWidth: "100%", maxHeight: 380, objectFit: "contain", borderRadius: 4, background: "#fff" }}
              alt="label-preview"
            />
          ) : (
            <Text type="secondary">加载预览中...</Text>
          )}
        </div>
      </div>
    </Modal>
  );
}
