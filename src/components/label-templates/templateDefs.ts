export interface TemplateField {
  key: string;
  x: number;
  y: number;
  fontSize: number;
  maxWidth: number;
  align?: "left" | "center" | "right";
}

export interface LabelTemplate {
  id: string;
  name: string;
  category: string;
  width: number;
  height: number;
  bgImage?: string;
  fields: TemplateField[];
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
  { key: "turRepName", x: 26, y: 8, fontSize: 6, maxWidth: 72 },
  { key: "turRepAddress", x: 26, y: 16, fontSize: 6, maxWidth: 72 },
  { key: "manufacturer", x: 8, y: 30, fontSize: 5.5, maxWidth: 90 },
  { key: "manufacturerAddress", x: 8, y: 37, fontSize: 5.5, maxWidth: 90 },
  { key: "manufacturerEmail", x: 8, y: 44, fontSize: 5.5, maxWidth: 90 },
  { key: "batchNumber", x: 8, y: 24, fontSize: 5.5, maxWidth: 90 },
  { key: "ecRepName", x: 26, y: 56, fontSize: 5.5, maxWidth: 72 },
  { key: "ecRepAddress", x: 26, y: 64, fontSize: 5.5, maxWidth: 72 },
];

const F_JKS_76: TemplateField[] = [
  ...F_FULL_76,
];

const NONE: TemplateField[] = [];

// --- 模板定义 ---

export const TEMPLATES: LabelTemplate[] = [
  // 独立条码
  { id: "tm", name: "独立条码", category: "条码标签", width: 70, height: 20, bgImage: "tm.png", fields: NONE },

  // 欧盟合规
  { id: "gys72", name: "制造商信息 70×20", category: "欧盟合规", width: 70, height: 20, bgImage: "gys72.png", fields: F_MFR_72 },
  { id: "od72", name: "欧代标签 70×20", category: "欧盟合规", width: 70, height: 20, bgImage: "od72.png", fields: F_ECREP_72 },
  { id: "myod74", name: "制造商+欧代 70×40", category: "欧盟合规", width: 70, height: 40, bgImage: "myod74.png", fields: F_MFR_ECREP_74 },
  { id: "myod76", name: "制造商+欧代+进口商 70×60", category: "欧盟合规", width: 70, height: 60, bgImage: "myod76.png", fields: F_MFR_ECREP_IMP_76 },
  { id: "od76", name: "完整合规 70×60", category: "欧盟合规", width: 70, height: 60, bgImage: "od76.png", fields: F_FULL_76 },
  { id: "spb", name: "商品标签 70×40", category: "欧盟合规", width: 70, height: 40, bgImage: "spb.png", fields: F_SPB },
  { id: "spb76", name: "商品标签 70×60", category: "欧盟合规", width: 70, height: 60, bgImage: "spb76.png", fields: F_FULL_76 },
  { id: "odp", name: "完整合规 100×70", category: "欧盟合规", width: 100, height: 70, bgImage: "odp.png", fields: F_FULL_100 },
  { id: "odps77", name: "完整合规 70×70", category: "欧盟合规", width: 70, height: 70, bgImage: "odps77.png", fields: F_FULL_77 },
  { id: "odfz77", name: "合规+衣物回收 70×70", category: "欧盟合规", width: 70, height: 70, bgImage: "odfz77.png", fields: F_FULL_77 },
  { id: "odfzcz100", name: "合规+洗涤标志 100×100", category: "欧盟合规", width: 100, height: 100, bgImage: "odfzcz100.png", fields: F_FULL_100 },

  // 土耳其合规
  { id: "dlteq", name: "土耳其合规", category: "土耳其合规", width: 100, height: 70, bgImage: "dlteq.png", fields: F_TURK },
  { id: "dlteqfz", name: "土耳其合规(小)", category: "土耳其合规", width: 70, height: 40, bgImage: "dlteqfz.png", fields: F_TURK_SM },
  { id: "dlteqsp", name: "土耳其合规+食品", category: "土耳其合规", width: 100, height: 70, bgImage: "dlteqsp.png", fields: F_TURK },

  // 通达合规 (TUR+EU)
  { id: "tdsp", name: "通达-商品 100×100", category: "通达合规", width: 100, height: 100, bgImage: "tdsp.png", fields: F_TD_100 },
  { id: "tdfz", name: "通达-衣物 100×100", category: "通达合规", width: 100, height: 100, bgImage: "tdfz.png", fields: F_TD_100 },
  { id: "tdpt", name: "通达-平台 100×100", category: "通达合规", width: 100, height: 100, bgImage: "tdpt.png", fields: F_TD_100 },
  { id: "tdfzcz", name: "通达-洗涤标志 100×100", category: "通达合规", width: 100, height: 100, bgImage: "tdfzcz.png", fields: F_TD_100 },
  { id: "tdsp1", name: "通达v2-商品 100×100", category: "通达合规", width: 100, height: 100, bgImage: "tdsp1.png", fields: F_TD_100 },
  { id: "tdfz1", name: "通达v2-衣物 100×100", category: "通达合规", width: 100, height: 100, bgImage: "tdfz1.png", fields: F_TD_100 },
  { id: "tdpt1", name: "通达v2-平台 100×100", category: "通达合规", width: 100, height: 100, bgImage: "tdpt1.png", fields: F_TD_100 },
  { id: "tdfzcz1", name: "通达v2-洗涤标志 100×100", category: "通达合规", width: 100, height: 100, bgImage: "tdfzcz1.png", fields: F_TD_100 },

  // 进口商信息
  { id: "jksEu", name: "EU进口商", category: "进口商信息", width: 70, height: 20, bgImage: "jksEu.png", fields: NONE },
  { id: "jksUk", name: "UK进口商", category: "进口商信息", width: 70, height: 20, bgImage: "jksUk.png", fields: NONE },
  { id: "jksEuUK", name: "EU+UK进口商", category: "进口商信息", width: 70, height: 20, bgImage: "jksEuUK.png", fields: NONE },
  { id: "jksfz76", name: "进口商+衣物 70×60", category: "进口商信息", width: 70, height: 60, bgImage: "jksfz76.png", fields: F_JKS_76 },
  { id: "jkssp76", name: "进口商+食品 70×60", category: "进口商信息", width: 70, height: 60, bgImage: "jkssp76.png", fields: F_JKS_76 },
  { id: "jkspt76", name: "进口商+平台 70×60", category: "进口商信息", width: 70, height: 60, bgImage: "jkspt76.png", fields: F_JKS_76 },

  // 警告标识
  { id: "hbzx", name: "窒息警告+回收", category: "警告标识", width: 70, height: 30, bgImage: "hbzx.png", fields: NONE },

  // 西班牙回收
  { id: "lan", name: "RECICLA 蓝桶(纸板)", category: "西班牙回收", width: 40, height: 40, bgImage: "lan.png", fields: NONE },
  { id: "yellow", name: "RECICLA 黄桶(塑料)", category: "西班牙回收", width: 40, height: 40, bgImage: "yellow.png", fields: NONE },
  { id: "lvs", name: "RECICLA 绿桶(玻璃)", category: "西班牙回收", width: 40, height: 40, bgImage: "lvs.png", fields: NONE },
  { id: "zongs", name: "COMPOSTA 棕桶", category: "西班牙回收", width: 40, height: 40, bgImage: "zongs.png", fields: NONE },

  // TikTok
  { id: "tkod76", name: "TikTok 合规 70×60", category: "TikTok", width: 70, height: 60, bgImage: "tkod76.png", fields: F_FULL_76 },
  { id: "tkspb76", name: "TikTok 商品 70×60", category: "TikTok", width: 70, height: 60, bgImage: "tkspb76.png", fields: F_FULL_76 },

  // WTT
  { id: "wttdfz", name: "WTT-衣物 100×100", category: "WTT合规", width: 100, height: 100, bgImage: "wttdfz.png", fields: F_TD_100 },
  { id: "wttdfzcz", name: "WTT-洗涤标志 100×100", category: "WTT合规", width: 100, height: 100, bgImage: "wttdfzcz.png", fields: F_TD_100 },
  { id: "wttdpt", name: "WTT-平台 100×100", category: "WTT合规", width: 100, height: 100, bgImage: "wttdpt.png", fields: F_TD_100 },
  { id: "wttdsp", name: "WTT-商品 100×100", category: "WTT合规", width: 100, height: 100, bgImage: "wttdsp.png", fields: F_TD_100 },
];

export const TEMPLATE_CATEGORIES = [...new Set(TEMPLATES.map((t) => t.category))];

export function getTemplatesByCategory(category: string): LabelTemplate[] {
  return TEMPLATES.filter((t) => t.category === category);
}
