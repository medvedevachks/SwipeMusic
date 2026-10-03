import { loadConfig } from './config/env.ts'
import { openDatabase } from './db/database.ts'
import { listenAuthServer } from './http/server.ts'

const config = loadConfig()
const db = openDatabase(config.databasePath)

const server = await listenAuthServer({ db, config })
const address = server.address()
const port = typeof address === 'object' && address ? address.port : config.port
console.log(`Swipe Music auth listening on 127.0.0.1:${port}`)
