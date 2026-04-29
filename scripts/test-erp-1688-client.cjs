const assert = require("node:assert/strict");

const {
  PROCUREMENT_APIS,
  build1688OpenApiRequest,
  normalize1688ProductDetailResponse,
  normalize1688SearchResponse,
  sign1688Request,
} = require("../electron/erp/1688Client.cjs");

function run() {
  const apiPath = "param2/1/com.alibaba.fenxiao/product.keywords.search/123456";
  const params = {
    access_token: "token",
    param: JSON.stringify({ keyword: "cup", beginPage: 1, pageSize: 2 }),
  };
  assert.equal(
    sign1688Request(apiPath, params, "secret"),
    "0046AC2F5391DD4BB274D8E9B5F56EDE12A80473",
  );

  const request = build1688OpenApiRequest({
    api: PROCUREMENT_APIS.KEYWORD_SEARCH,
    appKey: "123456",
    appSecret: "secret",
    accessToken: "token",
    params: {
      param: { keyword: "cup", beginPage: 1, pageSize: 2 },
    },
  });
  assert.equal(
    request.url,
    "https://gw.open.1688.com/openapi/param2/1/com.alibaba.fenxiao/product.keywords.search/123456",
  );
  assert.equal(request.params._aop_signature, "0046AC2F5391DD4BB274D8E9B5F56EDE12A80473");
  assert.equal(request.params.access_token, "token");

  const offers = normalize1688SearchResponse({
    result: {
      data: [
        {
          offerId: 888,
          subject: "Cup",
          price: "12.30",
          companyName: "Factory",
          imageUrl: "https://example.test/cup.jpg",
        },
      ],
    },
  });
  assert.equal(offers.length, 1);
  assert.equal(offers[0].externalOfferId, "888");
  assert.equal(offers[0].supplierName, "Factory");
  assert.equal(offers[0].unitPrice, 12.3);
  assert.equal(offers[0].productUrl, "https://detail.1688.com/offer/888.html");

  const detailRequest = build1688OpenApiRequest({
    api: PROCUREMENT_APIS.PRODUCT_DETAIL,
    appKey: "123456",
    appSecret: "secret",
    accessToken: "token",
    params: {
      productID: "888",
      webSite: "1688",
    },
  });
  assert.equal(
    detailRequest.url,
    "https://gw.open.1688.com/openapi/param2/1/com.alibaba.product/alibaba.product.get/123456",
  );

  const detail = normalize1688ProductDetailResponse({
    result: {
      toReturn: {
        productID: 888,
        subject: "Cup Detail",
        companyName: "Detail Factory",
        saleInfo: {
          priceRanges: [
            { startQuantity: 1, price: "12.30" },
            { startQuantity: 10, price: "10.00" },
          ],
        },
        skuInfos: [
          {
            skuId: 1001,
            specId: "blue",
            price: "11.50",
            attributes: [{ attributeName: "Color", value: "Blue" }],
            amountOnSale: 20,
          },
        ],
      },
    },
  });
  assert.equal(detail.externalOfferId, "888");
  assert.equal(detail.productTitle, "Cup Detail");
  assert.equal(detail.supplierName, "Detail Factory");
  assert.equal(detail.unitPrice, 11.5);
  assert.equal(detail.priceRanges.length, 2);
  assert.equal(detail.skuOptions[0].externalSkuId, "1001");
  assert.equal(detail.skuOptions[0].externalSpecId, "blue");
  assert.equal(detail.skuOptions[0].specText, "Color:Blue");
}

try {
  run();
  console.log("ERP 1688 client checks passed.");
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
