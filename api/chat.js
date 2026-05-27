// api/chat.js — Vercel Serverless Function
// Backend proxy via Anthropic Claude API

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid request: messages array required' });
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  const SYSTEM_PROMPT = `Kamu adalah Asisten BMD dari BKAD Kabupaten Kediri. Bantu aparatur SKPD memahami regulasi dan prosedur pengelolaan Barang Milik Daerah.

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
- Permendagri 7/2024 (perubahan terbaru)

DEFINISI KUNCI:
- BMD: barang dibeli/diperoleh atas beban APBD atau perolehan sah lainnya.
- Pengelola Barang: Sekretaris Daerah
- Pengguna Barang: Kepala SKPD
- Kuasa Pengguna Barang: Kepala Unit Kerja
- Pengurus Barang Pengguna: ASN yang menatausahakan BMD di SKPD
- Pengurus Barang Pembantu: ASN yang menatausahakan BMD di unit kerja
- KIR: Kartu Inventaris Ruangan, diperbarui tiap semester, rangkap 2
- KIBAR: Kartu Identitas Barang, rekam jejak transaksi setiap BMD
- NIBAR: Nomor Induk Barang, kode permanen sejak perolehan pertama
- Intrakomptabel: Aset Tetap yang memenuhi kriteria kapitalisasi
- Rekonsiliasi: pencocokan data BMD antara SKPD dan BKAD

SIKLUS BMD (Permendagri 19/2016 Pasal 2):
Perencanaan - Pengadaan - Penggunaan - Pemanfaatan - Pengamanan & Pemeliharaan - Penilaian - Pemindahtanganan - Pemusnahan - Penghapusan - Penatausahaan - Pengawasan & Pengendalian

PENATAUSAHAAN (Permendagri 47/2021):
- Inventarisasi persediaan & KDP: minimal 1x/tahun
- Inventarisasi aset tetap lainnya: minimal 1x/5 tahun (sensus BMD)
- Laporan bulanan: paling lambat hari ke-10 bulan berikutnya
- Laporan Semester I: paling lambat minggu ke-4 Juli
- Laporan Semester II: paling lambat minggu ke-2 Februari tahun berikutnya
- Rekonsiliasi SKPD-BKAD: minimal 3 bulan sekali
- Rekonsiliasi dengan fungsi akuntansi: minimal per semester

SEWA BMD (Permendagri 7/2024):
- Formula: Besaran Sewa = Tarif Pokok x Faktor Penyesuai
- Faktor penyesuai: bisnis 100%, koperasi sekunder 75%, koperasi primer 50%, usaha mikro 25%, nonbisnis 30-50%

BATASAN: Tidak bisa akses data aset spesifik SKPD. Arahkan ke BKAD atau e-bmd.kedirikab.go.id.`;

  const anthropicMessages = messages.map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content
  }));

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        messages: anthropicMessages
      })
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ error: err.error?.message || 'Anthropic API error' });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || 'Maaf, tidak ada respons dari sistem.';

    return res.status(200).json({ reply: text });

  } catch (err) {
    console.error('Chat API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}