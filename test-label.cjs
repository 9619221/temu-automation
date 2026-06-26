const { jsPDF } = require("jspdf");
const fs = require("fs");
const path = require("path");
const { createCanvas } = require("canvas");
const JsBarcode = require("jsbarcode");

const fontPath = path.join(__dirname, "public", "fonts", "NotoSansSC-Bold.ttf");
const fontData = fs.readFileSync(fontPath).toString("base64");
const bgPath = path.join(__dirname, "public", "label-templates", "tdpt.png");
const bgData = "data:image/png;base64," + fs.readFileSync(bgPath).toString("base64");

const fieldValues = {
  turRepName: "TRUBRIDGE DANIŞMANLIK LİMİTED ŞİRKETİ",
  turRepAddress: "SİRİNEVLER MAH. İNCESU SOK. CİMEN APT. NO:24 İÇ KAPI NO:2 BAHÇELİEVLER / İSTANBUL, BAHÇELİEVLER, İSTANBUL, TR(Turkey)",
  batchNumber: "028",
  manufacturer: "Xipingxianyichenshangmao Co., Ltd.",
  manufacturerAddress: "No. 85, 150 meters north of the intersection of Longquan Avenue and Donghou Street, Xiping County, Zhumadian City, Henan Province, Zhumadian, Henan, CN(China)",
  manufacturerEmail: "tn002hyt@163.com",
  ecRepName: "XDH Tech",
  ecRepAddress: "2 Rue Coysevox Bureau 3, LYON, RHONE, 69001, France, 2 Rue Coysevox Bureau 3, LYON, RHONE, 69001, France, LYON, RHONE, FR(France)",
  ecRepEmail: "xdh.tech@outlook.com",
};

function generateBarcodeDataUrl(code) {
  const canvas = createCanvas(400, 100);
  try {
    JsBarcode(canvas, code, { format: "CODE128", width: 2, height: 40, displayValue: false, margin: 0 });
    return canvas.toDataURL("image/png");
  } catch { return null; }
}

function gululuFitText(doc, text, firstW, contW, maxLines, startFs) {
  let fs = startFs;
  while (fs > 2) {
    doc.setFontSize(fs);
    const firstLines = doc.splitTextToSize(text, firstW);
    if (firstLines.length <= 1) return [{ text: firstLines[0] || text, fontSize: fs }];
    const remain = firstLines.slice(1).join(" ");
    const contLines = doc.splitTextToSize(remain, contW);
    const all = [firstLines[0], ...contLines];
    if (all.length <= maxLines) return all.map(t => ({ text: t, fontSize: fs }));
    fs -= 0.3;
  }
  doc.setFontSize(fs);
  const firstLines = doc.splitTextToSize(text, firstW);
  const remain = firstLines.slice(1).join(" ");
  const contLines = remain ? doc.splitTextToSize(remain, contW) : [];
  return [firstLines[0], ...contLines].slice(0, maxLines).map(t => ({ text: t, fontSize: fs }));
}

const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: [100, 100] });
doc.addFileToVFS("NotoSansSC-Bold.ttf", fontData);
doc.addFont("NotoSansSC-Bold.ttf", "NotoSansSC", "bold");

// Background image — exact gululu params
doc.addImage(bgData, "PNG", -0.1, 15.9, 100.2, 94.7);

// Barcode area
const bc = { x: 0.5, y: 0.5, w: 99, h: 17 };
doc.setFillColor(255, 255, 255);
doc.rect(bc.x, bc.y, bc.w, bc.h, "F");
doc.setDrawColor(0);
doc.setLineWidth(0.3);
doc.rect(bc.x, bc.y, bc.w, bc.h);
doc.setFont("NotoSansSC", "bold");
doc.setFontSize(6.5);
doc.text("2509220029", bc.x + 1.5, bc.y + 3.5);
doc.setFontSize(5.5);
doc.text("Light Green", bc.x + bc.w - 1.5, bc.y + 3.5, { align: "right" });
const barcodeUrl = generateBarcodeDataUrl("2509220029");
if (barcodeUrl) {
  doc.addImage(barcodeUrl, "PNG", bc.x + 3, bc.y + 5, bc.w - 6, bc.h - 9.5);
}
doc.setFontSize(7);
doc.text("15808933212", bc.x + 1.5, bc.y + bc.h - 1.5);
doc.text("Made in China", bc.x + bc.w - 1.5, bc.y + bc.h - 1.5, { align: "right" });

// Values only — labels come from background image
doc.setFont("NotoSansSC", "bold");

const defs = [
  { key: "turRepName", lbl: "Ad:", lFs: 9, lX: 22.8, lY: 20.85, drawLabel: true, vFs: 7.8, fw: 70, cw: 70, ml: 2, fX: 28.2, cX: 22.8, vY: 21.5, sp: 2.7, adj: 1.9 },
  { key: "turRepAddress", lbl: "Adres:", lFs: 9, lX: 22.8, lY: 23.95, drawLabel: true, vFs: 7.8, fw: 65, cw: 75.5, ml: 3, fX: 33.8, cX: 22.8, vY: 24.8, sp: 2.75, adj: 1.9 },
  { key: "batchNumber", vFs: 8, fw: 20, cw: 16, ml: 1, fX: 42.2, cX: 42.2, vY: 35.6, sp: 1.4, adj: 1.9 },
  { key: "manufacturer", vFs: 8, fw: 67, cw: 67, ml: 1, fX: 31.5, cX: 31.5, vY: 40.1, sp: 1.4, adj: 1.9 },
  { key: "manufacturerAddress", vFs: 6.5, fw: 55, cw: 95, ml: 3, fX: 41.5, cX: 2.5, vY: 44.1, sp: 2.75, adj: 2.2 },
  { key: "manufacturerEmail", vFs: 7, fw: 80, cw: 40, ml: 1, fX: 29.8, cX: 29.8, vY: 52.6, sp: 1.4, adj: 1.9 },
  { key: "ecRepName", vFs: 7.8, fw: 62, cw: 40, ml: 1, fX: 34.3, cX: 34.3, vY: 56.5, sp: 1.4, adj: 1.9 },
  { key: "ecRepAddress", vFs: 6.8, fw: 62.3, cw: 70.8, ml: 3, fX: 36.2, cX: 25.2, vY: 59.8, sp: 2.75, adj: 1.9 },
  { key: "ecRepEmail", vFs: 8, fw: 70, cw: 70, ml: 1, fX: 34.5, cX: 34.5, vY: 68.5, sp: 1.4, adj: 1.9 },
];

for (const d of defs) {
  const val = fieldValues[d.key] || "";
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

const outPath = path.join(__dirname, "test-label-v8b.pdf");
fs.writeFileSync(outPath, Buffer.from(doc.output("arraybuffer")));
console.log("PDF saved to:", outPath);
