# 前端响应体验 / 缓存规范

> 适用范围:`src/pages/` 下全部页面(共 29 个)及其调用的列表/详情数据。
> 目标:让所有界面达到专业 ERP 的「感知速度」——用户点哪都像本地操作,看不到转圈。
> 本规范只管**响应体验与缓存**,不涉及视觉设计、交互模式、单据严谨度(那是另外三条线)。

---

## 0. 一句话原则

**永远不让用户盯着数据库等。** 真实查询快不快是底线,但「快」是靠分层缓存把延迟藏起来,而不是靠每次都查得快。

标杆页面:`src/pages/PurchaseCenter.tsx`。它已经做对了「缓存优先首屏 + 骨架防闪 + compact 缓存」,本规范就是把它做对的东西抽象成所有页面的统一标准,并补上它还缺的(预取、warm 态不转圈、计数缓存)。

---

## 1. 感知性能目标(SLO)

每个页面/交互必须满足下表。验收时用 `performance.now()` 在请求发起处和数据落地处打点测量。

| 场景 | 目标 | 手段 |
| --- | --- | --- |
| **冷启动首屏**(无缓存) | 骨架屏 ≤ 16ms 出现;真实数据 ≤ 1.5s | 挂载首帧 `loading=true` 直接进骨架,不闪空表 |
| **warm 首屏**(有缓存) | 旧数据 ≤ 100ms 可见 | 同步读 localStorage 缓存作为 `useState` 初值,先渲染再后台刷新 |
| **翻页 / 切 Tab(已预取或访问过)** | ≤ 100ms | 预取下一页 + 内存保留已访问页 |
| **翻页(冷,未预取)** | ≤ 800ms,期间**不全屏转圈** | 保留旧表格 + 顶部细进度条 |
| **写操作**(确认收货、改状态等) | 点击即反映 | 乐观更新,失败回滚 |
| **后台静默刷新** | 用户**完全无感** | 不显示任何 loading,数据回来无声替换 |

红线:**warm 态(已有数据在屏)任何刷新都不允许出现全屏 `<Spin>`。** 全屏转圈只允许出现在「这个页面这辈子第一次、且本地无任何缓存」的冷启动。

---

## 2. 标准数据生命周期(SWR 模型)

所有列表/详情页一律走 **stale-while-revalidate**:先给旧的,再悄悄换新的。

```
挂载
 ├─ 同步读缓存 → 有? → 立即渲染(loading=false 但标记 isStale)
 │                 → 无? → 进骨架(loading=true)
 ├─ 后台发请求
 │     ├─ 成功 → 无声替换数据 + 写回缓存 + 清 isStale
 │     └─ 失败 → 保留旧数据 + 顶部非阻塞错误条(toast/Alert),不清屏
 └─ 监听失效事件(账号切换/store 更新/写操作) → 重新走后台请求
```

落到代码,统一用下面这个标准 Hook(见 §3)。禁止再各页手写 `useState + useEffect + 裸 fetch + setLoading(true)` 的老模式。

---

## 3. 统一原语:`useCachedResource`

> 现状:`PurchaseCenter` 手写了这套逻辑(`getInitialPurchaseWorkbenchCache` / `writeCachedPurchaseWorkbench` / 初始 `loading=true`)。规范要求把它抽成一个共享 Hook,放 `src/hooks/useCachedResource.ts`,所有页面复用。**不引入 React Query/SWR 库**,基于现有 `src/utils/pageCache.ts` + `useStoreRefresh` 自建,保持最小依赖。

### 契约(API)

```typescript
function useCachedResource<T>(options: {
  cacheKey: string;                    // 形如 "temu.purchase.workbench.cache.v3",带版本号
  fetcher: () => Promise<T>;           // 实际 IPC 调用,如 () => erp.purchase.workbench(params)
  compact?: (data: T) => T;            // 写缓存前裁剪重字段(如详情/timeline),减小体积
  watchKeys?: string[];                // 透传给 useStoreRefresh,这些 store key 变化即失效
  reloadOnAccountChange?: boolean;     // 默认 true
  enabled?: boolean;                   // 条件加载
}): {
  data: T | undefined;
  isLoading: boolean;                  // 仅冷启动无缓存时为 true
  isFetching: boolean;                 // 后台刷新中(给细进度条用,不给全屏转圈)
  isStale: boolean;                    // 当前 data 来自缓存、尚未被新请求确认
  error: Error | null;
  refetch: () => Promise<void>;
};
```

### 行为要求

- 初值**同步**从缓存读(`readPageCache`),不能等 `useEffect`,否则首帧会闪空。
- 缓存命中时 `isLoading=false`、`isStale=true`,后台刷新用 `isFetching` 表达,**绝不**因后台刷新把 `isLoading` 翻 true。
- 成功后 `compact` 再写缓存(localStorage 有 5MB 配额,列表别把详情/timeline/大 JSON 塞进去——参考 `compactPurchaseWorkbenchForCache`)。
- 写缓存失败(配额/隐私模式)静默吞掉,缓存只是加速提示,不是数据源。
- 失效来源统一交给 `useStoreRefresh`:账号切换、`STORE_VALUE(S)_UPDATED_EVENT`、显式 `refetch`。

---

## 4. 加载态规范

| 状态 | 必须显示 | 禁止 |
| --- | --- | --- |
| 冷启动无缓存 | `<Skeleton active>`(行数贴近真实表格,如 `paragraph={{ rows: 8 }}`) | 全屏 `<Spin>` 居中转圈 |
| warm 后台刷新(`isFetching`) | 顶部 2px 细进度条 / 表头 mini spinner | 任何遮罩、任何全屏转圈、清空表格 |
| 翻页加载 | 保留当前页内容 + 顶部进度条 | 表格瞬间变空再填回 |
| 行内操作(`actingKey`) | 该行/该按钮局部 loading | 锁整页 |
| 请求失败 | 顶部非阻塞 `Alert`/`message.error` + 保留旧数据 | 整页错误占位(除非确实无任何缓存可显示) |

骨架屏组件统一:列表用表格骨架,详情用 `<Skeleton active paragraph={{ rows: N }}>`。每个页面的骨架行数应贴近其真实首屏密度,避免布局跳动(CLS)。

---

## 5. 分页规范

### 5.1 页大小与预取
- 默认页大小 `20`(沿用 `PURCHASE_ORDER_DEFAULT_PAGE_SIZE`),可选 `[20, 25, 50, 100, 200]`。
- **预取下一页**:当前页渲染完成后,空闲时(`requestIdleCallback` 或微延时)用同样参数 `offset += pageSize` 预取下一页写入内存缓存。真翻页时直接命中,达成 §1 的 ≤100ms。
- 已访问过的页保留在内存 `Map<pageKey, rows>`,翻回去瞬开;筛选条件变化时清空该 Map。

### 5.2 OFFSET vs 游标(keyset)
- 默认沿用 OFFSET(支持跳页,ERP 列表需要)。
- **深翻页红线**:`offset > 2000` 时 OFFSET 会明显变慢。两种处理:
  - 列表支持跳页 → 保留 OFFSET,但服务端**列表查询与 COUNT 必须按需 JOIN**(见 §7),不得因关联表把行数膨胀再 GROUP BY。
  - 列表只需上一页/下一页(如时间流式视图)→ 改 **keyset 分页**:`WHERE (sort_col, id) < (上页末条) ORDER BY sort_col DESC, id DESC LIMIT N`,每页恒定快、与页深无关。

### 5.3 计数(total)
- `total` 跟随首次查询返回,翻页时**不重新 COUNT**(同一筛选条件下 total 不变)。
- 状态计数(如各队列的 draft/paid/... 角标)**不允许每次翻页全表 SUM**。要么服务端走汇总表,要么前端在同一筛选条件下缓存计数、翻页时复用。

---

## 6. 写操作(Mutation)规范

- **乐观更新**:确认收货、改状态、备注等,点击后立即在本地更新该行/该计数,再发请求;失败回滚并提示。
- **精准失效**:写成功后只失效受影响的资源(通过 `useStoreRefresh` 的 `watchKeys` 或显式 `refetch`),不整页重拉。
- **行内 loading**:操作中只锁该行(`actingKey` 模式),不锁整页。
- 同一资源的列表与详情共享缓存键前缀,写后一并失效,避免「列表已改、详情还旧」。

---

## 7. 服务端配合(响应体验的底线)

前端缓存能藏延迟,但底层查询慢到一定程度藏不住。服务端 `getPurchaseWorkbench` 一类列表接口必须守住:

- **列表查询 + COUNT 按需 JOIN**:只在筛选/排序真正引用到关联表时才 JOIN。1:N 关联(明细行、SKU)不得无条件 JOIN——会把行数按明细膨胀再 `GROUP BY`,触发全量物化排序(已知慢查询根因,已在采购单列表修复)。
- **能 EXISTS 就别 JOIN**:存在性判断(有无退款/映射/送货地址)用 `EXISTS` 子查询,不靠 JOIN+DISTINCT。
- **WHERE/ORDER 列必须有索引**:列表的过滤列、排序列建复合索引(如 `(account_id, status)`)。新列表上线前 `EXPLAIN QUERY PLAN` 确认没全表扫。
- **汇总用汇总表**:高频角标计数维护增量汇总表,不实时全表聚合。
- **字段裁剪**:列表只返回列表要显示的字段,详情才拉全量(参考 `FAST_PURCHASE_WORKBENCH_PARAMS` 的 `includeOptions:false` / `include1688Meta:false`)。
- **(可选)版本号增量同步**:client 模式下本地 SQLite 镜像可记录 `updated_at` 水位,只向主控拉增量,减小跨海 payload。

---

## 8. 新页面快速开始(模板)

新建任何列表/详情页,按此骨架,不要从零手写 fetch:

```tsx
const erp = window.electronAPI?.erp;

const { data, isLoading, isFetching, isStale, error, refetch } = useCachedResource({
  cacheKey: "temu.<module>.<view>.cache.v1",
  fetcher: () => erp.<module>.<method>(buildParams()),
  compact: compactForCache,            // 裁掉详情/timeline 等重字段
  watchKeys: ["<相关 store key>"],
  reloadOnAccountChange: true,
});

if (isLoading) return <Skeleton active paragraph={{ rows: 8 }} />;  // 仅冷启动

return (
  <>
    {isFetching && <TopProgressBar />}   {/* warm 刷新:细条,不转圈 */}
    {error && <Alert type="warning" message="数据刷新失败,显示的是上次结果" />}
    <Table dataSource={data?.rows} pagination={pagination} loading={false} />
  </>
);
```

---

## 9. 验收清单(Definition of Done)

一个页面算「响应体验对齐」,必须全部勾掉:

- [ ] 用 `useCachedResource`,无裸 `useState+useEffect+fetch+setLoading(true)` 老模式
- [ ] warm 首屏 ≤ 100ms 见到旧数据(缓存做初值)
- [ ] 后台刷新期间无全屏转圈,用细进度条/局部 loading
- [ ] 冷启动是骨架屏,不是居中 `<Spin>`,且不闪空表
- [ ] 列表有预取下一页;已访问页内存保留
- [ ] 翻页不重新 COUNT;状态计数不每页全表聚合
- [ ] 写操作乐观更新 + 精准失效,行内 loading 不锁整页
- [ ] 请求失败保留旧数据 + 非阻塞提示,不清屏
- [ ] 服务端列表接口 `EXPLAIN QUERY PLAN` 无全表扫、无膨胀 JOIN
- [ ] 缓存 key 带版本号;写缓存前 compact

---

## 10. 分阶段落地路线

按使用频率和痛点排序,不一次性铺 29 页:

1. **抽原语**:从 `PurchaseCenter` 提取 `useCachedResource` + `<TopProgressBar>` + 表格骨架组件,沉淀到 `src/hooks` / `src/components`。
2. **标杆收口**:`PurchaseCenter` 改用新原语并补齐预取 + warm 不转圈,作为参照实现。
3. **高频页优先**:`Dashboard`、`ShopOverview`、`ProductList`、`WarehouseCenter`、`QcOutboundCenter`、`DailyCommandCenter` 依次对齐。
4. **其余页面**:按验收清单逐页改,每页提交时附 SLO 实测数据。
5. **回归守护**:用 `node scripts/explain-purchase-list-plan.cjs <db路径>` 打印采购单列表查询的执行计划,确认日常翻页走 `idx_erp_po_account_status` 索引、无 `SCAN erp_purchase_order_lines`,防止后续 PR 重新引入膨胀 JOIN。

---

## 附:与现有资产的对应关系

| 规范要求 | 现有资产 | 差距 |
| --- | --- | --- |
| 缓存优先首屏 | `pageCache.ts`、`PurchaseCenter` 的 cache 初值 | 未抽成共享 Hook |
| 失效/重载 | `useStoreRefresh`(账号切换/store 事件/防抖) | 已可用,直接复用 |
| 骨架防闪 | `PurchaseCenter` 初始 `loading=true` + `<Skeleton>` | 仅个别页有 |
| 重字段裁剪 | `compactPurchaseWorkbenchForCache` | 仅采购单页有 |
| 预取下一页 | 无 | 需新增 |
| warm 态不转圈 | 部分页仍全屏 `<Spin>`(9 个页面用 Spin) | 需逐页改 |
| 服务端按需 JOIN | 采购单列表已修 | 其他列表接口待审 |
