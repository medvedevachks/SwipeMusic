import nodemailer from 'nodemailer'
import type { SmtpConfig } from '../config/env.ts'
import type { MailSender } from './MailSender.ts'

export function createSmtpMailSender(smtp: SmtpConfig): MailSender {
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user
      ? {
          user: smtp.user,
          pass: smtp.password,
        }
      : undefined,
  })

  return {
    async sendPasswordReset(message) {
      await transport.sendMail({
        from: smtp.from,
        to: message.to,
        subject: 'Восстановление пароля Swipe Music',
        text: [
          'Чтобы задать новый пароль, откройте ссылку.',
          'Она действует 30 минут и только один раз.',
          message.resetUrl,
        ].join('\n'),
      })
    },
  }
}
