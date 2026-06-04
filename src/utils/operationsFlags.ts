// 运营工作台「切官方 API」期间：官方未覆盖的板块统一隐藏开关（一处控制、可逆）
// 想恢复某块：把对应开关改成 false 即可——代码与后端数据都保留着，不是删除。
export const HIDE_RISK = true;     // 风险违规：官方 API 无接口
export const HIDE_ACTIVITY = true; // 活动可报/报名：官方仅"爆款邀约"，不全
export const HIDE_REVIEW = true;   // 评价口碑：官方 API 无接口
// 已切官方 API 数据源：官方未提供的数据（销量逐日趋势 / 申报价 / 商品流量 / 限流 / 合规）随之隐藏
export const OFFICIAL_SOURCE = true;
