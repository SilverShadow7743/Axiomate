import 'dotenv/config'
import { defineConfig } from 'prisma/config'

// Prisma 7 reads the connection URL here rather than from the schema file.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url: process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@localhost:5432/axiomate_tms?schema=public',
  },
})
