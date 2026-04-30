export default function handler(req, res) {
  res.status(200).json({
    has_key: !!process.env.ANTHROPIC_API_KEY,
    key_length: process.env.ANTHROPIC_API_KEY?.length || 0,
    key_prefix: process.env.ANTHROPIC_API_KEY?.slice(0, 12) || "missing",
    node_version: process.version,
    env_keys: Object.keys(process.env).filter(k => k.includes("ANTHROPIC") || k.includes("STRIPE"))
  });
}
