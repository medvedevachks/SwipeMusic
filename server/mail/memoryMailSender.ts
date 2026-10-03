import type { MailSender, PasswordResetMail } from './MailSender.ts'

export function createMemoryMailSender(): MailSender & {
  messages: PasswordResetMail[]
} {
  const messages: PasswordResetMail[] = []
  return {
    messages,
    async sendPasswordReset(message) {
      messages.push({ ...message })
    },
  }
}
