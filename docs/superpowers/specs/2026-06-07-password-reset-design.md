# 邮箱验证码修改密码 设计文档

日期：2026-06-07

## 概述

增加邮箱验证码修改密码功能，包含两个入口：登录页"忘记密码"和登录后"修改密码"。使用 Resend 发送邮件，D1 存储验证码。

## 技术方案

### 邮件发送
- 使用 [Resend](https://resend.com) API（免费层每月 100 封）
- Workers 中通过 `fetch` 调用 `https://api.resend.com/emails`
- API Key 存储为 Cloudflare Worker Secret（`RESEND_API_KEY`）

### 验证码存储
- D1 新建 `password_reset_codes` 表
- 6 位随机数字验证码
- 有效期 5 分钟
- 使用后标记为已使用

### 前端页面
- 新增 `/forgot-password` 路由（忘记密码页面）
- 新增 `/reset-password` 路由（输入验证码 + 新密码）
- ProfileDialog 或设置页增加"修改密码"入口

## 数据库

### 新增表：password_reset_codes

```sql
CREATE TABLE password_reset_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_reset_codes_email ON password_reset_codes(email, expires_at);
```

## API 端点

### POST /api/auth/send-reset-code

请求体：
```json
{ "email": "user@example.com" }
```

逻辑：
1. 查找用户，不存在也返回成功（防止枚举）
2. 生成 6 位随机验证码
3. 存入 `password_reset_codes` 表
4. 通过 Resend 发送邮件
5. 返回 `{ ok: true }`

### POST /api/auth/reset-password

请求体：
```json
{ "email": "user@example.com", "code": "123456", "newPassword": "newpass" }
```

逻辑：
1. 查找有效的验证码（email 匹配、未使用、未过期）
2. 不存在或过期返回错误
3. 标记验证码为已使用
4. 更新用户密码
5. 返回 `{ ok: true }`

## 前端流程

### 入口 1：登录页"忘记密码"
1. 登录页增加"忘记密码"链接
2. 跳转到 `/forgot-password`
3. 用户输入邮箱 → 点击"发送验证码"
4. 页面切换到验证码输入 + 新密码输入
5. 提交 → 调用 reset-password API
6. 成功后跳转回登录页

### 入口 2：登录后修改密码
1. UserMenu 或设置页增加"修改密码"选项
2. 打开修改密码弹窗（预填当前邮箱）
3. 点击"发送验证码"
4. 输入验证码 + 新密码
5. 提交 → 调用 reset-password API
6. 成功后关闭弹窗

## 安全考虑

- 验证码 5 分钟过期
- 同一邮箱 60 秒内只能发送一次验证码
- 验证码使用后立即标记，防止重复使用
- 不暴露用户是否存在（发送验证码统一返回成功）
- 新密码最低 6 位

## 涉及文件

- `apps/api/migrations/0003_password_reset_codes.sql` — 新建表
- `apps/api/src/routes/auth.ts` — 新增两个端点
- `apps/api/src/lib/email.ts` — Resend 邮件发送
- `apps/api/wrangler.toml` — secret 配置说明
- `apps/web/src/pages/ForgotPassword.vue` — 忘记密码页
- `apps/web/src/pages/ResetPassword.vue` — 重置密码页
- `apps/web/src/router/index.ts` — 新增路由
- `apps/web/src/pages/LoginPage.vue` — 增加"忘记密码"链接
- `apps/web/src/components/ProfileDialog.vue` 或独立弹窗 — 登录后修改密码
- `apps/web/src/lib/api.ts` — 新增 API 调用
