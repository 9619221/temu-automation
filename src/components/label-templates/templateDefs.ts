export interface TemplateField {
  key: string;
  x: number;
  y: number;
  fontSize: number;
  maxWidth: number;
  align?: "left" | "center" | "right";
  label?: string;
}

export type LabelType = "带进口商信息" | "独立标签" | "条码融合" | "通用";

export interface BarcodeConfig {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LabelTemplate {
  id: string;
  name: string;
  labelType: LabelType;
  width: number;
  height: number;
  bgImage?: string;
  fields: TemplateField[];
  barcode?: BarcodeConfig;
}

// --- 可复用字段布局 ---

const F_MFR_72: TemplateField[] = [
  { key: "manufacturer", x: 22, y: 5.5, fontSize: 5, maxWidth: 46 },
  { key: "manufacturerAddress", x: 22, y: 11, fontSize: 5, maxWidth: 46 },
  { key: "manufacturerEmail", x: 22, y: 17, fontSize: 5, maxWidth: 46 },
];

const F_ECREP_72: TemplateField[] = [
  { key: "batchNumber", x: 20, y: 3.5, fontSize: 5, maxWidth: 48 },
  { key: "ecRepName", x: 20, y: 9, fontSize: 4.5, maxWidth: 48 },
  { key: "ecRepAddress", x: 20, y: 13, fontSize: 4.5, maxWidth: 48 },
  { key: "ecRepEmail", x: 20, y: 17, fontSize: 4.5, maxWidth: 48 },
];

const F_MFR_ECREP_74: TemplateField[] = [
  { key: "manufacturer", x: 24, y: 5, fontSize: 5, maxWidth: 44 },
  { key: "manufacturerAddress", x: 24, y: 11.5, fontSize: 5, maxWidth: 44 },
  { key: "manufacturerEmail", x: 14, y: 17, fontSize: 4.5, maxWidth: 28 },
  { key: "batchNumber", x: 50, y: 17, fontSize: 4.5, maxWidth: 18 },
  { key: "ecRepName", x: 20, y: 24, fontSize: 4.5, maxWidth: 48 },
  { key: "ecRepAddress", x: 20, y: 30, fontSize: 4.5, maxWidth: 48 },
  { key: "ecRepEmail", x: 20, y: 36, fontSize: 4.5, maxWidth: 48 },
];

const F_FULL_76: TemplateField[] = [
  { key: "manufacturer", x: 22, y: 4, fontSize: 5, maxWidth: 46 },
  { key: "manufacturerAddress", x: 22, y: 9.5, fontSize: 5, maxWidth: 46 },
  { key: "manufacturerEmail", x: 14, y: 14.5, fontSize: 4.5, maxWidth: 28 },
  { key: "batchNumber", x: 50, y: 14.5, fontSize: 4.5, maxWidth: 18 },
  { key: "ecRepName", x: 18, y: 24, fontSize: 4.5, maxWidth: 50 },
  { key: "ecRepAddress", x: 18, y: 29, fontSize: 4.5, maxWidth: 50 },
  { key: "ecRepEmail", x: 18, y: 34, fontSize: 4.5, maxWidth: 50 },
];

const F_MFR_ECREP_IMP_76: TemplateField[] = [
  { key: "manufacturer", x: 24, y: 4, fontSize: 5, maxWidth: 44 },
  { key: "manufacturerAddress", x: 24, y: 10, fontSize: 5, maxWidth: 44 },
  { key: "manufacturerEmail", x: 14, y: 15.5, fontSize: 4.5, maxWidth: 28 },
  { key: "batchNumber", x: 50, y: 15.5, fontSize: 4.5, maxWidth: 18 },
  { key: "ecRepName", x: 20, y: 22, fontSize: 4.5, maxWidth: 48 },
  { key: "ecRepAddress", x: 20, y: 27, fontSize: 4.5, maxWidth: 48 },
  { key: "ecRepEmail", x: 20, y: 32, fontSize: 4.5, maxWidth: 48 },
];

const F_FULL_77: TemplateField[] = [
  { key: "batchNumber", x: 22, y: 4, fontSize: 5, maxWidth: 46 },
  { key: "manufacturer", x: 22, y: 10, fontSize: 5, maxWidth: 46 },
  { key: "manufacturerAddress", x: 22, y: 15, fontSize: 5, maxWidth: 46 },
  { key: "manufacturerEmail", x: 22, y: 20, fontSize: 4.5, maxWidth: 46 },
  { key: "ecRepName", x: 18, y: 29, fontSize: 4.5, maxWidth: 50 },
  { key: "ecRepAddress", x: 18, y: 34, fontSize: 4.5, maxWidth: 50 },
  { key: "ecRepEmail", x: 18, y: 38, fontSize: 4.5, maxWidth: 50 },
];

const F_FULL_100: TemplateField[] = [
  { key: "manufacturer", x: 25, y: 8, fontSize: 6, maxWidth: 73 },
  { key: "manufacturerAddress", x: 25, y: 16, fontSize: 6, maxWidth: 73 },
  { key: "manufacturerEmail", x: 16, y: 23, fontSize: 5.5, maxWidth: 40 },
  { key: "batchNumber", x: 62, y: 23, fontSize: 5.5, maxWidth: 36 },
  { key: "ecRepName", x: 24, y: 36, fontSize: 5.5, maxWidth: 74 },
  { key: "ecRepAddress", x: 24, y: 43, fontSize: 5.5, maxWidth: 74 },
  { key: "ecRepEmail", x: 24, y: 49, fontSize: 5.5, maxWidth: 74 },
];

const F_SPB: TemplateField[] = [
  { key: "manufacturer", x: 24, y: 5, fontSize: 5, maxWidth: 44 },
  { key: "manufacturerAddress", x: 24, y: 11, fontSize: 5, maxWidth: 44 },
];

const F_TURK: TemplateField[] = [
  { key: "turRepName", x: 28, y: 6, fontSize: 5.5, maxWidth: 55 },
  { key: "turRepAddress", x: 28, y: 13, fontSize: 5.5, maxWidth: 55 },
  { key: "batchNumber", x: 10, y: 22, fontSize: 5, maxWidth: 73 },
  { key: "manufacturer", x: 10, y: 28, fontSize: 5, maxWidth: 73 },
  { key: "manufacturerAddress", x: 10, y: 34, fontSize: 5, maxWidth: 73 },
  { key: "manufacturerEmail", x: 10, y: 42, fontSize: 5, maxWidth: 73 },
];

const F_TURK_SM: TemplateField[] = [
  { key: "turRepName", x: 22, y: 5, fontSize: 4.5, maxWidth: 46 },
  { key: "turRepAddress", x: 22, y: 10, fontSize: 4.5, maxWidth: 46 },
  { key: "batchNumber", x: 5, y: 15.5, fontSize: 4.5, maxWidth: 63 },
  { key: "manufacturer", x: 5, y: 20, fontSize: 4.5, maxWidth: 63 },
  { key: "manufacturerAddress", x: 5, y: 25, fontSize: 4.5, maxWidth: 63 },
  { key: "manufacturerEmail", x: 5, y: 32, fontSize: 4.5, maxWidth: 63 },
];

const F_TD_100: TemplateField[] = [
  { key: "turRepName", x: 26, y: 5, fontSize: 11, maxWidth: 72, label: "Ad: " },
  { key: "turRepAddress", x: 26, y: 10, fontSize: 11, maxWidth: 72, label: "Adres: " },
  { key: "batchNumber", x: 3, y: 22, fontSize: 10, maxWidth: 95, label: "Batch Number/Seri numarası: " },
  { key: "manufacturer", x: 3, y: 27, fontSize: 10, maxWidth: 95, label: "Manufacturer/Üretici: " },
  { key: "manufacturerAddress", x: 3, y: 32, fontSize: 10, maxWidth: 95, label: "Manufacturer Address/Adres: " },
  { key: "manufacturerEmail", x: 3, y: 44, fontSize: 10, maxWidth: 95, label: "Manufacturer E-mail: " },
  { key: "ecRepName", x: 26, y: 49, fontSize: 10, maxWidth: 72, label: "Name: " },
  { key: "ecRepAddress", x: 26, y: 54, fontSize: 10, maxWidth: 72, label: "Address: " },
  { key: "ecRepEmail", x: 26, y: 61, fontSize: 10, maxWidth: 72, label: "Email: " },
];

const NONE: TemplateField[] = [];

// --- 条码位置预设 ---

const BC_70: BarcodeConfig = { x: 0.5, y: 0.5, w: 69, h: 13 };
const BC_100: BarcodeConfig = { x: 0.5, y: 0.5, w: 99, h: 17 };

// --- 模板定义 ---

export const TEMPLATES: LabelTemplate[] = [
  // ===== 独立标签 =====
  { id: "tm", name: "独立条码（内置西班牙）70*20", labelType: "独立标签", width: 70, height: 20, bgImage: "tm.png", fields: NONE },
  { id: "gys72", name: "制造商信息 70*20", labelType: "独立标签", width: 70, height: 20, bgImage: "gys72.png", fields: F_MFR_72 },
  { id: "od72", name: "欧代标签 70*20", labelType: "独立标签", width: 70, height: 20, bgImage: "od72.png", fields: F_ECREP_72 },
  { id: "myod74", name: "制造商+欧代 70*40", labelType: "独立标签", width: 70, height: 40, bgImage: "myod74.png", fields: F_MFR_ECREP_74 },
  { id: "myod76", name: "欧代+防窒息+环保 70*60", labelType: "独立标签", width: 70, height: 60, bgImage: "myod76.png", fields: F_MFR_ECREP_IMP_76 },
  { id: "od76", name: "完整合规 70*60", labelType: "独立标签", width: 70, height: 60, bgImage: "od76.png", fields: F_FULL_76 },
  { id: "odp", name: "完整合规 100*70", labelType: "独立标签", width: 100, height: 70, bgImage: "odp.png", fields: F_FULL_100 },
  { id: "odps77", name: "完整合规 70*70", labelType: "独立标签", width: 70, height: 70, bgImage: "odps77.png", fields: F_FULL_77 },
  { id: "hbzx", name: "窒息警告+回收 70*30", labelType: "独立标签", width: 70, height: 30, bgImage: "hbzx.png", fields: NONE },
  { id: "myod72", name: "独立标签 欧代 70*20", labelType: "独立标签", width: 70, height: 20, bgImage: "od72.png", fields: F_ECREP_72 },
  { id: "myjksEu72", name: "独立标签 制造商信息 70*20", labelType: "独立标签", width: 70, height: 20, bgImage: "gys72.png", fields: F_MFR_72 },
  { id: "myodp76a", name: "独立标签 欧代+防窒息+环保（小于56mm）70*40", labelType: "独立标签", width: 70, height: 40, bgImage: "od76.png", fields: F_MFR_ECREP_74 },
  { id: "myodp76b", name: "独立标签 欧代+防窒息+食品+环保（小于56mm）70*40", labelType: "独立标签", width: 70, height: 40, bgImage: "od76.png", fields: F_MFR_ECREP_74 },
  { id: "lan", name: "RECICLA 蓝桶（纸板）", labelType: "独立标签", width: 40, height: 40, bgImage: "lan.png", fields: NONE },
  { id: "yellow", name: "RECICLA 黄桶（塑料）", labelType: "独立标签", width: 40, height: 40, bgImage: "yellow.png", fields: NONE },
  { id: "lvs", name: "RECICLA 绿桶（玻璃）", labelType: "独立标签", width: 40, height: 40, bgImage: "lvs.png", fields: NONE },
  { id: "zongs", name: "COMPOSTA 棕桶", labelType: "独立标签", width: 40, height: 40, bgImage: "zongs.png", fields: NONE },

  // ===== 条码融合 =====
  { id: "odfz77", name: "条码融合 欧代+防窒息+纺织+环保 70*70", labelType: "条码融合", width: 70, height: 70, bgImage: "odfz77.png", fields: F_FULL_77, barcode: BC_70 },
  { id: "odfzcz100", name: "条码融合 欧代+防窒息+纺织+成分+环保 100*100", labelType: "条码融合", width: 100, height: 100, bgImage: "odfzcz100.png", fields: F_FULL_100, barcode: BC_100 },
  { id: "myodps77", name: "条码融合 欧代+防窒息+食品+环保（大于56mm）70*70", labelType: "条码融合", width: 70, height: 70, bgImage: "odps77.png", fields: F_FULL_77, barcode: BC_70 },
  { id: "myodfz77", name: "条码融合 欧代+防窒息+纺织+环保（小于56mm）70*70", labelType: "条码融合", width: 70, height: 70, bgImage: "odfz77.png", fields: F_FULL_77, barcode: BC_70 },
  { id: "myodp100", name: "条码融合 欧代+防窒息+环保 100*100", labelType: "条码融合", width: 100, height: 100, bgImage: "odp.png", fields: F_FULL_100, barcode: BC_100 },
  { id: "myodps100", name: "条码融合 欧代+防窒息+食品+环保（大于56mm）100*100", labelType: "条码融合", width: 100, height: 100, bgImage: "odps77.png", fields: F_FULL_100, barcode: BC_100 },
  { id: "myodfz100", name: "条码融合 欧代+防窒息+纺织+环保 100*100", labelType: "条码融合", width: 100, height: 100, bgImage: "odfz77.png", fields: F_FULL_100, barcode: BC_100 },
  { id: "myodfzcz100", name: "条码融合 欧代+防窒息+纺织+成分+环保 100*100", labelType: "条码融合", width: 100, height: 100, bgImage: "odfzcz100.png", fields: F_FULL_100, barcode: BC_100 },
  { id: "myodtd100", name: "条码融合 欧代+土耳其代+防窒息+纺织+成分+环保 100*100", labelType: "条码融合", width: 100, height: 100, bgImage: "odp.png", fields: F_TD_100, barcode: BC_100 },

  // ===== 带进口商信息 =====
  { id: "jksEu", name: "带进口商信息（EU）70*20", labelType: "带进口商信息", width: 70, height: 20, bgImage: "jksEu.png", fields: NONE },
  { id: "jksUk", name: "带进口商信息（UK）70*20", labelType: "带进口商信息", width: 70, height: 20, bgImage: "jksUk.png", fields: NONE },
  { id: "jksEuUK", name: "带进口商信息（EU、UK）70*20", labelType: "带进口商信息", width: 70, height: 20, bgImage: "jksEuUK.png", fields: NONE },
  { id: "myjksEu74", name: "带进口商信息 制造商+条码 70*40", labelType: "带进口商信息", width: 70, height: 40, bgImage: "jksEu.png", fields: NONE },
  { id: "myjksEuUk74", name: "条码融合 带进口商信息（EU+UK）+条码 70*40", labelType: "带进口商信息", width: 70, height: 40, bgImage: "jksEuUK.png", fields: NONE },
  { id: "spb", name: "商品标签 带进口商 70*40", labelType: "带进口商信息", width: 70, height: 40, bgImage: "spb.png", fields: F_SPB },
  { id: "spb76", name: "商品标签 带进口商+欧代 70*60", labelType: "带进口商信息", width: 70, height: 60, bgImage: "spb76.png", fields: F_FULL_76 },
  { id: "jksfz76", name: "带进口商信息（EU、UK）+欧代+防窒息+纺织+环保 70*60", labelType: "带进口商信息", width: 70, height: 60, bgImage: "jksfz76.png", fields: F_FULL_76 },
  { id: "jkssp76", name: "带进口商信息（EU、UK）+欧代+防窒息+食品+环保 70*60", labelType: "带进口商信息", width: 70, height: 60, bgImage: "jkssp76.png", fields: F_FULL_76 },
  { id: "jkspt76", name: "带进口商信息（EU、UK）+欧代+防窒息+纺织+环保 70*60", labelType: "带进口商信息", width: 70, height: 60, bgImage: "jkspt76.png", fields: F_FULL_76 },
  { id: "jksfz77", name: "条码融合 带进口商信息（EU、UK）+欧代+防窒息+纺织+环保 70*70", labelType: "带进口商信息", width: 70, height: 70, bgImage: "odfz77.png", fields: F_FULL_77, barcode: BC_70 },

  // ===== 通用 =====
  { id: "dlteq", name: "土耳其合规 100*70", labelType: "通用", width: 100, height: 70, bgImage: "dlteq.png", fields: F_TURK },
  { id: "dlteq74", name: "土耳其合规 70*40", labelType: "通用", width: 70, height: 40, bgImage: "dlteq.png", fields: F_TURK_SM },
  { id: "dlteqfz", name: "土耳其合规（小）70*40", labelType: "通用", width: 70, height: 40, bgImage: "dlteqfz.png", fields: F_TURK_SM },
  { id: "dlteqsp", name: "土耳其合规+食品 100*70", labelType: "通用", width: 100, height: 70, bgImage: "dlteqsp.png", fields: F_TURK },
  { id: "tdbase", name: "【通用】条码融合 带进口商信息（EU、UK）+欧代+土耳其代+防窒息+环保 100*100", labelType: "通用", width: 100, height: 100, bgImage: "tdpt.png", fields: F_TD_100, barcode: BC_100 },
  { id: "tdsp", name: "条码融合 带进口商信息（EU、UK）+欧代+土耳其代+防窒息+食品+环保 100*100", labelType: "通用", width: 100, height: 100, bgImage: "tdsp.png", fields: F_TD_100, barcode: BC_100 },
  { id: "tdfz", name: "条码融合 带进口商信息（EU、UK）+欧代+土耳其代+防窒息+纺织+环保 100*100", labelType: "通用", width: 100, height: 100, bgImage: "tdfz.png", fields: F_TD_100, barcode: BC_100 },
  { id: "tdpt", name: "条码融合 带进口商信息（EU、UK）+欧代+土耳其代+防窒息+纺织+环保 100*100", labelType: "通用", width: 100, height: 100, bgImage: "tdpt.png", fields: F_TD_100, barcode: BC_100 },
  { id: "tdfzcz", name: "条码融合 带进口商信息（EU、UK）+欧代+土耳其代+防窒息+纺织+成分+环保 100*100", labelType: "通用", width: 100, height: 100, bgImage: "tdfzcz.png", fields: F_TD_100, barcode: BC_100 },
  { id: "tdsp1", name: "【通用】条码融合 带进口商信息（EU、UK）+欧代+土耳其代+食品+环保 100*100", labelType: "通用", width: 100, height: 100, bgImage: "tdsp1.png", fields: F_TD_100, barcode: BC_100 },
  { id: "tdfz1", name: "【通用】条码融合 带进口商信息（EU、UK）+欧代+土耳其代+纺织+环保 100*100", labelType: "通用", width: 100, height: 100, bgImage: "tdfz1.png", fields: F_TD_100, barcode: BC_100 },
  { id: "tdpt1", name: "【通用】条码融合 带进口商信息（EU、UK）+欧代+土耳其代+纺织+环保 100*100", labelType: "通用", width: 100, height: 100, bgImage: "tdpt1.png", fields: F_TD_100, barcode: BC_100 },
  { id: "tdfzcz1", name: "【通用】条码融合 带进口商信息（EU、UK）+欧代+土耳其代+纺织+成分+环保 100*100", labelType: "通用", width: 100, height: 100, bgImage: "tdfzcz1.png", fields: F_TD_100, barcode: BC_100 },
  { id: "wttdfz", name: "WTT 带进口商+纺织 100*100", labelType: "通用", width: 100, height: 100, bgImage: "wttdfz.png", fields: F_TD_100, barcode: BC_100 },
  { id: "wttdfzcz", name: "WTT 带进口商+纺织+成分 100*100", labelType: "通用", width: 100, height: 100, bgImage: "wttdfzcz.png", fields: F_TD_100, barcode: BC_100 },
  { id: "wttdpt", name: "WTT 带进口商+纺织 100*100", labelType: "通用", width: 100, height: 100, bgImage: "wttdpt.png", fields: F_TD_100, barcode: BC_100 },
  { id: "wttdsp", name: "WTT 带进口商+食品 100*100", labelType: "通用", width: 100, height: 100, bgImage: "wttdsp.png", fields: F_TD_100, barcode: BC_100 },
  { id: "tmyodtdfz100", name: "【通用】条码融合 带进口商+欧代+土耳其代+防窒息+纺织+成分+环保 100*100", labelType: "通用", width: 100, height: 100, bgImage: "tdfzcz1.png", fields: F_TD_100, barcode: BC_100 },
  { id: "wttmyodtdsp100", name: "【无土耳其警示】条码融合 带进口商+欧代+土耳其代+防窒息+纺织+环保 100*100", labelType: "通用", width: 100, height: 100, bgImage: "wttdfz.png", fields: F_TD_100, barcode: BC_100 },
  { id: "tkod76", name: "TikTok 合规 70*60", labelType: "通用", width: 70, height: 60, bgImage: "tkod76.png", fields: F_FULL_76 },
  { id: "tkspb76", name: "TikTok 商品 70*60", labelType: "通用", width: 70, height: 60, bgImage: "tkspb76.png", fields: F_FULL_76 },
];

export const LABEL_TYPES: LabelType[] = ["带进口商信息", "独立标签", "条码融合", "通用"];
export const SIZE_FILTERS = ["70*20", "70*40", "70*60", "70*70", "100*100"] as const;

export function getSizeLabel(t: LabelTemplate): string {
  return `${t.width}*${t.height}`;
}

export function filterTemplates(
  sizeFilter: string | null,
  typeFilter: string | null,
  search: string,
  favIds: string[],
  showFavorites: boolean,
): LabelTemplate[] {
  let list: LabelTemplate[] = TEMPLATES;
  if (showFavorites) list = list.filter((t) => favIds.includes(t.id));
  if (sizeFilter) list = list.filter((t) => getSizeLabel(t) === sizeFilter);
  if (typeFilter) list = list.filter((t) => t.labelType === typeFilter);
  if (search.trim()) {
    const kw = search.trim().toLowerCase();
    list = list.filter((t) => t.name.toLowerCase().includes(kw) || t.id.toLowerCase().includes(kw));
  }
  return list;
}
