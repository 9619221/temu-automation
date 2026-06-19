import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Select, InputNumber, Button, Space, message, Typography, Divider, Alert, Input, Collapse } from "antd";
import { PrinterOutlined, SettingOutlined } from "@ant-design/icons";
import JsBarcode from "jsbarcode";
import { jsPDF } from "jspdf";
import { TEMPLATES, TEMPLATE_CATEGORIES, getTemplatesByCategory } from "./label-templates/templateDefs";
import type { LabelTemplate } from "./label-templates/templateDefs";
import { fetchComplianceProperties } from "../utils/cloudClient";

const { Text } = Typography;

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

function generateBarcodeDataUrl(code: string): string {
  const canvas = document.createElement("canvas");
  try {
    JsBarcode(canvas, code, { format: "CODE128", lineColor: "#000", width: 1, height: 20, displayValue: false, margin: 0 });
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

function drawBarcodeTemplate(
  doc: jsPDF, code: string, specName: string, originText: string, pageW: number, pageH: number
) {
  const barcodeDataUrl = generateBarcodeDataUrl(code);
  const barcodeW = pageW - 12;
  const barcodeH = pageH - 8;
  const barcodeX = (pageW - barcodeW) / 2;
  const barcodeY = 3.5;

  doc.setFontSize(4.9);
  doc.text(code, 3, 3);
  if (specName) {
    const spec = specName.length > 15 ? specName.substring(0, 15) : specName;
    doc.text(spec, pageW - 3, 3, { align: "right" });
  }

  if (barcodeDataUrl) {
    doc.addImage(barcodeDataUrl, "PNG", barcodeX, barcodeY, barcodeW, barcodeH);
  }

  doc.setFontSize(5.4);
  doc.text(code, 3, pageH - 1.5);
  doc.setFontSize(6);
  doc.text(originText, pageW - 3, pageH - 1.5, { align: "right" });
}

async function buildPdf(
  template: LabelTemplate,
  skuCode: string,
  specName: string,
  originText: string,
  compliance: ComplianceData,
  copies: number
): Promise<jsPDF> {
  const { width: pw, height: ph } = template;
  const orientation = pw > ph ? "landscape" : "portrait";
  const format: [number, number] = [pw, ph];
  const doc = new jsPDF({ orientation, unit: "mm", format, hotfixes: ["px_scaling"] });

  const totalPages = Math.max(1, copies);

  let bgDataUrl: string | null = null;
  if (template.bgImage && template.id !== "tm") {
    try { bgDataUrl = await loadBgImage(template.bgImage); } catch {}
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
    batchNumber: skuCode,
  };

  for (let i = 0; i < totalPages; i++) {
    if (i > 0) doc.addPage(format, orientation);

    if (template.id === "tm") {
      drawBarcodeTemplate(doc, skuCode, specName, originText, pw, ph);
    } else {
      if (bgDataUrl) {
        const ext = template.bgImage!.endsWith(".jpg") ? "JPEG" : "PNG";
        doc.addImage(bgDataUrl, ext, 0, 0, pw, ph);
      }
      for (const field of template.fields) {
        const val = fieldValues[field.key] || "";
        if (!val) continue;
        doc.setFontSize(field.fontSize);
        doc.text(val, field.x, field.y, {
          align: field.align || "left",
          maxWidth: field.maxWidth,
        });
      }
    }
  }

  return doc;
}

export default function BarcodeLabelModal({ open, rows, onClose }: BarcodeLabelModalProps) {
  const mallId = rows[0]?.rawCloud?.mall_id || "";
  const skcId = rows[0]?.rawCloud?.skc_id || "";
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
  const [cloudLoading, setCloudLoading] = useState(false);

  const previewRef = useRef("");
  const buildingRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    const s = savedSettings;
    setTemplateId((s.templateId as string) || "tm");
    setCategory((s.category as string) || "条码标签");
    setOriginText((s.originText as string) || "Made In China");
    setCopies((s.copies as number) || 1);
    setPrinterName((s.printerName as string) || "");
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
      setCloudLoading(true);
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
        .finally(() => setCloudLoading(false));
    }
  }, [open, savedSettings, savedCompliance, mallId, skcId, complianceCacheKey]);

  useEffect(() => {
    return () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); };
  }, []);

  const skuCode = rows[0]?.rawCloud?.sku_ext_code || "";
  const specName = rows[0]?.rawCloud?.spec_name || "";
  const template = useMemo(() => TEMPLATES.find((t) => t.id === templateId) || TEMPLATES[0], [templateId]);
  const categoryTemplates = useMemo(() => getTemplatesByCategory(category), [category]);
  const hasCode = !!skuCode;
  const needsCompliance = template.fields.length > 0 && template.id !== "tm";

  useEffect(() => {
    if (!open) { setPreviewUrl(""); return; }
    if (buildingRef.current) return;
    buildingRef.current = true;
    const code = skuCode || "SAMPLE123";
    buildPdf(template, code, specName, originText, compliance, 1)
      .then((doc) => {
        const blob = doc.output("blob");
        if (previewRef.current) URL.revokeObjectURL(previewRef.current);
        const url = URL.createObjectURL(blob);
        previewRef.current = url;
        setPreviewUrl(url);
      })
      .catch(() => setPreviewUrl(""))
      .finally(() => { buildingRef.current = false; });
  }, [open, template, skuCode, specName, originText, compliance]);

  const doPrint = useCallback(async (silent: boolean) => {
    if (template.id === "tm" && !skuCode) {
      message.warning("选中行没有 SKU 编码，无法打印条码");
      return;
    }
    if (silent && !printerName) { message.warning("请先选择打印机"); return; }
    setPrinting(true);
    const hide = message.loading("打印中...", 0);
    try {
      saveJson(SETTINGS_KEY, { templateId, category, printerName, originText, copies });
      saveJson(complianceCacheKey, compliance);

      const code = skuCode || "SAMPLE";
      const doc = await buildPdf(template, code, specName, originText, compliance, copies);
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
      message.success(`已发送 ${copies} 份标签到打印机`);
    } catch (e: unknown) {
      message.error((e as Error)?.message || "打印失败");
    } finally {
      hide();
      setPrinting(false);
    }
  }, [template, skuCode, specName, printerName, copies, originText, compliance, templateId, category, complianceCacheKey]);

  const updateCompliance = useCallback((key: keyof ComplianceData, val: string) => {
    setCompliance((prev) => ({ ...prev, [key]: val }));
  }, []);

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

          {needsCompliance && cloudLoading && (
            <Text type="secondary" style={{ display: "block", marginTop: 4, fontSize: 11 }}>
              正在从云端拉取合规数据...
            </Text>
          )}

          {needsCompliance && (
            <Collapse
              size="small"
              style={{ marginTop: 4 }}
              items={[
                {
                  key: "mfr",
                  label: "制造商信息",
                  children: (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <Input size="small" placeholder="Manufacturer" value={compliance.manufacturer} onChange={(e) => updateCompliance("manufacturer", e.target.value)} />
                      <Input size="small" placeholder="Address" value={compliance.manufacturerAddress} onChange={(e) => updateCompliance("manufacturerAddress", e.target.value)} />
                      <Input size="small" placeholder="E-mail" value={compliance.manufacturerEmail} onChange={(e) => updateCompliance("manufacturerEmail", e.target.value)} />
                    </div>
                  ),
                },
                ...(template.fields.some((f) => f.key.startsWith("ecRep"))
                  ? [{
                      key: "ecRep",
                      label: "EC REP 欧代",
                      children: (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <Input size="small" placeholder="Name" value={compliance.ecRepName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateCompliance("ecRepName", e.target.value)} />
                          <Input size="small" placeholder="Address" value={compliance.ecRepAddress} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateCompliance("ecRepAddress", e.target.value)} />
                          <Input size="small" placeholder="E-mail" value={compliance.ecRepEmail} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateCompliance("ecRepEmail", e.target.value)} />
                        </div>
                      ),
                    }]
                  : []),
                ...(template.fields.some((f) => f.key.startsWith("turRep"))
                  ? [{
                      key: "turRep",
                      label: "TUR REP 土耳其代表",
                      children: (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <Input size="small" placeholder="Ad (Name)" value={compliance.turRepName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateCompliance("turRepName", e.target.value)} />
                          <Input size="small" placeholder="Adres (Address)" value={compliance.turRepAddress} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateCompliance("turRepAddress", e.target.value)} />
                        </div>
                      ),
                    }]
                  : []),
              ]}
            />
          )}

          <Text type="secondary" style={{ display: "block", marginTop: 8, fontSize: 11 }}>
            尺寸: {template.width}×{template.height}mm
            {skuCode && ` | 编码: ${skuCode}`}
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
            <iframe
              src={previewUrl + "#toolbar=0&navpanes=0"}
              style={{ width: "100%", height: 380, border: "none", borderRadius: 4, background: "#fff" }}
              title="label-preview"
            />
          ) : (
            <Text type="secondary">加载预览中...</Text>
          )}
        </div>
      </div>
    </Modal>
  );
}
