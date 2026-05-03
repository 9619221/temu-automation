// 前端镜像：从 auto-image-gen-dev/src/lib/designer 复制的类型
// 保持与后端 schema 同步；只做展示，不做业务逻辑

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SharedDNA {
  palette: {
    primary: string;
    secondary: string;
    accent: string;
    neutral: string;
    text: string;
  };
  mood: string[];
  lighting: {
    style: string;
    direction: string;
    intensity: string;
  };
  typography: {
    headlineFamily: string;
    bodyFamily: string;
    headlineWeight: number;
    caseStyle: string;
  };
  textureKeywords: string[];
  globalForbidden: string[];
}

export type ImageType =
  | "main"
  | "closeup"
  | "dimensions"
  | "lifestyle"
  | "comparison"
  | "variations"
  | "packaging"
  | "usage"
  | "specs"
  | "badge-hero";

export interface TextZone {
  id: string;
  role: "headline" | "subhead" | "pill" | "caption" | "badge" | "price" | "cta";
  bbox: BBox;
  safeZone: BBox;
  maxChars: number;
  alignment: "left" | "center" | "right";
}

export interface PropSlot {
  id: string;
  kind: "anchor-object" | "decor" | "surface" | "background-scene";
  bbox: BBox;
  description: string;
  required: boolean;
}

export interface DesignBrief {
  id: string;
  imageType: ImageType;
  priority: number;
  rationale: string;
  sharedDnaRef: string;
  canvas: { width: number; height: number; aspectRatio: string };
  composition: {
    productBox: BBox;
    productAnchor: string;
    cameraAngle: string;
    focalLength: string;
  };
  textZones: TextZone[];
  propsSlots: PropSlot[];
  fillIns: {
    headline: string | null;
    subhead: string | null;
    pillLabels: string[];
    captions: string[];
    anchorObject: string | null;
  };
  engineDirective: {
    method: "compose" | "ai-regen" | "hybrid";
    compose?: {
      backgroundStyle: string;
      productCutoutSource: string;
      shadow: string;
      overlayTextFromZones: boolean;
    };
    aiRegen?: {
      promptHints: string[];
      referenceImages: string[];
      negativePrompt: string;
    };
  };
  constraints: {
    forbiddenElements: string[];
    textBudget: number;
    maxTextZones: number;
    mustContainAnchor: boolean;
  };
}

export interface AuditReport {
  overallVerdict: "pass" | "pass-with-warnings" | "fail";
  summary: string;
  consistencyChecks: {
    palette: { status: string; note: string };
    typography: { status: string; note: string };
    lighting: { status: string; note: string };
    productAppearance: { status: string; note: string };
    narrativeFlow: { status: string; note: string };
  };
  perSlotIssues?: Array<{
    slot: number;
    severity: "warning" | "blocker";
    issue: string;
    fix: string;
  }>;
  revisionSuggestions?: Array<{
    slot: number;
    field: string;
    currentValue: any;
    suggestedValue: any;
    reason: string;
  }>;
}

export interface DesignerResult {
  ok: boolean;
  sharedDna: SharedDNA | null;
  briefs: DesignBrief[];
  auditReport: AuditReport | null;
  reworkRounds: number;
  warnings: string[];
  errors: string[];
}

export type CameraAngle =
  | "top-down"
  | "45-degree"
  | "eye-level"
  | "low-angle"
  | "high-angle";

export interface TextOverlay {
  headline?: string;
  subhead?: string;
  pillLabels?: string[];
}

export type ImageMode = "edit" | "generate";

export interface ImagePrompt {
  slot: number;
  imageType: string;
  mode: ImageMode;
  cameraAngle: CameraAngle;
  sceneDescription: string;
  mood: string;
  prompt: string;
  textOverlay: TextOverlay | null;
}

export interface ComposedImage {
  slot: number;
  imageType: string;
  dataUrl: string;
  bytes: number;
}
