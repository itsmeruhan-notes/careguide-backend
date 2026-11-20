export const config = {
  emailDomain: process.env.EMAIL_DOMAIN || 'ruhan.lol',
  port: Number(process.env.PORT || 4000),
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/careguide',
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1d',
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS || 12),
  seedOnEmpty: process.env.SEED_ON_EMPTY === 'true',
  enableDocs: process.env.ENABLE_DOCS ? process.env.ENABLE_DOCS === 'true' : process.env.NODE_ENV !== 'production',
  loginRateLimit: Number(process.env.LOGIN_RATE_LIMIT || 10),
};
