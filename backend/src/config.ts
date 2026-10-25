import "dotenv/config";

export const config = {
  port: Number(process.env.PORT) || 3001,
  openclaw: {
    url: process.env.OPENCLAW_URL?.trim() || undefined,
    token: process.env.OPENCLAW_TOKEN?.trim() || undefined,
  },
};
