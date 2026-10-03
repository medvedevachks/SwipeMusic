import type { MailSender } from './MailSender.ts'

/** Только development/test. В production этот transport запрещён. */
export function createConsoleMailSender(nodeEnv: string): MailSender {
  return {
    async sendPasswordReset(message) {
      if (nodeEnv === 'production') {
        throw new Error('Mail configuration is invalid')
      }
      console.info('password reset link ready for local development')
      console.info(message.resetUrl)
    },
  }
}
