export type Env = {
  DB: D1Database
  JWT_SECRET: string
  REFRESH_SECRET: string
  ENVIRONMENT: string
  SYNC_DO: DurableObjectNamespace
}
