export const env = {
  get DATABASE_URL(): string {
    return required("DATABASE_URL");
  },
  get REDIS_URL(): string {
    return process.env.REDIS_URL ?? "redis://localhost:6379";
  },
  get OPENAI_MODEL(): string {
    return process.env.OPENAI_MODEL ?? "gpt-5.5";
  },
  get UPLOAD_DIR(): string {
    return process.env.UPLOAD_DIR ?? "./uploads";
  },
  get APP_URL(): string {
    return process.env.APP_URL ?? "http://localhost:3000";
  },
  get AUTH_GOOGLE_ID(): string {
    return required("AUTH_GOOGLE_ID");
  },
  get AUTH_GOOGLE_SECRET(): string {
    return required("AUTH_GOOGLE_SECRET");
  },
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
