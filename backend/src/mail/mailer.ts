import nodemailer from 'nodemailer'
import type { AppEnv } from '../env.ts'

export function createMailer(env: AppEnv) {
  if (!env.SMTP_HOST) {
    return {
      async send() {
        console.warn('SMTP не настроен: письмо не отправлено')
      },
    }
  }

  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth:
      env.SMTP_USER && env.SMTP_PASS
        ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
        : undefined,
  })

  return {
    async send(options: { to: string; subject: string; text: string; html: string }) {
      await transporter.sendMail({
        from: env.SMTP_FROM,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
      })
    },
  }
}

export type Mailer = ReturnType<typeof createMailer>

export function verificationEmail(appOrigin: string, url: string) {
  return {
    subject: 'Подтвердите почту в Swipe Music',
    text: `Подтвердите адрес электронной почты, перейдя по ссылке: ${url}\n\nСсылка одноразовая и действует ограниченное время.`,
    html: `<p>Подтвердите адрес электронной почты в Swipe Music.</p><p><a href="${url}">Подтвердить почту</a></p><p>Ссылка одноразовая и действует ограниченное время.</p><p>Если вы не регистрировались, проигнорируйте письмо.</p><p style="color:#888">${appOrigin}</p>`,
  }
}

export function resetPasswordEmail(appOrigin: string, url: string) {
  return {
    subject: 'Сброс пароля Swipe Music',
    text: `Чтобы задать новый пароль, перейдите по ссылке: ${url}\n\nСсылка одноразовая и действует ограниченное время.`,
    html: `<p>Запрос на сброс пароля Swipe Music.</p><p><a href="${url}">Задать новый пароль</a></p><p>Ссылка одноразовая и действует ограниченное время.</p><p>Если вы не запрашивали сброс, проигнорируйте письмо.</p><p style="color:#888">${appOrigin}</p>`,
  }
}

export function changeEmailEmail(appOrigin: string, url: string) {
  return {
    subject: 'Подтвердите новый email Swipe Music',
    text: `Подтвердите новый адрес: ${url}`,
    html: `<p>Подтвердите новый адрес электронной почты.</p><p><a href="${url}">Подтвердить</a></p><p style="color:#888">${appOrigin}</p>`,
  }
}
