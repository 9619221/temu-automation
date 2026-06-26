"use strict";

// 出库中心送仓发货「官方 API 化」。
//
// 复用 temuOpenApiClient.callOpenApi；凭证按 mall_id 从 erp_temu_openapi_auth 取。
//
// 第一阶段（只读，零风险）：
//   - bg.shiporder.receiveaddressv2.get  大仓收货地址（按备货单 WB 号，= 创建发货单的必填依赖）
//   - bg.mall.address.get                本店发货地址列表（创建发货单选「从哪发」）
//
// 第二阶段（写接口，完整发货链路）：
//   - bg.shiporder.staging.add           加入发货台（取收货地址的前置：不加发货台 receiveaddressv2 报「存在不可发货的订单」）
//   - bg.shiporderv3.create              创建发货单（生成 FH 单，可撤销，不真发货）
//   - bg.shiporder.cancel                撤销发货单
//   - bg.logistics.company.get           快递公司字典（真发货选快递）
//   - bg.shiporder.packing.match         发货前校验
//   - bg.shiporder.packing.send          物流下单（生成 EB 运单，真发货、不可逆）
//
// ⚠️ create 的请求结构「与官方文档缩进对不上」，靠真实试错确定（2026-06-04 验证）：
//   receiveAddressInfo 在 group 顶层（跟 subWarehouseId 同级）；
//   packageInfos 在 deliveryOrderCreateInfos 层（跟 subPurchaseOrderSn 同级）；
//   两者都比文档暗示的层级「高一层」。放错层会报「收货地址/包裹列表不可为空」。

const { callOpenApi, signOpenApi } = require("../temuOpenApiClient.cjs");

// 按 mall_id 取该店官方调用凭证（app_secret 优先用表里存的，回退环境变量）。
function getMallShipCreds(db, mallId) {
  const auth = db.prepare(
    "SELECT app_key, app_secret, access_token, region FROM erp_temu_openapi_auth " +
    "WHERE mall_id = ? AND status = 'active' AND access_token IS NOT NULL AND access_token != ''",
  ).get(String(mallId));
  if (!auth) throw new Error(`店铺 ${mallId} 未绑定官方授权或 token 失效，无法取发货信息`);
  const appSecret = auth.app_secret || process.env.TEMU_OPENAPI_APP_SECRET || "";
  if (!appSecret) throw new Error(`店铺 ${mallId} 缺少 app_secret，无法调官方接口`);
  return { appKey: auth.app_key, appSecret, accessToken: auth.access_token, region: auth.region || "CN" };
}

// 调一个官方接口，success!=true 时抛错（带 errorCode）。
async function callShipApi(creds, type, bizParams = {}) {
  const region = /^bg\.(glo|qtg)\./.test(type) ? "PA" : creds.region;
  const r = await callOpenApi({ ...creds, region, type, bizParams });
  const body = r && r.response;
  if (!body || body.success !== true) {
    const err = new Error((body && body.errorMsg) || `${type} 调用失败`);
    err.errorCode = body && body.errorCode;
    throw err;
  }
  return body.result;
}

// 发货信息预览：大仓收货地址(按 WB 备货单) + 本店发货地址。纯只读，绝不发货。
// 单个接口失败只记录到 *Error 字段、不影响另一个，便于前端部分展示。
async function getOfficialShipPreview({ db, mallId, subPurchaseOrderSn }) {
  const creds = getMallShipCreds(db, mallId);
  const out = {
    mallId: String(mallId),
    subPurchaseOrderSn: subPurchaseOrderSn ? String(subPurchaseOrderSn) : null,
    receiveWarehouse: null,
    sendAddresses: [],
  };

  // 1. 大仓收货地址（需 WB 备货单号；只有「待发货」状态的单能取到，其余报业务错）。
  if (out.subPurchaseOrderSn) {
    try {
      const res = await callShipApi(creds, "bg.shiporder.receiveaddressv2.get", {
        subPurchaseOrderSnList: [out.subPurchaseOrderSn],
      });
      const grp = ((res && res.subPurchaseReceiveAddressGroups) || [])[0];
      const a = grp && grp.receiveAddressInfo;
      if (a) {
        out.receiveWarehouse = {
          subWarehouseId: grp.subWarehouseId != null ? String(grp.subWarehouseId) : null,
          receiverName: a.receiverName || null,
          phone: a.phone || null,
          provinceName: a.provinceName || null,
          cityName: a.cityName || null,
          districtName: a.districtName || null,
          detailAddress: a.detailAddress || null,
          provinceCode: a.provinceCode != null ? a.provinceCode : null,
          cityCode: a.cityCode != null ? a.cityCode : null,
          districtCode: a.districtCode != null ? a.districtCode : null,
        };
      }
    } catch (e) {
      out.receiveWarehouseError = e.message;
    }
  }

  // 2. 本店发货地址列表。
  try {
    const res = await callShipApi(creds, "bg.mall.address.get", {});
    const list = Array.isArray(res) ? res : (res && typeof res === "object" ? Object.values(res) : []);
    out.sendAddresses = list
      .filter((a) => a && typeof a === "object")
      .map((a) => ({
        id: a.id != null ? String(a.id) : null,
        isDefault: Boolean(a.isDefault),
        provinceName: a.provinceName || null,
        cityName: a.cityName || null,
        districtName: a.districtName || null,
        addressDetail: a.addressDetail || a.detailAddress || null,
        addressLabel: a.addressLabel || null,
      }));
  } catch (e) {
    out.sendAddressesError = e.message;
  }

  return out;
}

// ── 第二阶段：写接口（完整发货链路） ──────────────────────────────────

// 规整前端传入的发货 SKU 列表 → [{ productSkuId:Number, qty:Number }]
function normalizeShipSkus(skuList) {
  if (!Array.isArray(skuList) || skuList.length === 0) throw new Error("缺少发货 SKU 列表");
  return skuList.map((s) => {
    const productSkuId = Number(s.productSkuId != null ? s.productSkuId : s.skuId);
    const qty = Number(s.qty != null ? s.qty : (s.deliverSkuNum != null ? s.deliverSkuNum : s.skuNum));
    if (!productSkuId || !(qty > 0)) throw new Error(`发货 SKU 非法：${JSON.stringify(s)}`);
    return { productSkuId, qty };
  });
}

// 从发货台取 SKU 明细（含展示信息），供前端包裹编辑器使用。先 staging.add（幂等）再 staging.get。
async function fetchStagingSkusDetailed({ db, mallId, subPurchaseOrderSn }) {
  const creds = getMallShipCreds(db, mallId);
  const wb = String(subPurchaseOrderSn);
  await callShipApi(creds, "bg.shiporder.staging.add", {
    joinInfoList: [{ deliveryAddressType: 4, subPurchaseOrderSn: wb }],
  }).catch(() => {});
  for (let pageNo = 1; pageNo <= 20; pageNo++) {
    const res = await callShipApi(creds, "bg.shiporder.staging.get", { pageSize: 50, pageNo });
    const list = (res && res.list) || [];
    const hit = list.find(
      (it) => it && it.subPurchaseOrderBasicVO && String(it.subPurchaseOrderBasicVO.subPurchaseOrderSn) === wb,
    );
    if (hit) {
      return ((hit.orderDetailVOList) || [])
        .map((d) => ({
          productSkuId: Number(d.productSkuId),
          qty: Number(d.productSkuPurchaseQuantity),
          skuName: d.productName || d.skuName || "",
          spec: d.productSkuSpec || d.spec || "",
          thumbUrl: d.thumbUrl || d.skuImgUrl || "",
        }))
        .filter((it) => it.productSkuId && it.qty > 0);
    }
    if (list.length < 50) break;
  }
  return [];
}

// 从发货台(staging.get)自动取某备货单的 SKU + 待发数量（前端未显式指定 SKU 时用）。
// 遍历分页找到目标 WB 的 orderDetailVOList，qty 取 productSkuPurchaseQuantity（采购数量=待发量）。
async function fetchStagingSkus(creds, wb) {
  for (let pageNo = 1; pageNo <= 20; pageNo++) {
    const res = await callShipApi(creds, "bg.shiporder.staging.get", { pageSize: 50, pageNo });
    const list = (res && res.list) || [];
    const hit = list.find(
      (it) => it && it.subPurchaseOrderBasicVO && String(it.subPurchaseOrderBasicVO.subPurchaseOrderSn) === wb,
    );
    if (hit) {
      return ((hit.orderDetailVOList) || [])
        .map((d) => ({ productSkuId: Number(d.productSkuId), qty: Number(d.productSkuPurchaseQuantity) }))
        .filter((it) => it.productSkuId && it.qty > 0);
    }
    if (list.length < 50) break; // 已到最后一页
  }
  return [];
}

// 加入发货台（单个备货单，「加入发货台」独立按钮用）。
// 已加入(errorCode 60001)返回 alreadyIn=true 无害；状态不对(60004 非已接单待发货)等其它错误抛出。
async function stagingAddOfficial({ db, mallId, subPurchaseOrderSn, deliveryAddressType = 4 }) {
  const creds = getMallShipCreds(db, mallId);
  const wb = subPurchaseOrderSn ? String(subPurchaseOrderSn) : "";
  if (!wb) throw new Error("缺少备货单号 subPurchaseOrderSn");
  const addRes = await callShipApi(creds, "bg.shiporder.staging.add", {
    joinInfoList: [{ deliveryAddressType: Number(deliveryAddressType) || 4, subPurchaseOrderSn: wb }],
  });
  const errs = (addRes && addRes.joinErrorList) || [];
  const fatal = errs.filter((e) => e && Number(e.errorCode) !== 60001);
  if (fatal.length) throw new Error(fatal[0].errorMsg || `加入发货台失败(${fatal[0].errorCode})`);
  return { subPurchaseOrderSn: wb, alreadyIn: errs.some((e) => e && Number(e.errorCode) === 60001) };
}

// 按备货单号查已有的发货单号（shiporderv2.get + subPurchaseOrderSn 单数参数，重试 3 次）。
async function lookupDeliveryOrderSn({ db, mallId, subPurchaseOrderSn }) {
  const creds = getMallShipCreds(db, mallId);
  const wb = String(subPurchaseOrderSn);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await callShipApi(creds, "bg.shiporderv2.get", { pageSize: 10, pageNo: 1, subPurchaseOrderSn: wb });
      const hit = ((r && r.list) || []).find((it) => it && it.deliveryOrderSn);
      if (hit) {
        return {
          deliveryOrderSn: String(hit.deliveryOrderSn),
          deliveryAddressId: hit.deliveryAddressId ? String(hit.deliveryAddressId) : null,
          subWarehouseId: hit.subWarehouseId ? String(hit.subWarehouseId) : null,
        };
      }
      break;
    } catch (e) {
      console.log("[lookupDeliveryOrderSn] attempt", attempt + 1, "error:", e.errorCode, e.message);
      if (attempt < 2) await new Promise((r) => setTimeout(r, 500));
    }
  }
  return { deliveryOrderSn: null };
}

// 创建发货单：staging.add（确保在发货台）→ receiveaddressv2（取收货地址+子仓）→
// mall.address（取发货地址 ID）→ shiporderv3.create（按验证出的正确结构）。
// 生成 FH 发货单，可撤销、不真发货。返回 { deliveryOrderSn, deliveryOrders, subWarehouseId, deliveryAddressId }。
async function createOfficialShipOrder({ db, mallId, subPurchaseOrderSn, skuList, deliveryAddressType = 4, deliveryAddressId = null, packageCount = 1, packages: rawPackages = null }) {
  const creds = getMallShipCreds(db, mallId);
  const wb = subPurchaseOrderSn ? String(subPurchaseOrderSn) : "";
  if (!wb) throw new Error("缺少备货单号 subPurchaseOrderSn");

  // 1. 确保在发货台（已加入返回 60001，无害；状态不对如 60004 抛出）。
  const addRes = await callShipApi(creds, "bg.shiporder.staging.add", {
    joinInfoList: [{ deliveryAddressType: Number(deliveryAddressType) || 4, subPurchaseOrderSn: wb }],
  });
  const joinErrors = ((addRes && addRes.joinErrorList) || []).filter((e) => e && Number(e.errorCode) !== 60001);
  if (joinErrors.length) {
    throw new Error(`加入发货台失败：${joinErrors[0].errorMsg || joinErrors[0].errorCode}`);
  }

  // 1.5 发货 SKU：前端显式指定则用，否则从发货台自动取该单全部待发 SKU（全发）。
  let items;
  if (Array.isArray(skuList) && skuList.length) {
    items = normalizeShipSkus(skuList);
  } else {
    items = await fetchStagingSkus(creds, wb);
    if (!items.length) throw new Error("发货台未找到该单 SKU 明细，无法自动发货");
  }

  // 2. 取大仓收货地址 + 子仓（必须在发货台之后才能取到）。
  const rav = await callShipApi(creds, "bg.shiporder.receiveaddressv2.get", { subPurchaseOrderSnList: [wb] });
  const grp = ((rav && rav.subPurchaseReceiveAddressGroups) || [])[0];
  if (!grp || !grp.receiveAddressInfo) throw new Error("取不到大仓收货地址（单据可能不可发货）");
  const subWarehouseId = Number(grp.subWarehouseId);
  const receiveAddressInfo = grp.receiveAddressInfo;

  // 3. 发货地址 ID（未指定取本店默认地址）。
  let daId = deliveryAddressId != null && deliveryAddressId !== "" ? Number(deliveryAddressId) : null;
  if (!daId) {
    const addrRes = await callShipApi(creds, "bg.mall.address.get", {});
    const arr = Array.isArray(addrRes) ? addrRes : (addrRes && typeof addrRes === "object" ? Object.values(addrRes) : []);
    const def = arr.find((a) => a && a.isDefault) || arr[0];
    if (!def) throw new Error("本店无可用发货地址，请先在卖家后台维护发货地址");
    daId = Number(def.id);
  }

  // 4. 构建包裹。必须在 create 时就传对，创建后不可再改。
  //    items 来自 staging API，有正确的 productSkuId；rawPackages 来自前端，skuId 可能不同，需映射。
  let packages;
  if (Array.isArray(rawPackages) && rawPackages.length > 1) {
    // 前端传了多包裹：按顺序映射 frontId → staging productSkuId
    const frontIds = [...new Set(rawPackages.flat().map((s) => Number(s.productSkuId)))];
    const stagingIds = items.map((it) => it.productSkuId);
    const idMap = new Map();
    frontIds.forEach((fid, i) => idMap.set(fid, stagingIds[i] != null ? stagingIds[i] : fid));
    packages = rawPackages.map((pkg) =>
      pkg.map((s) => ({ productSkuId: idMap.get(Number(s.productSkuId)) || Number(s.productSkuId), skuNum: Number(s.skuNum || 0) }))
        .filter((s) => s.skuNum > 0)
    ).filter((pkg) => pkg.length > 0);
    if (!packages.length) packages = [items.map((it) => ({ productSkuId: it.productSkuId, skuNum: it.qty }))];
  } else {
    const pkgCount = Math.max(1, Number(packageCount) || 1);
    if (pkgCount <= 1) {
      packages = [items.map((it) => ({ productSkuId: it.productSkuId, skuNum: it.qty }))];
    } else {
      packages = Array.from({ length: pkgCount }, () => []);
      for (const it of items) {
        const base = Math.floor(it.qty / pkgCount);
        let rem = it.qty - base * pkgCount;
        for (let p = 0; p < pkgCount; p++) {
          const q = base + (rem > 0 ? 1 : 0);
          if (rem > 0) rem--;
          if (q > 0) packages[p].push({ productSkuId: it.productSkuId, skuNum: q });
        }
      }
    }
  }
  console.log("[Ship] create packages:", JSON.stringify(packages));
  const groupList = [{
    subWarehouseId,
    receiveAddressInfo,
    deliveryOrderCreateInfos: [{
      deliveryAddressId: daId,
      subPurchaseOrderSn: wb,
      packageInfos: packages.map((pkgItems) => ({ packageDetailSaveInfos: pkgItems })),
      deliverOrderDetailInfos: items.map((it) => ({ productSkuId: it.productSkuId, deliverSkuNum: it.qty })),
    }],
  }];
  const res = await callShipApi(creds, "bg.shiporderv3.create", { deliveryOrderCreateGroupList: groupList });
  const deliveryOrders = (res && res.deliveryOrders) || [];
  const deliveryOrderSn = deliveryOrders[0] || null;

  // 创建成功后回写 DB + 物化快照，让刷新后也能识别"已创建发货单"状态、显示收货仓/地址。
  if (deliveryOrderSn && db) {
    try {
      const addrJson = JSON.stringify(receiveAddressInfo);
      const warehouseName = (receiveAddressInfo && receiveAddressInfo.receiverName) || null;
      db.prepare(
        `UPDATE erp_temu_openapi_consign SET
          delivery_order_sn = COALESCE(NULLIF(delivery_order_sn,''), ?),
          sub_warehouse_name = COALESCE(NULLIF(sub_warehouse_name,''), ?),
          receive_warehouse_name = COALESCE(NULLIF(receive_warehouse_name,''), ?),
          receive_address_json = COALESCE(receive_address_json, ?)
        WHERE so_id = ?`
      ).run(deliveryOrderSn, String(subWarehouseId), warehouseName, addrJson, wb);
      // 同步更新物化快照
      try {
        db.prepare(
          `UPDATE temu_consign_unified_snapshot SET payload_json = json_set(payload_json,
            '$.rawCloud.delivery_order_sn', ?,
            '$.rawCloud.receive_warehouse_name', ?,
            '$.rawCloud.receive_address_json', ?)
          WHERE json_extract(payload_json, '$.soId') = ?`
        ).run(deliveryOrderSn, warehouseName, addrJson, wb);
      } catch (e2) { console.warn("[Ship] snapshot update failed (non-fatal):", e2.message); }
    } catch (e) {
      console.warn("[Ship] post-create DB update failed (non-fatal):", e.message);
    }
  }

  return {
    subPurchaseOrderSn: wb,
    subWarehouseId: String(subWarehouseId),
    deliveryAddressId: String(daId),
    receiveAddressInfo,
    deliveryOrders,
    deliveryOrderSn,
  };
}

// 撤销发货单（仅 FH「已创建未物流下单」可撤；已 packing.send 生成 EB 的不可撤）。
// 注意：FH 刚创建瞬间状态未就绪，立即撤销会报「当前店铺无法对该发货单进行操作」，
// 故对该错误轻量重试（最多 3 次、间隔 2s）。
async function cancelOfficialShipOrder({ db, mallId, deliveryOrderSn, subPurchaseOrderSn }) {
  const creds = getMallShipCreds(db, mallId);
  const sn = deliveryOrderSn ? String(deliveryOrderSn) : "";
  if (!sn) throw new Error("缺少发货单号 deliveryOrderSn");
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await callShipApi(creds, "bg.shiporder.cancel", { deliveryOrderSn: sn });
      // 撤销成功后清 DB + 快照中的发货单号，让刷新后状态回到"待发货"。
      if (db && subPurchaseOrderSn) {
        const soId = String(subPurchaseOrderSn);
        try {
          db.prepare("UPDATE erp_temu_openapi_consign SET delivery_order_sn = NULL WHERE so_id = ? AND delivery_order_sn = ?").run(soId, sn);
          db.prepare(
            `UPDATE temu_consign_unified_snapshot SET payload_json = json_set(payload_json, '$.rawCloud.delivery_order_sn', NULL)
            WHERE json_extract(payload_json, '$.soId') = ?`
          ).run(soId);
        } catch (e) { console.warn("[Ship] post-cancel DB clear failed (non-fatal):", e.message); }
      }
      return { deliveryOrderSn: sn, result: res };
    } catch (e) {
      lastErr = e;
      if (i < 2 && /无法对该发货单进行操作|无法操作|状态/.test(e.message || "")) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

// 快递公司字典（真发货选快递用）。返回 [{ shipId, shipName }]。
async function getOfficialLogisticsCompanies({ db, mallId }) {
  const creds = getMallShipCreds(db, mallId);
  const res = await callShipApi(creds, "bg.logistics.company.get", {});
  const list = (res && res.shipList) || [];
  return list
    .filter((s) => s && typeof s === "object")
    .map((s) => ({ shipId: s.shipId != null ? String(s.shipId) : null, shipName: s.shipName || null }));
}

// 发货前校验（packing.match）：校验发货单是否满足发货条件、返回未打标签的单、SKU 总重量。
async function matchOfficialPacking({ db, mallId, deliveryOrderSnList }) {
  const creds = getMallShipCreds(db, mallId);
  const list = (deliveryOrderSnList || []).map(String).filter(Boolean);
  if (!list.length) throw new Error("缺少发货单号列表 deliveryOrderSnList");
  const res = await callShipApi(creds, "bg.shiporder.packing.match", { deliveryOrderSnList: list });
  return res || {};
}

// 平台推荐物流商匹配（logisticsmatch.get）—— 取「选哪家快递上门揽收」的候选 + 运费 + predictId。
// FH 刚创建状态未就绪会报「您无当前发货单的操作权限」，轻量重试（最多 4 次、间隔 2.5s）。
// 返回 { mostUsed, companies:[{expressCompanyId, expressCompanyName, predictId, minCharge, maxCharge,
//        pickupMethod, hasUsed, scheduleTimes}] }。
async function getOfficialLogisticsMatch({ db, mallId, deliveryOrderSn, deliveryAddressId, subWarehouseId, receiveAddressInfo, predictTotalPackageWeight = 1000, totalPackageNum = 1, predictVolume = null }) {
  const creds = getMallShipCreds(db, mallId);
  const sn = deliveryOrderSn ? String(deliveryOrderSn) : "";
  if (!sn) throw new Error("缺少发货单号 deliveryOrderSn");
  if (!deliveryAddressId) throw new Error("缺少发货地址 deliveryAddressId");
  if (!subWarehouseId) throw new Error("缺少收货子仓 subWarehouseId");
  if (!receiveAddressInfo) throw new Error("缺少收货地址 receiveAddressInfo");
  const biz = {
    deliveryAddressId: Number(deliveryAddressId),
    predictTotalPackageWeight: Number(predictTotalPackageWeight) || 1000,
    subWarehouseId: Number(subWarehouseId),
    totalPackageNum: Number(totalPackageNum) || 1,
    receiveAddressInfo,
    deliveryOrderSns: [sn],
  };
  if (predictVolume != null && predictVolume !== "") biz.predictVolume = String(predictVolume);
  const mapCo = (c) => ({
    expressCompanyId: c.expressCompanyId != null ? String(c.expressCompanyId) : null,
    expressCompanyName: c.expressCompanyName || null,
    predictId: c.predictId != null ? String(c.predictId) : null,
    minCharge: c.minSupplierChargeAmount != null ? Number(c.minSupplierChargeAmount) : null,
    maxCharge: c.maxSupplierChargeAmount != null ? Number(c.maxSupplierChargeAmount) : null,
    pickupMethod: c.pickupMethod != null ? Number(c.pickupMethod) : 0,
    hasUsed: Boolean(c.hasUsedThisLogistics),
    scheduleTimes: Array.isArray(c.channelScheduleTimeList) ? c.channelScheduleTimeList : [],
  });
  let lastErr;
  for (let i = 0; i < 4; i++) {
    try {
      const res = await callShipApi(creds, "bg.shiporderv3.logisticsmatch.get", biz);
      const list = (res && res.list) || [];
      return {
        mostUsed: res && res.mostUsedExpressCompany ? mapCo(res.mostUsedExpressCompany) : null,
        companies: list.map(mapCo),
      };
    } catch (e) {
      lastErr = e;
      if (i < 3 && /无.*操作权限|操作权限|状态/.test(e.message || "")) {
        await new Promise((r) => setTimeout(r, 2500));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

// 物流下单（packing.send）—— ⚠️ 真发货、生成 EB 运单、不可逆。必须显式 confirm===true 才执行。
// 平台 TMS 揽收模式（thirdPartyDeliveryInfo）：用 logisticsmatch 选中的 predictId + 物流商，平台上门揽收，
// 商家不填快递单号（运单由平台生成）。deliverMethod 沿用 ERP 历史值 2，pickupMethod 0=默认揽收。
// ⚠️ 本接口无法离线测试（一调即真发货），thirdPartyDeliveryInfo 结构 / deliverMethod 取值按文档 +
//    logisticsmatch 返回推断，首次真实发货需核对结果。
async function sendOfficialPacking(opts) {
  const {
    db, mallId, confirm,
    deliveryAddressId, deliveryOrderSnList,
    expressCompanyId, expressCompanyName, predictId,
    deliverMethod = 2, pickupMethod = 0,
    predictTotalPackageWeight, expressPackageNum, expectPickUpGoodsTime,
    expressDeliverySn,
  } = opts || {};
  if (confirm !== true) throw new Error("真发货需显式 confirm=true（防误触）");
  const creds = getMallShipCreds(db, mallId);
  const list = (deliveryOrderSnList || []).map(String).filter(Boolean);
  if (!list.length) throw new Error("缺少发货单号列表 deliveryOrderSnList");
  if (!deliveryAddressId) throw new Error("缺少发货地址 deliveryAddressId");
  if (!expressCompanyId) throw new Error("缺少快递公司 expressCompanyId");

  // 平台 TMS 揽收：物流参数嵌 thirdPartyDeliveryInfo。
  const tms = {
    deliveryOrderSnList: list,
    expressCompanyId: Number(expressCompanyId),
    expressCompanyName: expressCompanyName || "",
    pickupMethod: Number(pickupMethod) || 0,
  };
  if (predictId) tms.predictId = Number(predictId);
  if (predictTotalPackageWeight != null && predictTotalPackageWeight !== "") tms.predictTotalPackageWeight = Number(predictTotalPackageWeight);
  if (expressPackageNum != null && expressPackageNum !== "") tms.expressPackageNum = Number(expressPackageNum);
  if (expectPickUpGoodsTime != null && expectPickUpGoodsTime !== "") tms.expectPickUpGoodsTime = Number(expectPickUpGoodsTime);
  if (expressDeliverySn) tms.expressDeliverySn = String(expressDeliverySn);

  const biz = {
    deliveryAddressId: Number(deliveryAddressId),
    deliveryOrderSnList: list,
    deliverMethod: Number(deliverMethod) || 2,
    thirdPartyDeliveryInfo: tms,
  };
  const res = await callShipApi(creds, "bg.shiporder.packing.send", biz);
  return { expressBatchSn: (res && res.expressBatchSn) || null, result: res };
}

// ── 打印（箱唛 / 商品条码）──────────────────────────────────────────
// Temu 官方：带 return_data_key=true 调接口，返回的 result 是个 dataKey 字符串，
// 拼成 tool/print?dataKey=xxx 用浏览器打开就是渲染好的打印页（10 分钟单次有效，无需自渲染条码）。
const TEMU_PRINT_BASES = {
  CN: "https://openapi.kuajingmaihuo.com/tool/print",
  PA: "https://openapi-b-partner.temu.com/tool/print",
};
function getPrintBase(type) {
  return /^bg\.(glo|qtg)\./.test(type) ? TEMU_PRINT_BASES.PA : TEMU_PRINT_BASES.CN;
}

// 打印箱唛：要发货单号（创建发货单后才有）。一次可传多个发货单，合并到一份打印页。
async function printOfficialBoxmark({ db, mallId, deliveryOrderSn, deliveryOrderSnList }) {
  const creds = getMallShipCreds(db, mallId);
  const list = (deliveryOrderSnList && deliveryOrderSnList.length ? deliveryOrderSnList : [deliveryOrderSn])
    .map((x) => (x != null ? String(x) : "")).filter(Boolean);
  if (!list.length) throw new Error("缺少发货单号 deliveryOrderSn");
  const type = "bg.logistics.boxmarkinfo.get";
  const dataKey = await callShipApi(creds, type, {
    deliveryOrderSnList: list,
    return_data_key: "true",
  });
  if (!dataKey || typeof dataKey !== "string") throw new Error("未返回箱唛打印 dataKey");
  return { dataKey, printUrl: `${getPrintBase(type)}?dataKey=${encodeURIComponent(dataKey)}` };
}

// 打印商品条码（SKU 条码）：按 SKC 或 SKU id，不依赖发货单、随时可打。
async function printOfficialGoodsLabel({ db, mallId, skcIds, skuIds }) {
  const creds = getMallShipCreds(db, mallId);
  const skcs = (skcIds || []).map((x) => Number(x)).filter(Boolean);
  const skus = (skuIds || []).map((x) => Number(x)).filter(Boolean);
  const biz = { return_data_key: "true" };
  if (skcs.length) biz.productSkcIdList = skcs;
  else if (skus.length) biz.productSkuIdList = skus;
  else throw new Error("缺少 SKC/SKU id");
  const type = "bg.glo.goods.labelv2.get";
  const dataKey = await callShipApi(creds, type, biz);
  if (!dataKey || typeof dataKey !== "string") throw new Error("未返回条码打印 dataKey");
  return { dataKey, printUrl: `${getPrintBase(type)}?dataKey=${encodeURIComponent(dataKey)}` };
}

// ── 第三阶段补充：发货前增强（体积/装箱）+ 面单 + 备货单写 ────────────────

// 预估体积（predict.volume.get）—— ERP 下发货单前取，喂给 logisticsmatch 让运费/匹配更准。
async function getOfficialPredictVolume({ db, mallId, deliveryOrderSnList }) {
  const creds = getMallShipCreds(db, mallId);
  const list = (deliveryOrderSnList || []).map(String).filter(Boolean);
  if (!list.length) throw new Error("缺少发货单号列表 deliveryOrderSnList");
  const res = await callShipApi(creds, "bg.predict.volume.get", { deliveryOrderSnList: list });
  return { predictVolume: (res && res.predictVolume) || null };
}

// 装箱明细查询（package.get）—— 创建发货单后查包裹怎么装的。
async function getOfficialPackage({ db, mallId, deliveryOrderSn }) {
  const creds = getMallShipCreds(db, mallId);
  const sn = deliveryOrderSn ? String(deliveryOrderSn) : "";
  if (!sn) throw new Error("缺少发货单号 deliveryOrderSn");
  const res = await callShipApi(creds, "bg.shiporder.package.get", { deliveryOrderSn: sn });
  return { deliveryOrderSn: sn, packageInfo: (res && res.packageInfo) || [] };
}

// 装箱编辑（package.edit）—— 调整发货单分箱：哪些 SKU 装哪箱、各箱数量。
// deliverOrderDetailInfos=整单各 SKU 发货总量；packageInfos[].packageDetailSaveInfos=每箱 SKU 明细。
async function editOfficialPackage({ db, mallId, deliveryOrderSn, deliverOrderDetailInfos, packageInfos }) {
  const creds = getMallShipCreds(db, mallId);
  const sn = deliveryOrderSn ? String(deliveryOrderSn) : "";
  if (!sn) throw new Error("缺少发货单号 deliveryOrderSn");
  if (!Array.isArray(deliverOrderDetailInfos) || !deliverOrderDetailInfos.length) throw new Error("缺少发货明细 deliverOrderDetailInfos");
  if (!Array.isArray(packageInfos) || !packageInfos.length) throw new Error("缺少包裹明细 packageInfos");
  const res = await callShipApi(creds, "bg.shiporder.package.edit", {
    deliveryOrderSn: sn,
    deliverOrderDetailInfos: deliverOrderDetailInfos.map((d) => ({
      productSkuId: Number(d.productSkuId),
      deliverSkuNum: Number(d.deliverSkuNum != null ? d.deliverSkuNum : d.skuNum),
    })),
    packageInfos: packageInfos.map((p) => ({
      packageDetailSaveInfos: ((p.packageDetailSaveInfos || p.packageDetails) || []).map((it) => ({
        productSkuId: Number(it.productSkuId),
        skuNum: Number(it.skuNum),
      })),
    })),
  });
  return { deliveryOrderSn: sn, result: res };
}

// 面单 PDF（express.note.get）—— 先查发货单拿快递单号，取运单标签 url，带鉴权 header 下载成 base64。
// 快递单号(expressDeliverySn)发货后平台才分配，未分配则提示等待。
// PDF url 需 app-key/access-token/timestamp/sign 鉴权 GET（三参数签名复用 signOpenApi，规则同公共参数签名）。
async function getOfficialExpressNotePdf({ db, mallId, deliveryOrderSn }) {
  const creds = getMallShipCreds(db, mallId);
  const sn = deliveryOrderSn ? String(deliveryOrderSn) : "";
  if (!sn) throw new Error("缺少发货单号 deliveryOrderSn");
  // 1. 查发货单拿 expressCompanyId + expressDeliverySn（快递单号）。
  const shipRes = await callShipApi(creds, "bg.shiporderv2.get", { pageSize: 10, pageNo: 1, deliveryOrderSnList: [sn] });
  const order = ((shipRes && shipRes.list) || [])[0];
  if (!order) throw new Error("查不到该发货单");
  const expressCompanyId = order.expressCompanyId;
  const expressDeliverySn = order.expressDeliverySn;
  if (!expressCompanyId || !expressDeliverySn) throw new Error("平台尚未分配快递单号，请稍后再打印面单");
  // 2. 取运单标签 PDF url。
  const noteRes = await callShipApi(creds, "bg.shiporder.express.note.get", {
    expressCompanyId: Number(expressCompanyId),
    expressDeliverySn: String(expressDeliverySn),
  });
  const detail = ((noteRes && noteRes.tmsChildWaybillSnNoteDetails) || [])[0];
  const pdfUrl = detail && detail.childWaybillNote;
  if (!pdfUrl) throw new Error("未取到运单标签 PDF 链接");
  // 3. 带三参数鉴权 header GET PDF。
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sign = signOpenApi({ "app-key": creds.appKey, "access-token": creds.accessToken, timestamp }, creds.appSecret);
  const resp = await fetch(pdfUrl, {
    method: "GET",
    headers: { "app-key": creds.appKey, "access-token": creds.accessToken, timestamp, sign },
  });
  if (!resp.ok) throw new Error(`下载面单 PDF 失败 HTTP ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  return {
    deliveryOrderSn: sn,
    expressDeliverySn: String(expressDeliverySn),
    childWaybillSn: (detail && detail.childWaybillSn) || null,
    filename: `面单_${expressDeliverySn}.pdf`,
    pdfBase64: buf.toString("base64"),
  };
}

// 备货单·创建（purchaseorder.apply）—— ⚠️ 真下备货单（有当日额度上限、受核价限制，错误码原样透传）。
// purchaseDetailList=[{productSkuId,productSkcId,productSkuPurchaseQuantity,expectLatestDeliverTime?,expectLatestArrivalTime?}]。
async function applyOfficialPurchaseOrder({ db, mallId, purchaseDetailList }) {
  const creds = getMallShipCreds(db, mallId);
  if (!Array.isArray(purchaseDetailList) || !purchaseDetailList.length) throw new Error("缺少备货明细 purchaseDetailList");
  const list = purchaseDetailList.map((d) => {
    const item = {
      productSkuId: Number(d.productSkuId),
      productSkcId: Number(d.productSkcId),
      productSkuPurchaseQuantity: Number(d.productSkuPurchaseQuantity != null ? d.productSkuPurchaseQuantity : d.quantity),
    };
    if (!item.productSkuId || !item.productSkcId || !(item.productSkuPurchaseQuantity > 0)) {
      throw new Error(`备货明细非法：${JSON.stringify(d)}`);
    }
    if (d.expectLatestDeliverTime) item.expectLatestDeliverTime = Number(d.expectLatestDeliverTime);
    if (d.expectLatestArrivalTime) item.expectLatestArrivalTime = Number(d.expectLatestArrivalTime);
    return item;
  });
  const res = await callShipApi(creds, "bg.purchaseorder.apply", { purchaseDetailList: list });
  return { result: res };
}

// 备货单·改下单量（purchaseorder.edit）—— 仅待创建备货单可改。
async function editOfficialPurchaseOrder({ db, mallId, subPurchaseOrderSn, purchaseDetailList }) {
  const creds = getMallShipCreds(db, mallId);
  const wb = subPurchaseOrderSn ? String(subPurchaseOrderSn) : "";
  if (!wb) throw new Error("缺少备货单号 subPurchaseOrderSn");
  if (!Array.isArray(purchaseDetailList) || !purchaseDetailList.length) throw new Error("缺少备货明细 purchaseDetailList");
  const list = purchaseDetailList.map((d) => ({
    productSkuId: Number(d.productSkuId),
    productSkuPurchaseQuantity: Number(d.productSkuPurchaseQuantity != null ? d.productSkuPurchaseQuantity : d.quantity),
  }));
  const res = await callShipApi(creds, "bg.purchaseorder.edit", { subPurchaseOrderSn: wb, purchaseDetailList: list });
  return { subPurchaseOrderSn: wb, result: res };
}

// 备货单·批量取消待接单（purchaseorder.cancel）。
async function cancelOfficialPurchaseOrder({ db, mallId, subPurchaseOrderSnList }) {
  const creds = getMallShipCreds(db, mallId);
  const list = (subPurchaseOrderSnList || []).map(String).filter(Boolean);
  if (!list.length) throw new Error("缺少备货单号列表 subPurchaseOrderSnList");
  const res = await callShipApi(creds, "bg.purchaseorder.cancel", { subPurchaseOrderSnList: list });
  return { result: res };
}

const SHIP_STATUS_MAP = { "0": "待发货", "1": "已发货", "2": "已收货", "5": "取消", "6": "异常" };

// 增量同步发货单状态：对指定备货单，调 shiporderv2.get 查最新状态并回写 consign 表。
async function syncShipOrderStatus({ db, soIds }) {
  if (!Array.isArray(soIds) || !soIds.length) return { updated: 0 };
  const placeholders = soIds.map(() => "?").join(",");
  const rows = db.prepare(
    `SELECT mall_id, so_id, delivery_order_sn FROM erp_temu_openapi_consign WHERE so_id IN (${placeholders})`
  ).all(...soIds);
  // 按 mall 分组：有 delivery_order_sn 的走批量查询，没有的走逐个 subPurchaseOrderSn 查
  const byMall = new Map();
  const missingSnByMall = new Map();
  for (const r of rows) {
    if (r.delivery_order_sn) {
      if (!byMall.has(r.mall_id)) byMall.set(r.mall_id, new Set());
      byMall.get(r.mall_id).add(r.delivery_order_sn);
    } else {
      if (!missingSnByMall.has(r.mall_id)) missingSnByMall.set(r.mall_id, []);
      missingSnByMall.get(r.mall_id).push(r.so_id);
    }
  }
  let updated = 0;
  const upd = db.prepare(`
    UPDATE erp_temu_openapi_consign SET
      ship_status = COALESCE(?, ship_status),
      temu_status = COALESCE(?, temu_status),
      express_company = COALESCE(?, express_company),
      express_delivery_sn = COALESCE(?, express_delivery_sn),
      delivery_order_sn = COALESCE(?, delivery_order_sn),
      delivery_method = COALESCE(?, delivery_method),
      deliver_package_num = COALESCE(?, deliver_package_num),
      receive_package_num = COALESCE(?, receive_package_num),
      predict_package_weight = COALESCE(?, predict_package_weight)
    WHERE so_id = ? AND mall_id = ?`);
  for (const [mallId, snSet] of byMall) {
    let creds;
    try { creds = getMallShipCreds(db, mallId); } catch { continue; }
    const snList = [...snSet];
    for (let i = 0; i < snList.length; i += 20) {
      const batch = snList.slice(i, i + 20);
      try {
        const r = await callShipApi(creds, "bg.shiporderv2.get", {
          pageSize: 20, pageNo: 1, deliveryOrderSnList: batch,
        });
        for (const it of ((r && r.list) || [])) {
          const wb = it.subPurchaseOrderSn ? String(it.subPurchaseOrderSn) : null;
          if (!wb) continue;
          const ss = SHIP_STATUS_MAP[String(it.status)] || null;
          upd.run(
            ss, ss,
            it.expressCompany || null,
            it.expressDeliverySn ? String(it.expressDeliverySn) : null,
            it.deliveryOrderSn ? String(it.deliveryOrderSn) : null,
            it.deliveryMethod != null ? Number(it.deliveryMethod) : null,
            it.deliverPackageNum != null ? Number(it.deliverPackageNum) : null,
            it.receivePackageNum != null ? Number(it.receivePackageNum) : null,
            it.predictTotalPackageWeight != null ? Number(it.predictTotalPackageWeight) : null,
            wb, mallId,
          );
          updated++;
        }
      } catch (e) { console.log("[syncShipOrderStatus] error mall", mallId, ":", e.message); }
    }
  }
  // 对没有 delivery_order_sn 的单，逐个用 subPurchaseOrderSn 查（API 不稳定，最多重试2次）
  for (const [mallId, wbList] of missingSnByMall) {
    let creds;
    try { creds = getMallShipCreds(db, mallId); } catch { continue; }
    for (const wb of wbList) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const r = await callShipApi(creds, "bg.shiporderv2.get", { pageSize: 20, pageNo: 1, subPurchaseOrderSn: wb });
          const it = ((r && r.list) || []).find((x) => x && x.deliveryOrderSn);
          if (it) {
            const ss = SHIP_STATUS_MAP[String(it.status)] || null;
            upd.run(
              ss, ss,
              it.expressCompany || null,
              it.expressDeliverySn ? String(it.expressDeliverySn) : null,
              it.deliveryOrderSn ? String(it.deliveryOrderSn) : null,
              it.deliveryMethod != null ? Number(it.deliveryMethod) : null,
              it.deliverPackageNum != null ? Number(it.deliverPackageNum) : null,
              it.receivePackageNum != null ? Number(it.receivePackageNum) : null,
              it.predictTotalPackageWeight != null ? Number(it.predictTotalPackageWeight) : null,
              wb, mallId,
            );
            updated++;
          }
          break;
        } catch (e) {
          console.log("[syncShipOrderStatus] subPurchaseOrderSn", wb, "attempt", attempt + 1, "error:", e.message);
          if (attempt < 1) await new Promise((r) => setTimeout(r, 500));
        }
      }
    }
  }
  return { updated };
}

module.exports = {
  getMallShipCreds,
  getOfficialShipPreview,
  fetchStagingSkusDetailed,
  stagingAddOfficial,
  lookupDeliveryOrderSn,
  createOfficialShipOrder,
  cancelOfficialShipOrder,
  getOfficialLogisticsCompanies,
  getOfficialLogisticsMatch,
  matchOfficialPacking,
  sendOfficialPacking,
  printOfficialBoxmark,
  printOfficialGoodsLabel,
  getOfficialPredictVolume,
  getOfficialPackage,
  editOfficialPackage,
  getOfficialExpressNotePdf,
  applyOfficialPurchaseOrder,
  editOfficialPurchaseOrder,
  cancelOfficialPurchaseOrder,
  syncShipOrderStatus,
};
