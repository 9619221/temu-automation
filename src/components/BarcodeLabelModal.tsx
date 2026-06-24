import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Select, Button, message, Input, Radio, Checkbox } from "antd";
import { PrinterOutlined, SearchOutlined, StarOutlined, StarFilled, CloseOutlined, HeartOutlined, HeartFilled, SettingOutlined, EyeOutlined } from "@ant-design/icons";
import JsBarcode from "jsbarcode";
import { jsPDF } from "jspdf";
import { TEMPLATES, LABEL_TYPES, SIZE_FILTERS, getSizeLabel, filterTemplates } from "./label-templates/templateDefs";
import type { LabelTemplate, LabelType } from "./label-templates/templateDefs";
import { fetchComplianceProperties } from "../utils/cloudClient";

// --- 字体加载 ---

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


// --- 常量 ---

const SETTINGS_KEY = "temu.barcode-label.settings";
const COMPLIANCE_KEY = "temu.barcode-label.compliance";
const FAVORITES_KEY = "temu.barcode-label.favorites";


interface ComplianceData {
  manufacturer: string;
  manufacturerAddress: string;
  manufacturerEmail: string;
  ecRepName: string;
  ecRepAddress: string;
  ecRepEmail: string;
  turRepName: string;
  turRepAddress: string;
  importerName: string;
  importerAddress: string;
}

interface ComplianceOption {
  name: string;
  address: string;
  email?: string;
}

type CloudSyncStatus = "idle" | "loading" | "success" | "error" | "empty";

function dedupeOptions(items: ComplianceOption[]): ComplianceOption[] {
  const seen = new Set<string>();
  return items.filter((o) => {
    if (!o.name) return false;
    const k = o.name.trim();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

interface BarcodeLabelModalProps {
  open: boolean;
  rows: Array<{
    soId?: string | null;
    rawCloud?: {
      sku_ext_code?: string | null;
      spec_name?: string | null;
      product_name?: string | null;
      mall_id?: string | null;
      skc_id?: string | null;
      label_codes?: string | null;
      thumb_url?: string | null;
      demand_qty?: number | null;
      sku_id?: string | null;
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
  importerName: "",
  importerAddress: "",
};

// --- 条码/PDF 工具 ---

function generateBarcodeDataUrl(code: string, barWidth = 1, barHeight = 20): string {
  const canvas = document.createElement("canvas");
  try {
    JsBarcode(canvas, code, { format: "CODE128", lineColor: "#000", width: barWidth, height: barHeight, displayValue: false, margin: 0 });
    return canvas.toDataURL("image/png");
  } catch { return ""; }
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

const SPANISH_PKG_ICON_MAP: Record<string, string> = {
  "家用塑料、金属或硬纸盒": "yellow.png",
  "家用纸板、瓦楞纸": "lan.png",
  "家用可降解包装": "zongs.png",
  "家用玻璃": "lvs.png",
};

function fitText(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  maxWidth: number,
  maxHeight: number,
  align: "left" | "center" | "right" = "left",
): { height: number; fs: number } {
  const MIN_FS = 3;
  const lhf = typeof doc.getLineHeightFactor === "function" ? doc.getLineHeightFactor() : 1.15;
  let fs = fontSize;
  while (fs >= MIN_FS) {
    doc.setFontSize(fs);
    const lines = doc.splitTextToSize(text, maxWidth);
    const lineH = fs * 0.3528 * lhf;
    if (lines.length * lineH <= maxHeight || fs <= MIN_FS) {
      doc.text(lines, x, y, { align });
      return { height: lines.length * lineH, fs };
    }
    fs -= 0.5;
  }
  return { height: 0, fs: MIN_FS };
}

function gululuFitText(
  doc: jsPDF, text: string, firstW: number, contW: number, maxLines: number, startFs: number,
): { text: string; fontSize: number }[] {
  let fs = startFs;
  while (fs > 2) {
    doc.setFontSize(fs);
    const firstLines = doc.splitTextToSize(text, firstW) as string[];
    if (firstLines.length <= 1) return [{ text: firstLines[0] || text, fontSize: fs }];
    const remain = firstLines.slice(1).join(" ");
    const contLines = doc.splitTextToSize(remain, contW) as string[];
    const all = [firstLines[0], ...contLines];
    if (all.length <= maxLines) return all.map(t => ({ text: t, fontSize: fs }));
    fs -= 0.3;
  }
  doc.setFontSize(fs);
  const firstLines = doc.splitTextToSize(text, firstW) as string[];
  const remain = firstLines.slice(1).join(" ");
  const contLines = remain ? doc.splitTextToSize(remain, contW) as string[] : [];
  return [firstLines[0], ...contLines].slice(0, maxLines).map(t => ({ text: t, fontSize: fs }));
}

function drawGululuTdFields(doc: jsPDF, fv: Record<string, string>) {
  const defs = [
    { key: "turRepName", lbl: "Ad:", lFs: 9, lX: 22.8, lY: 20.85, drawLabel: true,
      vFs: 7.8, fw: 70, cw: 70, ml: 2, fX: 28.2, cX: 22.8, vY: 21.5, sp: 2.7, adj: 1.9 },
    { key: "turRepAddress", lbl: "Adres:", lFs: 9, lX: 22.8, lY: 23.95, drawLabel: true,
      vFs: 7.8, fw: 65, cw: 75.5, ml: 3, fX: 33.8, cX: 22.8, vY: 24.8, sp: 2.75, adj: 1.9 },
    { key: "batchNumber", lbl: "Batch Number/Seri numarası:", lFs: 7.6, lX: 2.2, lY: 35.2,
      vFs: 8, fw: 20, cw: 16, ml: 1, fX: 42.2, cX: 42.2, vY: 35.6, sp: 1.4, adj: 1.9 },
    { key: "manufacturer", lbl: "Manufacturer/Üretici:", lFs: 7.5, lX: 2.1, lY: 39.8,
      vFs: 8, fw: 67, cw: 67, ml: 1, fX: 31.5, cX: 31.5, vY: 40.1, sp: 1.4, adj: 1.9 },
    { key: "manufacturerAddress", lbl: "Manufacturer Address/Adres:", lFs: 7.5, lX: 2.1, lY: 43.6,
      vFs: 6.5, fw: 55, cw: 95, ml: 3, fX: 41.5, cX: 2.5, vY: 44.1, sp: 2.75, adj: 2.2 },
    { key: "manufacturerEmail", lbl: "Manufacturer E-mail:", lFs: 7.3, lX: 2.1, lY: 52,
      vFs: 7, fw: 80, cw: 40, ml: 1, fX: 29.8, cX: 29.8, vY: 52.6, sp: 1.4, adj: 1.9 },
    { key: "ecRepName", lbl: "Name:", lFs: 7.5, lX: 24.5, lY: 56,
      vFs: 7.8, fw: 62, cw: 40, ml: 1, fX: 34.3, cX: 34.3, vY: 56.5, sp: 1.4, adj: 1.9 },
    { key: "ecRepAddress", lbl: "Address:", lFs: 7.5, lX: 24.5, lY: 59,
      vFs: 6.8, fw: 62.3, cw: 70.8, ml: 3, fX: 36.2, cX: 25.2, vY: 59.8, sp: 2.75, adj: 1.9 },
    { key: "ecRepEmail", lbl: "Email:", lFs: 7.5, lX: 25, lY: 68,
      vFs: 8, fw: 70, cw: 70, ml: 1, fX: 34.5, cX: 34.5, vY: 68.5, sp: 1.4, adj: 1.9 },
  ];
  for (const d of defs) {
    const val = fv[d.key] || "";
    if (!val) continue;
    if (d.drawLabel) {
      doc.setFontSize(d.lFs);
      doc.text(d.lbl, d.lX, d.lY);
    }
    const lines = gululuFitText(doc, val, d.fw, d.cw, d.ml, d.vFs);
    let y = d.vY;
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (!ln.text) continue;
      doc.setFontSize(ln.fontSize);
      doc.text(ln.text, i === 0 ? d.fX : d.cX, y + ln.fontSize / 5 - d.adj);
      y += d.sp;
    }
  }
}

function drawBarcodeTemplate(
  doc: jsPDF, code: string, skuExtCode: string, specName: string, originText: string, pageW: number, pageH: number, fontName: string
) {
  doc.setDrawColor(0);
  doc.setLineWidth(0.3);
  doc.rect(0.5, 0.5, pageW - 1, pageH - 1);
  doc.setFont(fontName, "bold");
  doc.setFontSize(5);
  doc.text(skuExtCode || code, 2, 3.5);
  if (specName) {
    doc.setFontSize(5.5);
    doc.text(specName, pageW - 2, 3.5, { align: "right" });
  }
  const barcodeDataUrl = generateBarcodeDataUrl(code);
  if (barcodeDataUrl) {
    doc.addImage(barcodeDataUrl, "PNG", 4, 5, pageW - 8, 11.5);
  }
  doc.setFontSize(6);
  doc.text(code, 2, 18.5);
  doc.text(originText, pageW - 2, 18.5, { align: "right" });
  doc.setFont("helvetica", "normal");
}

function drawBarcodeArea(
  doc: jsPDF, bc: { x: number; y: number; w: number; h: number },
  code: string, skuExtCode: string, specName: string, skuId: string,
  originText: string, fontName: string, iconReserve = 0
) {
  const { x, y, w, h } = bc;
  const ew = w - iconReserve;
  const small = w < 80;
  const fs1 = small ? 5 : 6.5;
  const fs2 = small ? 4.5 : 5.5;
  const fsBig = small ? 5.5 : 7;

  doc.setFillColor(255, 255, 255);
  doc.rect(x, y, w, h, "F");
  doc.setDrawColor(0);
  doc.setLineWidth(0.3);
  doc.rect(x, y, w, h);

  doc.setFont(fontName, "bold");
  doc.setFontSize(fs1);
  doc.text(skuExtCode || code, x + 1.5, y + 3.5);

  if (specName) {
    doc.setFontSize(fs2);
    doc.text(specName, x + ew - 1.5, y + 3.5, { align: "right" });
  }

  const barcodeDataUrl = generateBarcodeDataUrl(code, 2, small ? 28 : 40);
  if (barcodeDataUrl) {
    const bx = x + 3;
    const by = y + 5;
    const bw = ew - 6;
    const bh = h - 9.5;
    doc.addImage(barcodeDataUrl, "PNG", bx, by, bw, bh);
  }

  doc.setFontSize(fsBig);
  doc.text(skuId || code, x + 1.5, y + h - 1.5);
  doc.text(originText, x + ew - 1.5, y + h - 1.5, { align: "right" });
  doc.setFont("helvetica", "normal");
}

interface RowData {
  skuCode: string;
  skcId: string;
  specName: string;
  labelCode: string;
  thumbUrl: string;
  demandQty: number;
  skuId: string;
}

async function buildPdf(
  templates: LabelTemplate[],
  rowItems: RowData[],
  originText: string,
  compliance: ComplianceData,
  copies: number,
  customBatchNumber?: string,
  spanishPkgTypes?: string[]
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

  const spanishIcons: string[] = [];
  if (spanishPkgTypes) {
    for (const t of spanishPkgTypes) {
      const f = SPANISH_PKG_ICON_MAP[t];
      if (f) try { spanishIcons.push(await loadBgImage(f)); } catch {}
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
          const yOffset = tpl.barcode ? tpl.barcode.h + 0.5 : 0;
          const isTdTemplate = tpl.fields.some(f => f.key === "turRepName");
          if (bgUrl) {
            const ext = tpl.bgImage!.endsWith(".jpg") ? "JPEG" : "PNG";
            if (isTdTemplate) {
              doc.addImage(bgUrl, ext, -0.1, 15.9, 100.2, 94.7);
            } else {
              doc.addImage(bgUrl, ext, 0, yOffset, pw, ph - yOffset);
            }
          }
          if (tpl.barcode) {
            const code = item.labelCode || item.skuCode;
            const iconCount = Math.min(spanishIcons.length, 2);
            const iconSize = 13;
            const iconReserve = iconCount > 0 ? iconCount * iconSize + iconCount : 0;
            if (code) {
              drawBarcodeArea(doc, tpl.barcode, code, item.skuCode, item.specName, item.skuId, originText, fontData ? "NotoSansSC" : "helvetica", iconReserve);
            }
            if (iconCount > 0) {
              const bc = tpl.barcode;
              for (let si = 0; si < iconCount; si++) {
                const ix = bc.x + bc.w - iconSize * (si + 1) - si;
                doc.addImage(spanishIcons[si], "PNG", ix, bc.y, iconSize, iconSize);
              }
            }
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
            importerName: compliance.importerName,
            importerAddress: compliance.importerAddress,
            batchNumber: customBatchNumber || item.skuCode,
          };
          if (isTdTemplate) {
            drawGululuTdFields(doc, fieldValues);
          } else {
            const scale = yOffset ? (ph - yOffset) / ph : 1;
            const sorted = [...tpl.fields].sort((a, b) => a.y - b.y);
            for (let i = 0; i < sorted.length; i++) {
              const field = sorted[i];
              const val = fieldValues[field.key] || "";
              if (!val) continue;
              const displayText = (field.label || "") + val;
              let nextY = ph;
              for (let j = i + 1; j < sorted.length; j++) {
                if (sorted[j].y > field.y) { nextY = sorted[j].y; break; }
              }
              const actualY = yOffset + field.y * scale;
              const maxH = Math.max((nextY - field.y) * scale - 0.5, 3);
              fitText(doc, displayText, field.x, actualY, field.fontSize, field.maxWidth, maxH, field.align || "left");
            }
          }
          if (fontData) doc.setFont("helvetica", "normal");
        }
      }
    }
  }
  return doc;
}

async function loadExternalImage(url: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d")!.drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => resolve("");
    img.src = url;
  });
}

function drawProductInfoPage(doc: jsPDF, pw: number, ph: number, item: RowData, imgDataUrl: string, fontFamily: string) {
  const m = 12;
  const innerW = pw - 2 * m;

  // 红色标题
  doc.setFont(fontFamily, "bold");
  doc.setFontSize(18);
  doc.setTextColor(232, 56, 79);
  doc.text("此为产品信息页 无需粘贴!!!", pw / 2, m + 10, { align: "center" });
  doc.setTextColor(0, 0, 0);

  const topY = m + 18;
  const imgBoxW = innerW * 0.58;
  const qtyBoxW = innerW - imgBoxW;
  const topRowH = 95;

  doc.setDrawColor(0);
  doc.setLineWidth(0.4);

  // 产品图区域
  doc.rect(m, topY, imgBoxW, topRowH);
  doc.setFontSize(11);
  doc.text("产品sku展示图", m + 4, topY + 8);
  if (imgDataUrl) {
    const imgSize = Math.min(imgBoxW - 10, topRowH - 16);
    doc.addImage(imgDataUrl, "JPEG", m + 4, topY + 12, imgSize, imgSize);
  }

  // 数量区域
  doc.rect(m + imgBoxW, topY, qtyBoxW, topRowH);
  doc.setFontSize(11);
  doc.text("数量", m + imgBoxW + 4, topY + 8);
  doc.setFontSize(56);
  doc.text(String(item.demandQty || 0), m + imgBoxW + qtyBoxW / 2, topY + topRowH / 2 + 12, { align: "center" });

  // SKU 货号区域
  const skuY = topY + topRowH;
  const skuH = 42;
  doc.rect(m, skuY, innerW, skuH);
  doc.setFontSize(11);
  doc.text("SKU 货号", m + 4, skuY + 8);
  doc.setFontSize(30);
  doc.text(item.skuCode || "", m + 4, skuY + 28);

  // SKU 属性区域
  const attrY = skuY + skuH;
  const attrH = 62;
  doc.rect(m, attrY, innerW, attrH);
  doc.setFontSize(11);
  doc.text("SKU 属性", m + 4, attrY + 8);
  doc.setFontSize(30);
  doc.text(item.specName || "", m + 4, attrY + 30);

  // 底部 SKU ID + 水印
  const footY = attrY + attrH;
  const footH = ph - footY - m;
  doc.rect(m, footY, innerW, footH);
  doc.setFontSize(13);
  doc.text(item.skuId || "", m + 4, footY + footH / 2 + 2);
  doc.text("Temu Ops 打印", m + innerW - 4, footY + footH / 2 + 2, { align: "right" });
}

// --- 尺寸标签颜色 ---

const SIZE_COLORS: Record<string, string> = {
  "70*20": "#52c41a",
  "70*30": "#52c41a",
  "70*40": "#13c2c2",
  "70*60": "#2f54eb",
  "70*70": "#722ed1",
  "100*70": "#eb2f96",
  "100*100": "#f5222d",
  "40*40": "#fa8c16",
};

const SPANISH_PACKAGING_OPTIONS = [
  "家用塑料、金属或硬纸盒",
  "家用纸板、瓦楞纸",
  "家用可降解包装",
  "家用玻璃",
];

const TYPE_COLORS: Record<string, string> = {
  "带进口商信息": "#f5222d",
  "独立标签": "#1890ff",
  "条码融合": "#52c41a",
  "通用": "#fa8c16",
};

// --- 侧栏按钮样式 ---

const sidebarBtnBase: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "10px 16px",
  marginBottom: 4,
  border: "1px solid #e8e8e8",
  borderRadius: 8,
  background: "#fff",
  cursor: "pointer",
  fontSize: 14,
  textAlign: "left",
  transition: "all 0.15s",
};

const sidebarBtnActive: React.CSSProperties = {
  ...sidebarBtnBase,
  background: "#e6f7ff",
  borderColor: "#1890ff",
  color: "#1890ff",
  fontWeight: 600,
};

// ====== 主组件 ======

export default function BarcodeLabelModal({ open, rows, onClose }: BarcodeLabelModalProps) {
  const mallId = rows[0]?.rawCloud?.mall_id || "";
  const skcId = rows[0]?.rawCloud?.skc_id || "";
  const complianceCacheKey = mallId ? `${COMPLIANCE_KEY}.${mallId}` : COMPLIANCE_KEY;

  // --- 模板选择状态 ---
  const [selectedId, setSelectedId] = useState("tm");
  const [sizeFilter, setSizeFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<LabelType | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [showFavorites, setShowFavorites] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);

  // --- 打印设置状态 ---
  const [, setPrinters] = useState<Array<{ name: string; displayName: string; isDefault: boolean }>>([]);
  const [printerName, setPrinterName] = useState("");
  const [originText, setOriginText] = useState("Made In China");
  const [copies, setCopies] = useState(1);
  const [printing, setPrinting] = useState(false);
  const [extraTemplateIds, setExtraTemplateIds] = useState<string[]>([]);

  // --- 数据状态 ---
  const [compliance, setCompliance] = useState<ComplianceData>(DEFAULT_COMPLIANCE);
  const [, setCloudSyncStatus] = useState<CloudSyncStatus>("idle");
  const [mfrOptions, setMfrOptions] = useState<ComplianceOption[]>([]);
  const [ecRepOptions, setEcRepOptions] = useState<ComplianceOption[]>([]);
  const [turRepOptions, setTurRepOptions] = useState<ComplianceOption[]>([]);
  const [skuItems, setSkuItems] = useState<RowData[]>([]);
  const [, setLoadingItems] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [barcodeType, setBarcodeType] = useState<"skc" | "custom">("skc");
  const [customBarcode, setCustomBarcode] = useState("");
  const [spanishPackaging, setSpanishPackaging] = useState<string[]>([]);
  const [includeProductInfo] = useState(false);
  const [colorMode] = useState(false);
  const [pagesPerSheet] = useState(1);

  const updateCompliance = useCallback((patch: Partial<ComplianceData>) => {
    setCompliance((prev) => {
      const next = { ...prev, ...patch };
      saveJson(complianceCacheKey, next);
      return next;
    });
  }, [complianceCacheKey]);

  const extractOptionsFromRows = useCallback((rows: import("../utils/cloudClient").CompliancePropertyRow[]) => {
    const mfrs: ComplianceOption[] = [];
    const ecs: ComplianceOption[] = [];
    const turs: ComplianceOption[] = [];
    for (const r of rows) {
      if (r.manufacturer_name) mfrs.push({ name: r.manufacturer_name, address: r.manufacturer_address || "", email: r.manufacturer_email || "" });
      if (r.ec_rep_name) ecs.push({ name: r.ec_rep_name, address: r.ec_rep_address || "", email: r.ec_rep_email || "" });
      if (r.tur_rep_name) turs.push({ name: r.tur_rep_name, address: r.tur_rep_address || "" });
    }
    setMfrOptions(dedupeOptions(mfrs));
    setEcRepOptions(dedupeOptions(ecs));
    setTurRepOptions(dedupeOptions(turs));
  }, []);

  // --- 初始化 ---
  useEffect(() => {
    if (!open) return;
    const s = loadJson(SETTINGS_KEY, {} as Record<string, unknown>);
    const savedCompliance = loadJson(complianceCacheKey, DEFAULT_COMPLIANCE);
    setSelectedId((s.templateId as string) || "tm");
    setOriginText((s.originText as string) || "Made In China");
    setCopies((s.copies as number) || 1);
    setPrinterName((s.printerName as string) || "");
    setExtraTemplateIds((s.extraTemplateIds as string[]) || []);
    setFavorites(loadJson(FAVORITES_KEY, [] as string[]));
    setCompliance(savedCompliance);
    setCloudSyncStatus("idle");
    setSizeFilter(null);
    setTypeFilter(null);
    setSearchQuery("");
    setShowFavorites(false);
    setPreviewId(null);

    window.electronAPI?.app?.getPrinters?.().then((list: Array<{ name: string; displayName: string; isDefault: boolean }>) => {
      setPrinters(list || []);
      if (!s.printerName) {
        const def = (list || []).find((p: { isDefault: boolean }) => p.isDefault);
        if (def) setPrinterName(def.name);
      }
    });

    if (savedCompliance.manufacturer) setMfrOptions((prev) => dedupeOptions([...prev, { name: savedCompliance.manufacturer, address: savedCompliance.manufacturerAddress || "", email: savedCompliance.manufacturerEmail || "" }]));
    if (savedCompliance.ecRepName) setEcRepOptions((prev) => dedupeOptions([...prev, { name: savedCompliance.ecRepName, address: savedCompliance.ecRepAddress || "", email: savedCompliance.ecRepEmail || "" }]));
    if (savedCompliance.turRepName) setTurRepOptions((prev) => dedupeOptions([...prev, { name: savedCompliance.turRepName, address: savedCompliance.turRepAddress || "" }]));

    setCloudSyncStatus("loading");
    const applyRows = (cloudRows: Awaited<ReturnType<typeof fetchComplianceProperties>>) => {
      extractOptionsFromRows(cloudRows);
      const withData = cloudRows.filter((r) => r.manufacturer_name || r.ec_rep_name || r.tur_rep_name);
      const match = skcId ? withData.find((r) => r.product_skc_id === skcId) : undefined;
      const r = match || withData[0] || cloudRows[0];
      const fromCloud: ComplianceData = {
        manufacturer: r.manufacturer_name || "",
        manufacturerAddress: r.manufacturer_address || "",
        manufacturerEmail: r.manufacturer_email || "",
        ecRepName: r.ec_rep_name || "",
        ecRepAddress: r.ec_rep_address || "",
        ecRepEmail: r.ec_rep_email || "",
        turRepName: r.tur_rep_name || "",
        turRepAddress: r.tur_rep_address || "",
        importerName: r.importer_name || "",
        importerAddress: r.importer_address || "",
      };
      setCompliance(fromCloud);
      saveJson(complianceCacheKey, fromCloud);
      setCloudSyncStatus("success");
    };
    fetchComplianceProperties({ mall_id: mallId || undefined, limit: 500 })
      .then(async (cloudRows) => {
        const withData = cloudRows.filter((r) => r.manufacturer_name || r.ec_rep_name || r.tur_rep_name);
        if (withData.length) { applyRows(cloudRows); return; }
        if (mallId) {
          const fallback = await fetchComplianceProperties({ limit: 500 });
          const fbWithData = fallback.filter((r) => r.manufacturer_name || r.ec_rep_name || r.tur_rep_name);
          if (fbWithData.length) { applyRows(fallback); return; }
        }
        if (!cloudRows.length) {
          setCloudSyncStatus(savedCompliance.manufacturer || savedCompliance.ecRepName ? "idle" : "empty");
        } else {
          applyRows(cloudRows);
        }
      })
      .catch((err) => {
        console.error("[合规同步] 自动拉取失败:", err);
        setCloudSyncStatus(savedCompliance.manufacturer || savedCompliance.ecRepName ? "idle" : "error");
      });
  }, [open, mallId, skcId, complianceCacheKey, extractOptionsFromRows]);

  // --- SKU 加载 ---
  useEffect(() => {
    if (!open || !rows.length) { setSkuItems([]); return; }
    let cancelled = false;
    (async () => {
      setLoadingItems(true);
      const items: RowData[] = [];
      for (const r of rows) {
        const rMallId = r.rawCloud?.mall_id;
        const rSoId = r.soId;
        const rLabelCode = r.rawCloud?.label_codes || "";
        const rSkcId = r.rawCloud?.skc_id || "";
        if (rMallId && rSoId) {
          try {
            const fetched = await window.electronAPI?.erp?.consignDeliver?.cloudItems?.({ mallId: rMallId, soId: rSoId });
            if (Array.isArray(fetched) && fetched.length) {
              for (const it of fetched) {
                items.push({ skuCode: it.iId || "", skcId: rSkcId, specName: it.propertiesValue || "", labelCode: rLabelCode, thumbUrl: it.picUrl || r.rawCloud?.thumb_url || "", demandQty: it.qty ?? r.rawCloud?.demand_qty ?? 0, skuId: it.skuId || r.rawCloud?.sku_id || "" });
              }
              continue;
            }
          } catch {}
        }
        items.push({ skuCode: r.rawCloud?.sku_ext_code || "", skcId: rSkcId, specName: r.rawCloud?.spec_name || "", labelCode: rLabelCode, thumbUrl: r.rawCloud?.thumb_url || "", demandQty: r.rawCloud?.demand_qty ?? 0, skuId: r.rawCloud?.sku_id || "" });
      }
      if (!cancelled) { setSkuItems(items); setLoadingItems(false); }
    })();
    return () => { cancelled = true; };
  }, [open, rows]);

  // --- 计算 ---
  const selectedTemplate = useMemo(() => TEMPLATES.find((t) => t.id === selectedId) || TEMPLATES[0], [selectedId]);
  const filteredList = useMemo(
    () => filterTemplates(sizeFilter, typeFilter, searchQuery, favorites, showFavorites),
    [sizeFilter, typeFilter, searchQuery, favorites, showFavorites]
  );
  const previewTemplate = previewId ? TEMPLATES.find((t) => t.id === previewId) : null;

  // --- 收藏 ---
  const toggleFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      saveJson(FAVORITES_KEY, next);
      return next;
    });
  }, []);

  // --- 打印 ---
  const doPrint = useCallback(async (silent: boolean) => {
    const rowItems = skuItems.filter((r) => selectedTemplate.id !== "tm" || (r.labelCode || r.skuCode));
    if (selectedTemplate.id === "tm" && rowItems.length === 0) {
      message.warning("选中行没有 SKU 编码，无法打印条码");
      return;
    }
    setPrinting(true);
    const hide = message.loading(`打印 ${rowItems.length} 个 SKU × ${copies} 份...`, 0);
    try {
      saveJson(SETTINGS_KEY, { templateId: selectedId, printerName, originText, copies, extraTemplateIds });
      saveJson(complianceCacheKey, compliance);
      const allTemplates = [selectedTemplate];
      const batchNum = barcodeType === "custom" && customBarcode ? customBarcode : "";
      const doc = await buildPdf(allTemplates, rowItems, originText, compliance, copies, batchNum, spanishPackaging);
      if (includeProductInfo) {
        const fontFamily = (await loadNotoFont()) ? "NotoSansSC" : "helvetica";
        const imgCache = new Map<string, string>();
        for (const item of rowItems) {
          if (item.thumbUrl && !imgCache.has(item.thumbUrl)) {
            try { imgCache.set(item.thumbUrl, await loadExternalImage(item.thumbUrl)); } catch {}
          }
        }
        for (const item of rowItems) {
          doc.addPage([210, 297], "portrait");
          drawProductInfoPage(doc, 210, 297, item, imgCache.get(item.thumbUrl) || "", fontFamily);
        }
      }
      const arrayBuf = doc.output("arraybuffer");
      const bytes = new Uint8Array(arrayBuf);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);
      await window.electronAPI?.app?.printPdfSilent?.({ base64, copies: 1 });
    } catch (e: unknown) {
      message.error((e as Error)?.message || "打印失败");
    } finally {
      hide();
      setPrinting(false);
    }
  }, [selectedTemplate, selectedId, skuItems, printerName, copies, originText, compliance, extraTemplateIds, includeProductInfo, colorMode, pagesPerSheet, barcodeType, customBarcode, spanishPackaging]);

  // --- 渲染 ---
  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={1100}
      destroyOnClose
      closable={false}
      footer={null}
      bodyStyle={{ padding: 0 }}
      style={{ top: 40 }}
    >
      {/* ====== 头部 ====== */}
      <div style={{ padding: "16px 24px", borderBottom: "1px solid #f0f0f0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <span style={{ fontSize: 20, fontWeight: 700, color: "#e8384f" }}>咕噜噜打印设置</span>
          <span style={{ marginLeft: 12, fontSize: 13, color: "#e8384f" }}>进入模板内可选择西班牙标签</span>
        </div>
        <div />
      </div>

      {/* ====== 主体 ====== */}
      <div style={{ display: "flex", height: 560 }}>
        {/* ------ 左侧栏 ------ */}
        <div style={{ width: 220, borderRight: "1px solid #f0f0f0", padding: "12px 12px", overflowY: "auto", flexShrink: 0 }}>
          {/* 搜索 */}
          <Input
            prefix={<SearchOutlined style={{ color: "#bbb" }} />}
            placeholder="搜索标签模板..."
            size="small"
            allowClear
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setSizeFilter(null); setTypeFilter(null); setShowFavorites(false); }}
            style={{ marginBottom: 12, borderRadius: 8 }}
          />

          {/* 我的收藏 */}
          <button
            style={showFavorites ? sidebarBtnActive : sidebarBtnBase}
            onClick={() => { setShowFavorites(!showFavorites); setSizeFilter(null); setTypeFilter(null); setSearchQuery(""); }}
          >
            {showFavorites ? <StarFilled style={{ color: "#faad14", marginRight: 6 }} /> : <StarOutlined style={{ color: "#faad14", marginRight: 6 }} />}
            我的收藏
          </button>

          {/* 自定义模板 */}
          <button style={sidebarBtnBase}>
            <SettingOutlined style={{ color: "#52c41a", marginRight: 6 }} />
            <span style={{ color: "#52c41a", fontWeight: 600 }}>自定义模板</span>
          </button>

          {/* 尺寸筛选 */}
          <div style={{ margin: "12px 0 6px", fontSize: 13, color: "#888", fontWeight: 600 }}>
            <span style={{ marginRight: 4 }}>&#x1F3F7;</span>尺寸筛选
          </div>
          {SIZE_FILTERS.map((s) => (
            <button
              key={s}
              style={sizeFilter === s ? sidebarBtnActive : sidebarBtnBase}
              onClick={() => { setSizeFilter(sizeFilter === s ? null : s); setTypeFilter(null); setShowFavorites(false); setSearchQuery(""); }}
            >
              {s}
            </button>
          ))}

          {/* 标签类型 */}
          <div style={{ margin: "12px 0 6px", fontSize: 13, color: "#888", fontWeight: 600 }}>
            <span style={{ marginRight: 4 }}>&#x1F3F7;</span>标签类型
          </div>
          {LABEL_TYPES.map((t) => (
            <button
              key={t}
              style={typeFilter === t ? sidebarBtnActive : sidebarBtnBase}
              onClick={() => { setTypeFilter(typeFilter === t ? null : t); setSizeFilter(null); setShowFavorites(false); setSearchQuery(""); }}
            >
              {t}
              {t === "带进口商信息" && (
                <span style={{ marginLeft: 6, background: "#f5222d", color: "#fff", fontSize: 10, padding: "1px 5px", borderRadius: 4, fontWeight: 700 }}>NEW</span>
              )}
            </button>
          ))}

        </div>

        {/* ------ 右侧模板网格 ------ */}
        <div style={{ flex: 1, overflowY: "auto", padding: 16, background: "#fafafa" }}>
          {filteredList.length === 0 ? (
            <div style={{ textAlign: "center", color: "#999", paddingTop: 100 }}>
              {showFavorites ? "暂无收藏模板，点击模板上的爱心收藏" : "没有匹配的模板"}
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
              {filteredList.map((tpl) => {
                const isSelected = tpl.id === selectedId;
                const isFav = favorites.includes(tpl.id);
                const sizeLabel = getSizeLabel(tpl);
                return (
                  <div
                    key={tpl.id}
                    onClick={() => setSelectedId(tpl.id)}
                    style={{
                      background: "#fff",
                      borderRadius: 10,
                      border: isSelected ? "2px solid #1890ff" : "1px solid #e8e8e8",
                      cursor: "pointer",
                      position: "relative",
                      transition: "all 0.15s",
                      boxShadow: isSelected ? "0 2px 8px rgba(24,144,255,0.2)" : "0 1px 4px rgba(0,0,0,0.06)",
                      overflow: "hidden",
                    }}
                  >
                    {/* 标签 */}
                    <div style={{ display: "flex", gap: 4, padding: "8px 8px 4px", flexWrap: "wrap" }}>
                      <span style={{
                        fontSize: 11, fontWeight: 700, color: "#fff", padding: "1px 6px", borderRadius: 4,
                        background: SIZE_COLORS[sizeLabel] || "#888",
                      }}>{sizeLabel}</span>
                      <span style={{
                        fontSize: 11, fontWeight: 600, color: "#fff", padding: "1px 6px", borderRadius: 4,
                        background: TYPE_COLORS[tpl.labelType] || "#888",
                      }}>{tpl.labelType}</span>
                      {tpl.name.includes("带进口商") && tpl.labelType !== "带进口商信息" && (
                        <span style={{ fontSize: 11, fontWeight: 600, color: "#fff", padding: "1px 6px", borderRadius: 4, background: "#f5222d" }}>带进口商</span>
                      )}
                    </div>

                    {/* 收藏按钮 */}
                    <div
                      onClick={(e) => { e.stopPropagation(); toggleFavorite(tpl.id); }}
                      style={{ position: "absolute", top: 6, right: 6, cursor: "pointer", fontSize: 18, lineHeight: 1, zIndex: 2 }}
                    >
                      {isFav
                        ? <HeartFilled style={{ color: "#faad14" }} />
                        : <HeartOutlined style={{ color: "#ccc" }} />}
                    </div>

                    {/* 模板预览图 */}
                    <div style={{ padding: "4px 8px", display: "flex", justifyContent: "center", alignItems: "center", minHeight: 100 }}>
                      {tpl.bgImage ? (
                        <img
                          src={`/label-templates/${tpl.bgImage}`}
                          alt={tpl.name}
                          style={{ maxWidth: "100%", maxHeight: 120, objectFit: "contain" }}
                        />
                      ) : (
                        <div style={{ color: "#ccc", fontSize: 12 }}>无预览</div>
                      )}
                    </div>

                    {/* 放大预览按钮 */}
                    <div
                      onClick={(e) => { e.stopPropagation(); setPreviewId(tpl.id); setSelectedId(tpl.id); }}
                      style={{ position: "absolute", bottom: 36, right: 8, cursor: "pointer", fontSize: 16, color: "#1890ff", opacity: 0.6 }}
                    >
                      <EyeOutlined />
                    </div>

                    {/* 模板名称 */}
                    <div style={{ padding: "4px 8px 8px", fontSize: 11, color: "#555", lineHeight: 1.4, textAlign: "center" }}>
                      {tpl.name}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ====== 底部按钮 ====== */}
      <div style={{ padding: "12px 24px", borderTop: "1px solid #f0f0f0", display: "flex", justifyContent: "flex-end", gap: 10, alignItems: "center" }}>
        <div style={{ flex: 1, fontSize: 12, color: "#888" }}>
          已选: <strong style={{ color: "#1890ff" }}>{selectedTemplate.name}</strong>
        </div>
        <Button
          type="primary"
          icon={<PrinterOutlined />}
          loading={printing}
          onClick={() => setShowConfigModal(true)}
          size="large"
          style={{ background: "#1890ff", borderRadius: 8, fontWeight: 600, minWidth: 140 }}
        >
          开始打印
        </Button>
        <Button
          icon={<CloseOutlined />}
          onClick={onClose}
          size="large"
          style={{ borderRadius: 8, fontWeight: 600, minWidth: 100, background: "#333", color: "#fff", border: "none" }}
        >
          关闭
        </Button>
      </div>

      {/* ====== 模板预览弹窗 ====== */}
      <Modal
        open={!!previewTemplate}
        onCancel={() => setPreviewId(null)}
        width={600}
        footer={null}
        title="模板预览"
        destroyOnClose
      >
        {previewTemplate && (
          <div style={{ textAlign: "center" }}>
            {previewTemplate.bgImage && (
              <img
                src={`/label-templates/${previewTemplate.bgImage}`}
                alt={previewTemplate.name}
                style={{ maxWidth: "100%", maxHeight: 500, objectFit: "contain", border: "1px solid #eee", borderRadius: 4 }}
              />
            )}
            <div style={{ marginTop: 12, fontSize: 14, color: "#333" }}>{previewTemplate.name}</div>
            <div style={{ marginTop: 4, fontSize: 12, color: "#999" }}>{previewTemplate.width}mm × {previewTemplate.height}mm | {previewTemplate.labelType}</div>
          </div>
        )}
      </Modal>

      {/* ====== Gululu 风格模板配置弹窗 ====== */}
      <Modal
        open={showConfigModal}
        onCancel={() => setShowConfigModal(false)}
        width={860}
        footer={null}
        closable
        destroyOnClose
        bodyStyle={{ padding: "24px 32px" }}
        zIndex={2000}
      >
        <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.5, marginBottom: 24 }}>
          {selectedTemplate.name}
        </div>
        <div style={{ display: "flex", gap: 40 }}>
          {/* 左：模板预览 */}
          <div style={{ flex: "0 0 320px", display: "flex", alignItems: "flex-start", justifyContent: "center" }}>
            {selectedTemplate.bgImage ? (
              <img
                src={`/label-templates/${selectedTemplate.bgImage}`}
                alt={selectedTemplate.name}
                style={{ width: "100%", objectFit: "contain", border: "1px solid #eee", borderRadius: 4 }}
              />
            ) : (
              <div style={{ width: "100%", height: 300, background: "#f9f9f9", display: "flex", alignItems: "center", justifyContent: "center", color: "#999", borderRadius: 4, border: "1px solid #eee" }}>
                无预览
              </div>
            )}
          </div>

          {/* 右：配置表单 */}
          <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
            {selectedTemplate.fields.length > 0 && (
              <>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>制造商</div>
                  <Select
                    style={{ width: "100%" }}
                    placeholder="请选择"
                    value={compliance.manufacturer || undefined}
                    onChange={(val: string) => {
                      const opt = mfrOptions.find((o) => o.name === val);
                      if (opt) updateCompliance({ manufacturer: opt.name, manufacturerAddress: opt.address, manufacturerEmail: opt.email || "" });
                    }}
                    allowClear
                    onClear={() => updateCompliance({ manufacturer: "", manufacturerAddress: "", manufacturerEmail: "" })}
                    showSearch
                    filterOption={(input, option) => (option?.label ?? "").toLowerCase().includes(input.toLowerCase())}
                    options={mfrOptions.map((o) => ({ label: `${o.name} / ${o.address}`, value: o.name }))}
                  />
                </div>

                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>欧代信息</div>
                  <Select
                    style={{ width: "100%" }}
                    placeholder="请选择"
                    value={compliance.ecRepName || undefined}
                    onChange={(val: string) => {
                      const opt = ecRepOptions.find((o) => o.name === val);
                      if (opt) updateCompliance({ ecRepName: opt.name, ecRepAddress: opt.address, ecRepEmail: opt.email || "" });
                    }}
                    allowClear
                    onClear={() => updateCompliance({ ecRepName: "", ecRepAddress: "", ecRepEmail: "" })}
                    showSearch
                    filterOption={(input, option) => (option?.label ?? "").toLowerCase().includes(input.toLowerCase())}
                    options={ecRepOptions.map((o) => ({ label: `${o.name} / ${o.address}`, value: o.name }))}
                  />
                </div>

                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>土耳其代信息</div>
                  <Select
                    style={{ width: "100%" }}
                    placeholder="请选择"
                    value={compliance.turRepName || undefined}
                    onChange={(val: string) => {
                      const opt = turRepOptions.find((o) => o.name === val);
                      if (opt) updateCompliance({ turRepName: opt.name, turRepAddress: opt.address });
                    }}
                    allowClear
                    onClear={() => updateCompliance({ turRepName: "", turRepAddress: "" })}
                    showSearch
                    filterOption={(input, option) => (option?.label ?? "").toLowerCase().includes(input.toLowerCase())}
                    options={turRepOptions.map((o) => ({ label: `${o.name} / ${o.address}`, value: o.name }))}
                  />
                </div>
              </>
            )}

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>打印份数</div>
              <Select
                style={{ width: 120 }}
                value={copies}
                onChange={(v: number) => setCopies(v)}
                options={[1, 2, 3, 4, 5].map((n) => ({ label: `${n} 份`, value: n }))}
              />
            </div>

            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>商品识别码</div>
              <Radio.Group value={barcodeType} onChange={(e) => setBarcodeType(e.target.value)}>
                <Radio value="skc">SKC</Radio>
                <Radio value="custom">自定义</Radio>
              </Radio.Group>
              {barcodeType === "custom" && (
                <Input
                  style={{ marginTop: 8 }}
                  placeholder="输入自定义识别码"
                  value={customBarcode}
                  onChange={(e) => setCustomBarcode(e.target.value)}
                />
              )}
            </div>

            <div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>西班牙包装分类（最多选择2种）</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {SPANISH_PACKAGING_OPTIONS.map((opt) => {
                  const checked = spanishPackaging.includes(opt);
                  return (
                    <div
                      key={opt}
                      onClick={() => {
                        if (checked) {
                          setSpanishPackaging((prev) => prev.filter((x) => x !== opt));
                        } else if (spanishPackaging.length < 2) {
                          setSpanishPackaging((prev) => [...prev, opt]);
                        }
                      }}
                      style={{
                        padding: "10px 12px",
                        border: checked ? "1px solid #1890ff" : "1px solid #e8e8e8",
                        borderRadius: 8,
                        cursor: spanishPackaging.length >= 2 && !checked ? "not-allowed" : "pointer",
                        background: checked ? "#e6f7ff" : "#fff",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        opacity: spanishPackaging.length >= 2 && !checked ? 0.5 : 1,
                      }}
                    >
                      <Checkbox checked={checked} />
                      <span style={{ fontSize: 13 }}>{opt}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 28, display: "flex", justifyContent: "flex-end", gap: 12 }}>
          <Button size="large" onClick={() => setShowConfigModal(false)} style={{ minWidth: 100, borderRadius: 8 }}>
            取消
          </Button>
          <Button
            type="primary"
            size="large"
            loading={printing}
            onClick={() => { setShowConfigModal(false); doPrint(true); }}
            style={{ minWidth: 100, borderRadius: 8, fontWeight: 600 }}
          >
            确定
          </Button>
        </div>
      </Modal>

    </Modal>
  );
}
