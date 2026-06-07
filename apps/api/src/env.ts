export type Env = {
  DB: D1Database
  JWT_SECRET: string
  REFRESH_SECRET: string
  RESEND_API_KEY: string
  ENVIRONMENT: string
  SYNC_DO: DurableObjectNamespace
}
