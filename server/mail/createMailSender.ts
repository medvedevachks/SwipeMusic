import type { AppConfig } from '../config/env.ts'
import type { MailSender } from './MailSender.ts'
import { createConsoleMailSender } from './consoleMailSender.ts'
import { createMemoryMailSender } from './memoryMailSender.ts'
import { createSmtpMailSender } from './smtpMailSender.ts'

export function createMailSender(config: AppConfig): MailSender {
  if (config.mailTransport === 'console') {
    return createConsoleMailSender(config.nodeEnv)
  }
  if (config.mailTransport === 'memory') {
    return createMemoryMailSender()
  }
  if (config.mailTransport === 'smtp') {
    if (!config.smtp) {
      throw new Error('Mail configuration is invalid')
    }
    return createSmtpMailSender(config.smtp)
  }
  throw new Error('Mail configuration is invalid')
}
