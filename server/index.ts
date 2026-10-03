import { createForgotPasswordLimiter } from './auth/rateLimit.ts'
import { loadConfig } from './config/env.ts'
import { openDatabase } from './db/database.ts'
import { listenAuthServer } from './http/server.ts'
import { createMailSender } from './mail/createMailSender.ts'

const config = loadConfig()
const db = openDatabase(config.databasePath)
const mail = createMailSender(config)
const limiter = createForgotPasswordLimiter(
  config.forgotPasswordLimit,
  config.forgotPasswordWindowMs,
)

const server = await listenAuthServer({ db, config, mail, limiter })
const address = server.address()
const port = typeof address === 'object' && address ? address.port : config.port
console.log(`Swipe Music auth listening on 127.0.0.1:${port}`)
