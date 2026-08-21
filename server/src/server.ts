import mongoose from 'mongoose'
import app, { seedDemo } from './app.js'
import { env } from './config/env.js'

async function start() {
  await mongoose.connect(env.mongoUri)
  await seedDemo()
  app.listen(env.port, () => console.log(`DukaanSaathi API listening on ${env.port}`))
}

start().catch((error) => { console.error(error); process.exit(1) })
