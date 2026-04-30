# Image2 生图能力升级方案 — `image2-ecommerce-spec-v2`

> 版本：v2 RC1
> 起草：2026-04-29
> 状态：待 Codex 实施
> 适用范围：Image2 生图主入口 + 6 模块 A+ Suite 流水线
> 上一版：`image2-ecommerce-spec-v1`（templateVersion 当前线上版本）

---

## 致 Codex（实施方）

本方案的实施目标是两件事：

1. **提升整体生图质量**——通过显式视觉法则字段、量化评测回路、Provider 路由重新分布，把 6 模块 A+ Suite 的端到端品质（锐度 / 占比 / 调色板一致性 / 安全区清洁度）拉到稳定可量化的水准。
2. **重构 Image2 prompt 结构**——把当前 8 段平铺、注意力衰减严重的 spec，升级为分层带优先级的 v2 schema，并保持 v1 调用方的二进制兼容（v2 字段全部 optional，缺失自动退化为 v1 行为）。

实施时务必遵守：

- 全程 TypeScript strict 模式，所有新类型必须导出
- 新增字段一律 optional，旧调用零破坏，按周次灰度
- 不引入新 npm 依赖（评测用 sharp / canvas + 已有依赖）
- 所有新增中文注释；commit message / PR 描述用简体中文（沿用本仓 CLAUDE.md 约定）
- 每完成一阶段跑 `npm run build` + 自检截图对比，确认线上 6 模块输出无回归

---

## 一、当前 v1 现状诊断

### 1.1 现有结构

`ImageStudioImage2PromptSpec` 定义在 `src/utils/imageStudio.ts:148-158`，8 段平铺：

```typescript
{
  templateVersion: "image2-ecommerce-spec-v1";
  task: string[];
  referenceImages: ImageStudioReferenceImage[];
  productInvariants: string[];
  imageRequirements: string[];
  composition: string[];
  visibleText: ImageStudioVisibleTextSpec;
  forbidden: string[];
  runtime: string[];
}
```

构建器：`buildImage2PromptSpec()` at `src/pages/ImageStudioGPT.tsx:3182-3257`
编译器：`compileImage2PromptSpec()` at `src/pages/ImageStudioGPT.tsx:3417-3445`

### 1.2 6 个结构性问题

| # | 问题 | 实际症状 |
|---|---|---|
| 1 | 8 段平铺、无优先级 | "no-blank panel" / "sharpness" / "clean corner" 反复回归（见 `.codex-tmp/gpt-image-no-blank-*` 与 `gpt-image-sharp-*` 测试 trace） |
| 2 | `composition: string[]` 是软描述 | 占比 / 安全区 / 角度都用自然语言，模型理解不一致，导致主体大小漂 30%+ |
| 3 | `referenceImages` 不区分语义角色 | "Use as product identity reference" 这句太弱，引用图的 lighting/palette/material 往往被丢弃 |
| 4 | `visibleText.mode = none / exact / post_production` 太粗 | 缺第四态：模型可渲染**装饰文字**（如背景流光的 "8KHZ" / "20KG" 大字）但不渲染**承诺文案** |
| 5 | `forbidden: string[]` 把硬违规和 AI 软瑕疵混一起 | "No watermarks" 与 "no plastic-toy look" 都是禁忌，但前者必须杀掉、后者只是引导 — 模型权重不分 |
| 6 | 缺**显式视觉法则锚点** | lighting / palette / material 三件套散落在 composition 字符串里，跨模块一致性无法约束 |

---

## 二、v2 Schema 设计（drop-in 兼容 v1）

### 2.1 类型定义（写入 `src/utils/imageStudio.ts`）

```typescript
// ============================================================
// Image2 Spec v2 — 升级版
// ============================================================

export interface ImageStudioImage2PromptSpec {
  // ===== v1 沿用，向后兼容 =====
  templateVersion: "image2-ecommerce-spec-v1" | "image2-ecommerce-spec-v2";
  task: string[];
  referenceImages: ImageStudioReferenceImage[];   // ← 升级见 2.2
  productInvariants: string[];
  imageRequirements: string[];
  composition: string[];                          // 保留作 freeform 备注兜底
  visibleText: ImageStudioVisibleTextSpec;        // ← 升级见 2.3
  forbidden: string[];                            // 保留作 hard ban 兜底
  runtime: string[];

  // ===== v2 新增的硬字段（全部 optional） =====
  visualLaws?: VisualLawsSpec;
  palette?: PaletteSpec;
  material?: MaterialSpec;
  failureGuards?: FailureGuardSpec;
  styleInheritance?: StyleInheritanceSpec;
  priorityOrder?: PriorityKey[];
}

export type PriorityKey =
  | "productInvariants"
  | "visualLaws"
  | "palette"
  | "material"
  | "visibleText"
  | "failureGuards";

// 视觉法则——几何 + 光线 + 镜头
export interface VisualLawsSpec {
  heroFillRatio: { min: number; max: number };          // e.g. {min: 0.55, max: 0.70}
  composition:
    | "rule-of-thirds"
    | "centered"
    | "diagonal"
    | "frame-within-frame"
    | "symmetrical"
    | "dynamic-asymmetry";
  safeZone: SafeZoneSpec | null;
  cameraAngle:
    | "front"
    | "three-quarter"
    | "top-down-35"
    | "low-three-quarter"
    | "macro"
    | "isometric"
    | "overhead-flat-lay";
  lighting: {
    keyDirection:
      | "upper-left"
      | "upper-right"
      | "top"
      | "rim-back"
      | "side-left"
      | "side-right";
    style:
      | "studio-soft"
      | "dramatic-rim"
      | "golden-hour"
      | "neon-glow"
      | "natural-window"
      | "high-key"
      | "low-key";
    contrastRatio: "low" | "medium" | "high";            // 1:2 / 1:4 / 1:8
  };
  depthOfField: "deep" | "medium" | "shallow" | "macro";
  perspective: "orthographic" | "telephoto-compress" | "wide-environmental";
}

export interface SafeZoneSpec {
  region: "top" | "bottom" | "left" | "right" | "centered" | "none";
  pixelRatio: number;                                    // 0..1，e.g. 0.22 = 22%
  purpose: string;                                       // "for downstream text overlay"
}

// 调色板锁
export interface PaletteSpec {
  dominant: string;                                      // hex e.g. "#0E0E0E"
  secondary: string;
  accent: string;
  neutrals: string[];                                    // ["#FFFFFF", "#888888"]
  forbidden: string[];                                   // 禁止出现的色
  saturation: "muted" | "natural" | "vivid";
}

// 材质锁
export interface MaterialSpec {
  finish:
    | "matte"
    | "satin"
    | "glossy"
    | "translucent"
    | "metallic"
    | "soft-touch"
    | "fabric"
    | "leather"
    | "wood";
  microTexture: string;                                  // freeform e.g. "fine grain plastic"
  reflectionProfile:
    | "anti-glare"
    | "controlled-specular"
    | "mirror-like"
    | "diffuse";
  edgeQuality: "soft-rolled" | "sharp-chamfer" | "rounded" | "beveled";
}

// 软引导 + 量化阈值
export interface FailureGuardSpec {
  aiTells: string[];                                     // 软引导列表
  brandGlyphRedaction: boolean;                          // 强制涂掉参考图里所有品牌标
  bannedReflectionTypes: string[];                       // ["over-symmetric", "neon-halo", "ghost-copy"]
  paletteDeltaELimit: number;                            // 期望色差上限，e.g. 8
  blankPanelMaxRatio: number;                            // 最大空白率 e.g. 0.03
}

// 跨模块风格继承
export interface StyleInheritanceSpec {
  isAnchor: boolean;                                     // hero 模块 = true
  inheritFrom?: string;                                  // 其余模块 = hero 的 module-id
  inheritWeight: number;                                 // 默认 0.65
  lockedFields: ("palette" | "lighting" | "material" | "composition")[];
}

// ============================================================
// 升级 ReferenceImage —— 区分四种语义角色
// ============================================================

export interface ImageStudioReferenceImage {
  index: number;
  label: string;
  role:
    | "product-identity"        // 锁产品本体（形状/色/材质/比例）
    | "style-anchor"            // 锁风格（光线/调色/材质语言）
    | "composition-anchor"      // 锁构图（仅空间比例参考）
    | "negative-example";       // 反例（避免出现这种特征）
  instruction: string;
  sellableComponent?: boolean;
  weight?: number;                                       // 0..1
  scopeInherit?: ReferenceScope[];                       // 应继承哪些维度
  scopeExclude?: ReferenceExclude[];                     // 应排除哪些维度
}

export type ReferenceScope =
  | "shape" | "color" | "material" | "lighting" | "palette" | "layout";
export type ReferenceExclude =
  | "brand-glyph" | "text" | "background" | "props";

// ============================================================
// 升级 VisibleText —— 四态
// ============================================================

export interface ImageStudioVisibleTextSpec {
  mode: "none" | "exact" | "decorative" | "post_production";
  // none           = 完全不出文字（基础图，文字后期合成）
  // exact          = 仅渲染 allowedText 里的精确字符串
  // decorative     = 允许大号品牌氛围字（"8KHZ"/"20KG"）+ allowedText 精确文案
  // post_production = 模型只画占位安全区，不写任何字
  allowedText: string[];
  decorativeAllowed?: string[];                          // mode=decorative 时使用
  rules: string[];
  safeZone?: SafeZoneSpec;                               // mode=post_production 必填
}
```

### 2.2 ReferenceImage 升级要点

- 每张参考图必须显式标 `role`
- `weight` 默认值表（如未填）：
  - `product-identity` → 0.85
  - `style-anchor` → 0.70
  - `composition-anchor` → 0.40
  - `negative-example` → 1.00（作排除强约束）
- `scopeInherit` 与 `scopeExclude` 互斥校验：同一维度不能同时出现在两边

### 2.3 VisibleText 第四态 `decorative` 行为约定

- 允许模型把 `decorativeAllowed` 中的字符串作为**视觉锚点**画大字（可裁切、可渐变、可重叠产品边缘）
- 不允许把 `decorativeAllowed` 字符串当承诺文案（不能加单位 / 边框 / 徽章）
- `allowedText`（精确文案）仍按 `exact` 模式处理：原文渲染，单行优先

---

## 三、Compile 模板重排（注意力衰减优化）

替换 `compileImage2PromptSpec()` 输出。新模板按"首尾偏移效应"分布：**强约束在前后，软引导在中段**。

### 3.1 新输出结构

```
# ROLE
Senior commercial product photographer + 3D retoucher
producing {sizeTarget} e-commerce module images for Temu marketplace.

# TOP-PRIORITY (do not violate, in order)
{priorityOrder.map((k, i) => `${i+1}. ${TITLE_MAP[k]} — ${ONELINE_MAP[k]}`).join("\n")}

# PRODUCT INVARIANTS
{productInvariants.map((s, i) => `(${i+1}) ${s}`).join("\n")}

# REFERENCE IMAGES (typed)
{referenceImages.map(formatTypedRef).join("\n")}

# VISUAL LAWS
- Hero fill ratio: {visualLaws.heroFillRatio.min}-{visualLaws.heroFillRatio.max} of frame.
- Composition: {visualLaws.composition}.
- Safe zone: {visualLaws.safeZone ? `reserve ${pct(visualLaws.safeZone.pixelRatio)}% at ${visualLaws.safeZone.region} for ${visualLaws.safeZone.purpose}` : "none"}.
- Camera: {visualLaws.cameraAngle}. DOF: {visualLaws.depthOfField}.
- Lighting: {visualLaws.lighting.style} — key from {visualLaws.lighting.keyDirection}, contrast {visualLaws.lighting.contrastRatio}.
- Perspective: {visualLaws.perspective}.

# PALETTE
- Dominant {palette.dominant}, Secondary {palette.secondary}, Accent {palette.accent}.
- Neutrals: {palette.neutrals.join(", ")}. Saturation: {palette.saturation}.
- FORBIDDEN COLORS: {palette.forbidden.join(", ")}.

# MATERIAL
- Finish: {material.finish} with {material.microTexture}.
- Reflections: {material.reflectionProfile}. Edges: {material.edgeQuality}.
- Physically-correct micro-roughness — no plastic-toy gloss.

# IMAGE REQUIREMENTS
{imageRequirements.map((s, i) => `(${i+1}) ${s}`).join("\n")}

# VISIBLE TEXT
Mode: {visibleText.mode}.
{branchByMode(visibleText)}
Rules:
{visibleText.rules.map(r => `  - ${r}`).join("\n")}

# COMPOSITION (freeform notes — soft guidance only)
{composition.map((s, i) => `(${i+1}) ${s}`).join("\n")}

# FAILURE GUARDS (soft)
- Avoid AI-tells: {failureGuards.aiTells.join("; ")}.
- Banned reflections: {failureGuards.bannedReflectionTypes.join(", ")}.
- Brand glyph redaction: {failureGuards.brandGlyphRedaction ? "ON" : "OFF"}.
- Palette ΔE limit: {failureGuards.paletteDeltaELimit}.
- Blank panel max ratio: {failureGuards.blankPanelMaxRatio}.

# FORBIDDEN (hard violations — instant reject)
{forbidden.map((s, i) => `(${i+1}) ${s}`).join("\n")}

# RUNTIME
{runtime.map((s, i) => `(${i+1}) ${s}`).join("\n")}
```

### 3.2 `formatTypedRef()` 实现

```typescript
function formatTypedRef(ref: ImageStudioReferenceImage): string {
  const tag = `[${ref.role}]`;
  const weight = ref.weight ?? DEFAULT_WEIGHTS[ref.role];
  const inherit = ref.scopeInherit?.length ? ref.scopeInherit.join("/") : "all";
  const exclude = ref.scopeExclude?.length ? ref.scopeExclude.join("/") : "none";

  if (ref.role === "negative-example") {
    return `${tag} Image ${ref.index} (${ref.label}) — DO NOT REPRODUCE these features: ${(ref.scopeInherit ?? []).join(", ")}.`;
  }

  return `${tag} Image ${ref.index} (${ref.label}) — weight ${weight}, inherit ${inherit}, exclude ${exclude}. Instruction: ${ref.instruction}`;
}
```

### 3.3 `branchByMode()` 实现

```typescript
function branchByMode(spec: ImageStudioVisibleTextSpec): string {
  switch (spec.mode) {
    case "none":
      return "No text of any kind.";
    case "exact":
      return `Render only these exact strings: ${spec.allowedText.join(" | ")}. No additional text.`;
    case "decorative":
      return [
        `Allowed decorative anchors: ${(spec.decorativeAllowed ?? []).join(" | ")}.`,
        `Allowed exact strings: ${spec.allowedText.join(" | ")}.`,
        `Decorative typography: oversized condensed sans-serif, gradient fill, may bleed off canvas.`,
        `Treat decorative anchors as visual elements, not as copy.`,
      ].join("\n  ");
    case "post_production":
      const z = spec.safeZone!;
      return `RENDER NO GLYPH. Reserve ${z.region} ${pct(z.pixelRatio)}% pixel area as text-free safe zone (purpose: ${z.purpose}).`;
  }
}

function pct(r: number): number {
  return Math.round(r * 100);
}
```

### 3.4 v1/v2 兼容分支

```typescript
export function compileImage2PromptSpec(spec: ImageStudioImage2PromptSpec): string {
  if (spec.templateVersion === "image2-ecommerce-spec-v2" && spec.visualLaws) {
    return compileV2(spec);
  }
  return compileV1(spec);          // 旧逻辑保持不动
}
```

---

## 四、Builder 升级

### 4.1 `buildImage2PromptSpec()` 新签名（`src/pages/ImageStudioGPT.tsx:3182`）

```typescript
function buildImage2PromptSpec(
  shotBrief: ImageStudioShotBrief,
  context: ImageStudioContext,
  packPolicy: ImageStudioPackPolicy,
  styleAnchor?: ImageStudioStyleAnchor,
): ImageStudioImage2PromptSpec {
  return {
    templateVersion: "image2-ecommerce-spec-v2",
    task:           buildTaskLines(shotBrief, context),
    referenceImages: buildTypedReferences(shotBrief, styleAnchor),
    productInvariants: PRODUCT_INVARIANTS_V2,
    imageRequirements: buildImageRequirements(shotBrief, packPolicy),

    // 新硬字段
    visualLaws:     buildVisualLaws(shotBrief.imageType),
    palette:        derivePaletteFromBrand(context.brand) ?? DEFAULT_PALETTE,
    material:       deriveMaterial(shotBrief.product),
    failureGuards:  FAILURE_GUARDS_V2,
    styleInheritance: buildStyleInheritance(shotBrief, styleAnchor),

    composition:    buildCompositionFreeform(shotBrief),
    visibleText:    buildVisibleTextSpec(shotBrief, packPolicy),
    forbidden:      FORBIDDEN_HARD_V2,
    runtime:        buildRuntime(shotBrief, context),
    priorityOrder: [
      "productInvariants",
      "visualLaws",
      "palette",
      "material",
      "visibleText",
      "failureGuards",
    ],
  };
}
```

### 4.2 `buildVisualLaws()` 按模块分模板

新建 `src/utils/imageStudio/visualLaws.ts`：

```typescript
export const VISUAL_LAWS_BY_MODULE: Record<string, VisualLawsSpec> = {
  hero: {
    heroFillRatio: { min: 0.60, max: 0.75 },
    composition: "diagonal",
    safeZone: { region: "top", pixelRatio: 0.22, purpose: "headline overlay" },
    cameraAngle: "three-quarter",
    lighting: { keyDirection: "upper-right", style: "dramatic-rim", contrastRatio: "high" },
    depthOfField: "medium",
    perspective: "telephoto-compress",
  },
  features: {
    heroFillRatio: { min: 0.55, max: 0.70 },
    composition: "rule-of-thirds",
    safeZone: { region: "right", pixelRatio: 0.30, purpose: "feature callouts" },
    cameraAngle: "macro",
    lighting: { keyDirection: "side-left", style: "studio-soft", contrastRatio: "medium" },
    depthOfField: "shallow",
    perspective: "telephoto-compress",
  },
  microfiber: {
    heroFillRatio: { min: 0.70, max: 0.85 },
    composition: "centered",
    safeZone: null,
    cameraAngle: "macro",
    lighting: { keyDirection: "rim-back", style: "low-key", contrastRatio: "high" },
    depthOfField: "macro",
    perspective: "orthographic",
  },
  reach_size: {
    heroFillRatio: { min: 0.50, max: 0.65 },
    composition: "rule-of-thirds",
    safeZone: { region: "bottom", pixelRatio: 0.25, purpose: "scale labels" },
    cameraAngle: "three-quarter",
    lighting: { keyDirection: "upper-left", style: "studio-soft", contrastRatio: "medium" },
    depthOfField: "deep",
    perspective: "wide-environmental",
  },
  before_after: {
    heroFillRatio: { min: 0.45, max: 0.55 },
    composition: "frame-within-frame",
    safeZone: { region: "centered", pixelRatio: 0.10, purpose: "divider line" },
    cameraAngle: "front",
    lighting: { keyDirection: "top", style: "high-key", contrastRatio: "medium" },
    depthOfField: "medium",
    perspective: "orthographic",
  },
  summary: {
    heroFillRatio: { min: 0.40, max: 0.55 },
    composition: "symmetrical",
    safeZone: { region: "bottom", pixelRatio: 0.30, purpose: "badge cluster + CTA" },
    cameraAngle: "front",
    lighting: { keyDirection: "upper-right", style: "studio-soft", contrastRatio: "low" },
    depthOfField: "deep",
    perspective: "orthographic",
  },
};

export function buildVisualLaws(imageType: string): VisualLawsSpec {
  return VISUAL_LAWS_BY_MODULE[imageType] ?? VISUAL_LAWS_BY_MODULE.hero;
}
```

### 4.3 `derivePaletteFromBrand()` + Brand Style Presets

新建 `src/config/brandStylePresets.ts`：

```typescript
export interface BrandStylePreset {
  palette: PaletteSpec;
  material: MaterialSpec;
  visualLaws: Partial<VisualLawsSpec>;          // 仅覆盖 lighting / contrast / saturation 相关
}

export const BRAND_PRESETS: Record<string, BrandStylePreset> = {
  "tech-purple-neon": {
    palette: {
      dominant: "#0A0A1A",
      secondary: "#1A0033",
      accent: "#5B2EFF",
      neutrals: ["#FFFFFF", "#B49DFF"],
      forbidden: ["#FF7A00", "#00C8FF"],
      saturation: "vivid",
    },
    material: {
      finish: "matte",
      microTexture: "fine grain plastic",
      reflectionProfile: "controlled-specular",
      edgeQuality: "sharp-chamfer",
    },
    visualLaws: {
      lighting: { keyDirection: "rim-back", style: "neon-glow", contrastRatio: "high" },
    },
  },
  "automotive-orange-tech": {
    palette: {
      dominant: "#0E0E0E",
      secondary: "#5B3A1F",
      accent: "#FF7A00",
      neutrals: ["#FFFFFF", "#00C8FF"],
      forbidden: ["#5B2EFF"],
      saturation: "natural",
    },
    material: {
      finish: "satin",
      microTexture: "anodized aluminum",
      reflectionProfile: "mirror-like",
      edgeQuality: "rounded",
    },
    visualLaws: {
      lighting: { keyDirection: "upper-right", style: "golden-hour", contrastRatio: "medium" },
    },
  },
  "default-clean-studio": {
    palette: {
      dominant: "#FFFFFF",
      secondary: "#F5F5F5",
      accent: "#1A1A1A",
      neutrals: ["#888888", "#CCCCCC"],
      forbidden: [],
      saturation: "natural",
    },
    material: {
      finish: "matte",
      microTexture: "as-shot",
      reflectionProfile: "diffuse",
      edgeQuality: "rounded",
    },
    visualLaws: {
      lighting: { keyDirection: "top", style: "studio-soft", contrastRatio: "low" },
    },
  },
};

export function derivePaletteFromBrand(
  brand?: { presetKey?: string; palette?: PaletteSpec },
): PaletteSpec | undefined {
  if (brand?.palette) return brand.palette;
  if (brand?.presetKey && BRAND_PRESETS[brand.presetKey]) {
    return BRAND_PRESETS[brand.presetKey].palette;
  }
  return undefined;
}

export const DEFAULT_PALETTE: PaletteSpec = BRAND_PRESETS["default-clean-studio"].palette;
```

### 4.4 `buildTypedReferences()` 实现

```typescript
function buildTypedReferences(
  shotBrief: ImageStudioShotBrief,
  styleAnchor?: ImageStudioStyleAnchor,
): ImageStudioReferenceImage[] {
  const refs: ImageStudioReferenceImage[] = [];

  // 1. product-identity（必填，从 shotBrief.product 来）
  refs.push({
    index: refs.length + 1,
    label: shotBrief.product.name ?? "Product reference",
    role: "product-identity",
    instruction: "Preserve exact product shape, color, material, proportions, and brand-defining geometry.",
    sellableComponent: true,
    weight: 0.85,
    scopeInherit: ["shape", "color", "material"],
    scopeExclude: ["text", "background"],
  });

  // 2. style-anchor（如果有 hero 的 styleAnchor，作风格锚）
  if (styleAnchor) {
    refs.push({
      index: refs.length + 1,
      label: "Hero style anchor",
      role: "style-anchor",
      instruction: "Inherit lighting direction, palette, material finish from this image. Ignore subject content.",
      sellableComponent: false,
      weight: 0.70,
      scopeInherit: ["lighting", "palette", "material"],
      scopeExclude: ["brand-glyph", "text", "background", "props"],
    });
  }

  // 3. composition-anchor（来自现有 referenceImages 中标 layout 用途的）
  // ... 视 shotBrief 现有引用图配置而定

  // 4. negative-example（从 packPolicy.negativeExamples 注入）
  // ... 视配置而定

  return refs;
}
```

### 4.5 升级常量

```typescript
// src/utils/imageStudio/constants.ts （新建）

export const PRODUCT_INVARIANTS_V2: string[] = [
  "Preserve the real product geometry, do not redesign or restyle.",
  "Keep brand-defining proportions exactly as in product-identity reference.",
  "Preserve the surface material class (matte/glossy/etc.) — do not 'upgrade' to premium look that contradicts the real product.",
  "Preserve all real labels and seams; do not invent UI marks or fictitious certifications.",
  "Do not add accessories, variants, or scene-stealing props not present in the reference.",
  "Color must match product-identity reference within ΔE ≤ 8.",
  "Do not exaggerate scale or capability beyond what the real product supports.",
  "If reference is partially obscured, infer faithfully — do not invent missing geometry.",
  "Reproduce critical mechanical features (hinges, vents, switches, threads) at correct scale.",
];

export const FAILURE_GUARDS_V2: FailureGuardSpec = {
  aiTells: [
    "no plastic-toy over-glossy skin",
    "no melted or smudged edges",
    "no over-symmetric cinematic reflections",
    "no neon halo bleed beyond intended accent areas",
    "no ghost copies of the subject",
    "no banding gradients",
    "no oversaturated comic-book colors",
    "no fake bokeh disks on flat backgrounds",
  ],
  brandGlyphRedaction: true,
  bannedReflectionTypes: ["over-symmetric", "neon-halo", "ghost-copy", "fake-bokeh-disk"],
  paletteDeltaELimit: 8,
  blankPanelMaxRatio: 0.03,
};

export const FORBIDDEN_HARD_V2: string[] = [
  "No watermarks of any kind.",
  "No fake logos, certifications, or trust badges.",
  "No exaggerated marketing claims rendered as graphics.",
  "No rendered text outside what visibleText.allowedText / decorativeAllowed permits.",
  "No QR codes, app store badges, social media icons.",
  "No competitor brand glyphs or product silhouettes.",
  "No human faces unless explicitly required by imageRequirements.",
  "No price tags, discount stickers, percentage-off marks.",
];
```

---

## 五、Provider 路由 + Style Inheritance Pipeline

### 5.1 Provider 路由表（新建 `src/services/imageProvider/router.ts`）

```typescript
export interface RouteConfig {
  primary: ImageProvider;
  fallback: ImageProvider;
  v2Schema: boolean;                                     // 是否支持 v2 schema 直传
}

export type ImageProvider =
  | "gpt-image-2"
  | "imagen-3"
  | "flux-1.1-pro-ultra"
  | "flux-schnell"
  | "midjourney-v7"
  | "sdxl-refiner";

export const IMAGE2_ROUTING: Record<string, RouteConfig> = {
  hero:         { primary: "imagen-3",          fallback: "flux-1.1-pro-ultra", v2Schema: true  },
  features:     { primary: "flux-1.1-pro-ultra", fallback: "gpt-image-2",        v2Schema: true  },
  microfiber:   { primary: "flux-1.1-pro-ultra", fallback: "sdxl-refiner",       v2Schema: true  },
  reach_size:   { primary: "imagen-3",          fallback: "gpt-image-2",        v2Schema: true  },
  before_after: { primary: "midjourney-v7",     fallback: "flux-1.1-pro-ultra", v2Schema: true  },
  summary:      { primary: "gpt-image-2",       fallback: "flux-schnell",       v2Schema: false },
};

export function routeProvider(
  imageType: string,
  attempt: 0 | 1 | 2 = 0,
): ImageProvider {
  const cfg = IMAGE2_ROUTING[imageType] ?? IMAGE2_ROUTING.summary;
  return attempt === 0 ? cfg.primary : cfg.fallback;
}
```

### 5.2 Provider 适配器接口

```typescript
// src/services/imageProvider/adapters.ts

export interface ProviderAdapter {
  name: ImageProvider;
  generate(spec: ImageStudioImage2PromptSpec, options: GenerateOptions): Promise<GenerateResult>;
}

export interface GenerateOptions {
  size: string;                                          // "1600x1600"
  apiKey: string;
  baseUrl?: string;
  styleAnchorUrl?: string;                               // hero 风格锚
}

export interface GenerateResult {
  imageBase64: string;
  seed?: string;
  metadata: { provider: ImageProvider; model: string; durationMs: number; costUsd: number };
}

// 各家适配器：
// - GptImage2Adapter: 直接喂 v2 模板字符串（grsaiapi /v1/draw/completions）
// - Imagen3Adapter:   v2 模板字符串 + style_reference_image 字段
// - FluxAdapter:      v2 模板字符串 + IP-Adapter weight 配置
// - MidjourneyAdapter: 把 visualLaws/palette/material 压缩 + --sref + --sw 350
// - SdxlAdapter:      拆 positive (visualLaws + palette + material) / negative (forbidden + failureGuards)
```

### 5.3 Style Inheritance 实现

```typescript
async function generateA PlusSuite(
  shotBriefs: ImageStudioShotBrief[],
  context: ImageStudioContext,
): Promise<GenerateResult[]> {
  // Step 1: 先生成 hero 模块，作 style anchor
  const heroBrief = shotBriefs.find(b => b.imageType === "hero")!;
  const heroSpec = buildImage2PromptSpec(heroBrief, context, packPolicy);
  const heroResult = await callProvider(heroSpec, "hero");

  // Step 2: 把 hero 输出作 styleAnchor 传给其余 5 模块
  const styleAnchor: ImageStudioStyleAnchor = {
    url: heroResult.imageUrl,
    seed: heroResult.seed,
    palette: heroSpec.palette!,
    material: heroSpec.material!,
  };

  // Step 3: 并行生成其余 5 模块
  const otherResults = await Promise.all(
    shotBriefs
      .filter(b => b.imageType !== "hero")
      .map(brief => {
        const spec = buildImage2PromptSpec(brief, context, packPolicy, styleAnchor);
        return callProvider(spec, brief.imageType);
      }),
  );

  return [heroResult, ...otherResults];
}
```

---

## 六、量化评测回路

### 6.1 评测器（新建 `automation/eval/image2QA.ts`）

```typescript
export interface Image2QAReport {
  sharpness:        number;                              // Laplacian variance, 期望 > 80
  heroFillRatio:    number;                              // 主体填充比，需落在 spec.visualLaws.heroFillRatio 区间
  paletteDeltaE:    number;                              // 色差，期望 < spec.failureGuards.paletteDeltaELimit
  blankPanelRatio:  number;                              // 白板率，期望 < spec.failureGuards.blankPanelMaxRatio
  safeZoneClean:    boolean | null;                      // 安全区是否无主体侵占
  textIntrusion:    number;                              // OCR 字符数，none/post_production 必须 = 0
  brandGlyphLeak:   string[] | null;                     // 检测到的品牌标，期望空数组
  materialFidelity: number;                              // 材质分类置信度，期望 > 0.7
  passed:           boolean;                             // 综合通过/失败
  failures:         string[];                            // 不通过的具体维度
}

export async function evalImage2Output(
  outputBuf: Buffer,
  spec: ImageStudioImage2PromptSpec,
): Promise<Image2QAReport> {
  // 实现细节：
  // - sharpness: sharp + cv 算子 Laplacian variance
  // - heroFillRatio: sharp + 边缘检测 + bbox 计算
  // - paletteDeltaE: 主色提取 (k-means, k=4) + LAB ΔE 计算
  // - blankPanelRatio: 像素亮度 > 240 且饱和度 < 5 的占比
  // - textIntrusion: tesseract.js OCR
  // - brandGlyphLeak: 与已知品牌标库（用 hash） 做 pHash 匹配
  // - materialFidelity: 复用产品分类模型，材质头
  // ... 详细实现略
}
```

### 6.2 自动重试

```typescript
async function callProviderWithRetry(
  spec: ImageStudioImage2PromptSpec,
  imageType: string,
): Promise<GenerateResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const provider = routeProvider(imageType, attempt as 0 | 1);
    const result = await callProvider(provider, spec);
    const qa = await evalImage2Output(Buffer.from(result.imageBase64, "base64"), spec);

    if (qa.passed) return result;
    console.warn(`[image2QA] attempt ${attempt+1} failed: ${qa.failures.join(", ")}`);
  }
  throw new Error(`image2 generation failed after 3 attempts on ${imageType}`);
}
```

### 6.3 Eval Set 回归测试

```bash
# 新增 npm script
npm run eval:image2 -- --baseline gpt-aplus-suite-v2 --candidate v2-rc1
```

实现：从 `.codex-tmp/gpt-aplus-suite-v2/` 抓 6 张作 baseline，对同样 SKU 跑 v2 schema 出图，并排打分输出 markdown 报告：

```
| Module       | Baseline sharpness | Candidate sharpness | Delta | Verdict |
|--------------|--------------------|---------------------|-------|---------|
| hero         | 76                 | 92                  | +16   | PASS    |
| features     | 82                 | 88                  | +6    | PASS    |
...
```

---

## 七、实施路线（5 周）

| 阶段 | 周期 | 目标 | 产出 |
|---|---|---|---|
| **W0** | 1d | 类型迁移 | `imageStudio.ts` 加 v2 字段（全 optional），`compileImage2PromptSpec` 加 v1/v2 分支 |
| **W0** | 1d | 兼容验证 | 旧调用零破坏，跑 `.codex-tmp/gpt-aplus-suite-v2` 同 SKU 验证 v1 输出无变化 |
| **W1** | 3d | Builder 实施 | `buildVisualLaws()` / `derivePaletteFromBrand()` / `deriveMaterial()` / `buildTypedReferences()` 全量；先只对 hero 模块启用 v2，其余 5 模块保 v1 |
| **W1** | 1d | BrandStylePreset | `src/config/brandStylePresets.ts` 写入 3 套预设（tech-purple-neon / automotive-orange-tech / default-clean-studio） |
| **W2** | 3d | 评测建立 | `automation/eval/image2QA.ts` + Eval Set 抓取 + 基线报告 |
| **W2** | 2d | 回归 CI | `npm run eval:image2` 命令集成到 PR 检查 |
| **W3** | 5d | 6 模块全量切 v2 | 包括 Style Inheritance Pipeline |
| **W4** | 5d | Provider 路由灰度 | 先开 Flux Pro Ultra 30% 流量，观察 7 天评测指标 |
| **W5** | 5d | 全量上线 | Imagen 3 + MJ v7 接入；v1 schema 标记 deprecated；2 个月后删除 |

---

## 八、立刻能落地的最小变更（W0 之前先验证收益）

按 ROI 排序，下面 4 件事 1 天内可全做完，能给出 A/B 数据：

### 8.1 `priorityOrder` 字段

仅在 v1 spec 上加一个 `priorityOrder?: PriorityKey[]` 字段，编译时输出 5 行 TOP-PRIORITY 段落贴到 prompt 第二段。**无需改其他字段**。可在 `.codex-tmp` 跑 5 张同 SKU 对比，量化收益。

### 8.2 `visibleText.mode = decorative` 第四态

仅扩 enum + 在 `branchByMode` 里加一个分支即可。立即解决参考图里 "8KHZ" / "20KG" 类装饰大字的渲染需求。

### 8.3 `referenceImages` typed role

把 `role` 字段从 freeform string 收紧成 union type 不破坏现有调用（运行时收紧，TS 编译期）。

### 8.4 `palette.forbidden` 字段

最小改：在 `composition: string[]` 里塞一行 `"FORBIDDEN COLORS: <list>"`。验收升级 ROI 后再做完整 PaletteSpec 重构。

---

## 九、验收标准

### 9.1 W0 阶段验收

- [ ] `npm run build` 通过，无类型错误
- [ ] 旧调用（v1 spec）输出与 W0 之前完全一致（diff `compileImage2PromptSpec()` 输出）
- [ ] 新增类型全部导出，可在外部 `import { VisualLawsSpec, PaletteSpec, MaterialSpec }` from `@/utils/imageStudio`

### 9.2 W2 阶段验收

- [ ] `npm run eval:image2 -- --baseline gpt-aplus-suite-v2` 跑出 baseline 报告
- [ ] 同 SKU v2 输出在 sharpness / heroFillRatio / paletteDeltaE 至少 2 维优于 baseline
- [ ] 评测自动重试机制：3 次内必出可用图

### 9.3 W5 全量上线验收

- [ ] 6 模块 A+ Suite 端到端跨产品调色板偏差 ΔE < 8
- [ ] 跨 6 张图 lighting 一致性（人眼 + Style Inheritance 验证）
- [ ] OCR 字符侵占率：mode=none/post_production 模块为 0 字符
- [ ] 品牌标泄漏率（brandGlyphLeak）< 1%
- [ ] 平均成本上涨 < 1.4×（vs 当前 gpt-image-2 单通道）

---

## 十、参考资料

- 现有 v1 实现：
  - `src/utils/imageStudio.ts:148-158`（type）
  - `src/pages/ImageStudioGPT.tsx:3182-3257`（builder）
  - `src/pages/ImageStudioGPT.tsx:3417-3445`（compiler）
- 测试 trace：`.codex-tmp/gpt-aplus-suite-v2/`（最近基线）、`gpt-image-sharp-*`、`gpt-image-no-blank-*`（已知失败模式）
- 视觉 DNA 参考：`C:\Users\Administrator\Desktop\新建文件夹 (2)\` 下的产品图（用于 Brand Preset 配色锁的参考来源）
- 提示工程相关：注意力首尾偏移效应（Liu et al. "Lost in the Middle" 2023）

---

## 十一、不在本方案范围内（V3 议题）

以下事项延后至 V3 阶段，不在 v2 实施内：

- 训练自定义 LoRA / IP-Adapter（针对单品牌单类目）
- 自动 ShotBrief 生成（从产品 SKU 反推 shotBrief 内容）
- 多语言文案翻译 + 字体渲染优化
- 视频生成（image2 → video2 扩展）
- C 端用户自定义风格上传

---

**文档结束。**
