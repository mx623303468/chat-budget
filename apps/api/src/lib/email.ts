type SendEmailParams = {
  to: string
  subject: string
  html: string
  apiKey: string
}

export class EmailSendError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly responseText?: string
  ) {
    super(message)
    this.name = 'EmailSendError'
  }
}

export async function sendEmail({ to, subject, html, apiKey }: SendEmailParams): Promise<void> {
  const resendApiKey = apiKey?.trim()

  if (!resendApiKey) {
    throw new EmailSendError('缺少 Resend API Key')
  }

  let res: Response

  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: '聊天记账 <noreply@mail.chat-budget.online>',
        to: [to],
        subject,
        html,
      }),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new EmailSendError(`Resend 请求失败：${message}`)
  }

  if (!res.ok) {
    const responseText = await res.text().catch(() => '')
    throw new EmailSendError('Resend 邮件发送失败', res.status, responseText.slice(0, 500))
  }
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
