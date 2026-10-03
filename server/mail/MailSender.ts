export type PasswordResetMail = {
  to: string
  resetUrl: string
}

export interface MailSender {
  sendPasswordReset(message: PasswordResetMail): Promise<void>
}
