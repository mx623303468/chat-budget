# chat-budget

聊天式记账 PWA，输入即记录，1~2 秒完成一笔记账。

## 功能

### 聊天式输入

输入 `金额 说明` 即可记账，支持多种容错：

| 输入 | 解析结果 |
|------|---------|
| `10 早餐` | 10 元，早餐 |
| `早餐 10` | 自动交换为 10 元，早餐 |
| `10早餐` | 自动补空格 |
| `１０ 早餐` | 全角转半角 |
| `10` | 提示：请输入说明（空格后） |

### 预算系统

- 余额 = 总天数 x 每日限额 - 总支出
- 修改限额时可选择「今日生效」或「明日生效」
- 状态颜色：正数绿色、零黄色、负数红色

### 交互

- 左滑删除，长按编辑
- 新增气泡自动滚到底部
- 下拉展开头部预算详情
- Lottie 成功/空状态动画
- 按天分组显示日期标签

### 离线支持

PWA + Service Worker 预缓存，可安装到桌面离线使用。

## 技术栈

- Vue 3 + TypeScript + Vite
- shadcn-vue + Tailwind CSS v4 + reka-ui
- Pinia 状态管理
- Dexie.js (IndexedDB) 客户端存储
- Lottie 动画 (@lottiefiles/dotlottie-vue)
- vite-plugin-pwa 离线支持
- GitHub Actions + pnpm 部署到 GitHub Pages

## 开发

```bash
pnpm install
pnpm dev
```

## 构建

```bash
pnpm build
```
