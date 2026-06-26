const { jsPDF } = require("jspdf");
const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage } = require("canvas");

async function main() {
  // We'll re-render at 3x scale (300 DPI equivalent) directly to canvas
  const SCALE = 3;
  const W = 100 * SCALE; // 300px for 100mm
  const H = 100 * SCALE;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // White background
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, W, H);

  // Load background image
  const bgPath = path.join(__dirname, "public", "label-templates", "tdpt.png");
  const bgImg = await loadImage(bgPath);

  const BC_H = 17;
  const yOffset = BC_H + 0.5; // 17.5mm

  // Draw background at 78.5mm height starting from yOffset
  const bgY = yOffset * SCALE;
  const bgH = 78.5 * SCALE;
  ctx.drawImage(bgImg, 0, bgY, W, bgH);

  // Draw barcode area border
  ctx.strokeStyle = "black";
  ctx.lineWidth = 0.3 * SCALE;
  ctx.strokeRect(0.5 * SCALE, 0.5 * SCALE, 99 * SCALE, 17 * SCALE);

  // Draw text values
  ctx.fillStyle = "black";
  ctx.textBaseline = "alphabetic";

  const fieldValues = {
    turRepName: "TRUBRIDGE DANIŞMANLIK LİMİTED ŞİRKETİ",
    turRepAddress: "SİRİNEVLER MAH. İNCESU SOK. CİMEN APT. NO:24 İÇ KAPI NO:2 BAHÇELİEVLER / İSTANBUL, BAHÇELİEVLER, İSTANBUL, Türkiye, 34188",
    batchNumber: "2509220029",
    manufacturer: "Xipingxianyichenshangmao Co., Ltd.",
    manufacturerAddress: "No. 85, 150 meters north of the intersection of Longquan Avenue and Donghou Street, Xiping County, Zhumadian City, Henan Province, Zhumadian, Henan, CN(China)",
    manufacturerEmail: "tn002hyt@163.com",
    ecRepName: "XDH Tech",
    ecRepAddress: "2 Rue Coysevox Bureau 3, LYON, RHONE, 69001, France, LYON, RHONE, FR(France)",
    ecRepEmail: "xdh.tech@outlook.com",
  };

  const defs = [
    { key: "turRepName", vFs: 7.8, fX: 28.2, vY: 22 },
    { key: "turRepAddress", vFs: 7.8, fX: 33.8, vY: 25.3 },
    { key: "batchNumber", vFs: 8, fX: 42.2, vY: 36.1 },
    { key: "manufacturer", vFs: 8, fX: 31.5, vY: 40.6 },
    { key: "manufacturerAddress", vFs: 6.5, fX: 41.5, vY: 44.6 },
    { key: "manufacturerEmail", vFs: 7, fX: 29.8, vY: 53.1 },
    { key: "ecRepName", vFs: 7.8, fX: 34.3, vY: 57 },
    { key: "ecRepAddress", vFs: 6.8, fX: 36.2, vY: 60.3 },
    { key: "ecRepEmail", vFs: 8, fX: 34.5, vY: 69 },
  ];

  for (const d of defs) {
    const val = fieldValues[d.key];
    if (!val) continue;
    const fsPx = d.vFs * SCALE * 0.75; // approximate pt to px at this scale
    ctx.font = `bold ${fsPx}px sans-serif`;
    ctx.fillText(val, d.fX * SCALE, d.vY * SCALE);
  }

  // Save as PNG
  const out = path.join(__dirname, "test-label-v5-preview.png");
  fs.writeFileSync(out, canvas.toBuffer("image/png"));
  console.log("Preview saved to:", out);
}

main().catch(console.error);
