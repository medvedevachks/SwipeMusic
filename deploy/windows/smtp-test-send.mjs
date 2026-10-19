import nodemailer from 'nodemailer'

function textValue(name) {
  const value = process.env[name]
  return typeof value === 'string' ? value.trim() : ''
}

function redact(message) {
  const secret = process.env.SMTP_PASSWORD
  const text = String(message || 'SMTP send failed')
  if (!secret) {
    return text
  }
  return text.split(secret).join('[redacted]')
}

const host = textValue('SMTP_HOST')
const portText = textValue('SMTP_PORT')
const secureText = textValue('SMTP_SECURE')
const user = textValue('SMTP_USER')
const from = textValue('SMTP_FROM')
const to = textValue('SMTP_TEST_TO')
const password = process.env.SMTP_PASSWORD ?? ''

if (!host || !portText || !secureText || !user || !from || !to || password.trim() === '') {
  console.error('SMTP test send is missing a required value.')
  process.exit(1)
}

const port = Number(portText)
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('SMTP_PORT is invalid.')
  process.exit(1)
}
if (secureText !== 'true' && secureText !== 'false') {
  console.error('SMTP_SECURE must be true or false.')
  process.exit(1)
}

const transport = nodemailer.createTransport({
  host,
  port,
  secure: secureText === 'true',
  auth: {
    user,
    pass: password,
  },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 10000,
})

try {
  await transport.sendMail({
    from,
    to,
    subject: 'Swipe Music SMTP test',
    text: [
      'Swipe Music SMTP test',
      'This message confirms that the configured SMTP relay accepted one test message.',
    ].join('\n'),
  })
} catch (error) {
  console.error(redact(error instanceof Error ? error.message : error))
  process.exit(1)
} finally {
  transport.close()
}
