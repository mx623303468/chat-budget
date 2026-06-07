// apps/api/src/lib/email.ts

type SendEmailParams = {
  to: string
  subject: string
  html: string
  apiKey: string
}

export async function sendEmail({ to, subject, html, apiKey }: SendEmailParams): Promise<boolean> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: '聊天记账 <noreply@your-domain.com>',
      to: [to],
      subject,
      html,
    }),
  })

  return res.ok
}

export function buildResetCodeHtml(code: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: sans-serif; max-width: 400px; margin: 40px auto; padding: 0 20px;">
  <h2 style="color: #333;">修改密码验证码</h2>
  <p style="color: #666; font-size: 14px;">你的验证码是：</p>
  <p style="font-size: 32px; font-weight: bold; letter-spacing: 4px; color: #333; margin: 16px 0;">${code}</p>
  <p style="color: #999; font-size: 12px;">验证码 5 分钟内有效。如非本人操作，请忽略此邮件。</p>
</body>
</html>`
}
