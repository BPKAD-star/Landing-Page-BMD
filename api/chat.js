// api/chat.js — Vercel Serverless Function
// RAG: Voyage AI (embed) + Supabase (retrieval) + Claude Haiku (generate)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { messages } = req.body;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  const VOYAGE_API_KEY    = process.env.VOYAGE_API_KEY;
  const SUPABASE_URL      = process.env.SUPABASE_URL;
  const SUPABASE_KEY      = process.env.SUPABASE_SERVICE_KEY;

  if (!ANTHROPIC_API_KEY || !VOYAGE_API_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Missing environment variables' });
  }

  const userQuery = messages[messages.length - 1].content;

  // ── STEP 1: Embed query user via Voyage AI ──────────────────────
  let queryEmbedding;
  try {
    const embedRes = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${VOYAGE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        input: [userQuery],
        model: 'voyage-3-lite'
      })
    });
    if (!embedRes.ok) throw new Error(`Voyage error ${embedRes.status}`);
    const embedData = await embedRes.json();
    queryEmbedding = embedData.data[0].embedding;
  } catch (err) {
    console.error('Embedding error:', err);
    // Fallback: tetap jawab tanpa RAG kalau Voyage gagal
    queryEmbedding = null;
  }

  // ── STEP 2: Cari pasal relevan di Supabase ──────────────────────
  let contextChunks = [];
  if (queryEmbedding) {
    try {
      const searchRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/match_regulasi`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query_embedding: queryEmbedding,
          match_threshold: 0.5,
          match_count: 4
        })
      });
      if (searchRes.ok) {
        contextChunks = await searchRes.json();
      }
    } catch (err) {
      console.error('Supabase search error:', err);
    }
  }

  // ── STEP 3: Build system prompt dengan konteks pasal ───────────
  const BASE_SYSTEM = `Kamu adalah Asisten BMD dari BKAD Kabupaten Kediri. Bantu aparatur SKPD memahami regulasi dan prosedur pengelolaan Barang Milik Daerah.

ATURAN JAWABAN:
- Jawab singkat dan langsung ke inti. Maksimal 5 kalimat untuk pertanyaan sederhana.
- Gunakan poin atau nomor hanya jika ada lebih dari 3 item.
- Selalu sebut nomor pasal jika relevan.
- Jika di luar topik BMD, tolak dengan sopan.
- JANGAN gunakan markdown (##, **, dll). Tulis plain text saja.

DASAR HUKUM:
- PP 27/2014 jo PP 28/2020
- Permendagri 19/2016 (pedoman pokok)
- Permendagri 47/2021 (teknis penatausahaan)
- Permendagri 7/2024 (perubahan terbaru)`;

  let systemPrompt = BASE_SYSTEM;

  if (contextChunks.length > 0) {
    const pasalContext = contextChunks
      .map(c => `[${c.source} - ${c.pasal}]\n${c.content}`)
      .join('\n\n');
    systemPrompt += `\n\nPASAL RELEVAN DARI DATABASE REGULASI:\n${pasalContext}\n\nGunakan pasal di atas sebagai referensi utama untuk menjawab pertanyaan. Sebutkan sumber pasalnya.`;
  }

  // ── STEP 4: Call Claude Haiku ───────────────────────────────────
  const anthropicMessages = messages.map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content
  }));

  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 512,
        system: systemPrompt,
        messages: anthropicMessages
      })
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.json();
      return res.status(claudeRes.status).json({ error: err.error?.message || 'Claude error' });
    }

    const claudeData = await claudeRes.json();
    const text = claudeData.content?.[0]?.text || 'Maaf, tidak ada respons.';
    return res.status(200).json({ reply: text });

  } catch (err) {
    console.error('Claude error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}