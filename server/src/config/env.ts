import 'dotenv/config'

export const env = {
  port: Number(process.env.PORT || 4000),
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/dukaansaathi',
  jwtSecret: process.env.JWT_SECRET || 'development-only-change-me',
  nodeEnv: process.env.NODE_ENV || 'development',
}
