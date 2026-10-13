import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({ service: "ok", fuyao: process.env.FUYAO_API_KEY ? "configured" : "not_configured", model: process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL ? "configured" : "not_configured", ifind: process.env.IFIND_EVENT_SNAPSHOT_JSON ? "verified_snapshot" : process.env.IFIND_API_KEY ? "configured" : "not_configured" });
}
