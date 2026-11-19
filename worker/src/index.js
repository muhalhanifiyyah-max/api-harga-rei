// API Harga Emas Raja Emas Indonesia — Cloudflare Worker
//
// Ada 2 tabel yang BERBEDA, masing-masing dengan pembagian wilayahnya sendiri:
//   karat      = "Kadar Karat / Harga per Gram"           (widget kode 1)
//   kami-beli  = "Harga Kami Beli" Produk/Kadar/Harga/Karat (widget kode 2)
// Contoh: Lombok ikut grup Bali-Sumatera di tabel karat, tetapi ikut grup
// Kalimantan-Sulawesi di tabel kami-beli. Karena itu wilayahnya tidak digabung.
//
// Endpoint:
//   GET /harga                         kedua tabel, semua wilayah
//   GET /harga/{tabel}                 satu tabel (karat | kami-beli), semua wilayahnya
//   GET /harga/{tabel}/{wilayah}       satu tabel, satu wilayah
//   GET /wilayah                       daftar wilayah per tabel
//
// Cache: hasil disimpan 5 menit di cache Cloudflare. Bila Google Sheets gagal,
// API memakai data sukses terakhir (disimpan 7 hari) dan menandai "sumber": "cadangan".

const SHEET_KARAT = "https://docs.google.com/spreadsheets/d/e/2PACX-1vS1QByeOegYIPE9NBLLJAIyrO2JSYdnoVxQguQLBrlHGm2NYSqYg54FOocoYYnMMQd1TdO7X4-VplMy/pub?single=true&output=csv&gid=";
const SHEET_BELI = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQIWOv_35OmEkGb_1VOL3a_xb8i4UFGWHt1VdCIhdys4jNnOEWGnJaNI8lwcQ6356Uspk_Q0Gjw_NH5/pub?single=true&output=csv&gid=";

const TABEL = {
  karat: {
    judul: "Harga per Karat",
    kolom: ["produk", "harga"],
    map: mapKarat,
    wilayah: [
      { id: "jawa", nama: "Pulau Jawa", csv: SHEET_KARAT + "0" },
      { id: "bali-sumatera-lombok-bangka", nama: "Bali, Sumatera, Lombok & Bangka", csv: SHEET_KARAT + "491816101" },
      { id: "kalimantan-sulawesi-indonesia-timur", nama: "Kalimantan, Sulawesi & Indonesia Timur", csv: SHEET_KARAT + "1716259668" },
      { id: "batam", nama: "Batam", csv: SHEET_KARAT + "1772291068" },
    ],
  },
  "kami-beli": {
    judul: "Harga Kami Beli",
    kolom: ["produk", "kadar", "harga", "karat"],
    map: mapKamiBeli,
    wilayah: [
      { id: "jawa", nama: "Pulau Jawa", csv: SHEET_BELI + "0" },
      { id: "sumatera-bali", nama: "Sumatera & Bali", csv: SHEET_BELI + "1366444490" },
      { id: "kalimantan-sulawesi-lombok", nama: "Kalimantan, Sulawesi & Lombok", csv: SHEET_BELI + "1711024352" },
      { id: "batam", nama: "Batam", csv: SHEET_BELI + "1704226328" },
    ],
  },
};

const CACHE_TTL = 300; // detik (5 menit, sama dengan widget lama)
const BACKUP_TTL = 7 * 24 * 3600; // data sukses terakhir
const KEY_DATA = "https://cache.internal/harga-v2";
const KEY_BACKUP = "https://cache.internal/harga-v2-backup";

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
    if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "Metode tidak didukung" }, 405);

    const parts = new URL(request.url).pathname.replace(/^\/+|\/+$/g, "").split("/");

    if (parts[0] === "") {
      return json({
        nama: "API Harga Emas Raja Emas",
        endpoint: ["/harga", "/harga/{tabel}", "/harga/{tabel}/{wilayah}", "/wilayah"],
        tabel: Object.keys(TABEL),
      });
    }
    if (parts[0] === "wilayah" && parts.length === 1) {
      const out = {};
      for (const [id, t] of Object.entries(TABEL)) {
        out[id] = { judul: t.judul, wilayah: t.wilayah.map(({ id, nama }) => ({ id, nama })) };
      }
      return json({ tabel: out }, 200, 3600);
    }
    if (parts[0] !== "harga" || parts.length > 3) return json({ error: "Endpoint tidak ditemukan" }, 404);

    const [, tabelId, wilayahId] = parts;
    if (tabelId && !TABEL[tabelId]) {
      return json({ error: "Tabel harus 'karat' atau 'kami-beli'" }, 404);
    }
    if (wilayahId && !TABEL[tabelId].wilayah.some((w) => w.id === wilayahId)) {
      return json({ error: `Wilayah '${wilayahId}' tidak ada di tabel ${tabelId}. Lihat /wilayah` }, 404);
    }

    const data = await getData(ctx);
    if (!data) return json({ error: "Gagal mengambil data harga dari Google Sheets" }, 502);

    const meta = { diperbarui: data.diperbarui, sumber: data.sumber, mata_uang: "IDR", satuan: "gram" };
    const maxAge = data.sumber === "langsung" ? 60 : 0;

    if (!tabelId) return json({ ...meta, tabel: data.tabel }, 200, maxAge);
    const t = data.tabel[tabelId];
    if (!wilayahId) return json({ ...meta, tabel: tabelId, judul: t.judul, kolom: t.kolom, wilayah: t.wilayah }, 200, maxAge);
    return json(
      { ...meta, tabel: tabelId, judul: t.judul, kolom: t.kolom, wilayah: t.wilayah.find((w) => w.id === wilayahId) },
      200,
      maxAge,
    );
  },
};

// ---------------------------------------------------------------- data + cache

async function getData(ctx) {
  const cache = caches.default;
  const hit = await cache.match(KEY_DATA);
  if (hit) return hit.json();

  const backupRes = await cache.match(KEY_BACKUP);
  const backup = backupRes ? await backupRes.json() : null;

  let partial = false;
  let adaData = false;
  const tabel = {};

  await Promise.all(
    Object.entries(TABEL).map(async ([tid, t]) => {
      const wilayah = await Promise.all(
        t.wilayah.map(async (w) => {
          let harga = await fetchTable(w.csv, t.map);
          if (!harga) {
            partial = true;
            harga = backup?.tabel?.[tid]?.wilayah.find((b) => b.id === w.id)?.harga ?? [];
          }
          if (harga.length) adaData = true;
          return { id: w.id, nama: w.nama, harga };
        }),
      );
      tabel[tid] = { judul: t.judul, kolom: t.kolom, wilayah };
    }),
  );

  if (!adaData) return null;

  // Urutan tabel tetap seperti di TABEL.
  const urut = Object.fromEntries(Object.keys(TABEL).map((k) => [k, tabel[k]]));
  const data = { diperbarui: new Date().toISOString(), sumber: partial ? "cadangan" : "langsung", tabel: urut };
  const put = (key, ttl) =>
    cache.put(key, new Response(JSON.stringify(data), { headers: { "Cache-Control": `max-age=${ttl}` } }));

  // Data parsial hanya di-cache 60 detik agar segera dicoba lagi.
  ctx.waitUntil(put(KEY_DATA, partial ? 60 : CACHE_TTL));
  if (!partial) ctx.waitUntil(put(KEY_BACKUP, BACKUP_TTL));
  return data;
}

/** Mengembalikan array item, atau null bila gagal/kosong. */
async function fetchTable(url, mapper) {
  try {
    const res = await fetch(url + "&cb=" + Date.now(), {
      signal: AbortSignal.timeout(10000),
      cf: { cacheTtl: 0 },
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text.trim() || /<html/i.test(text)) return null;
    const items = mapper(parseCSV(text));
    return items.length ? items : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- parsing

export function parseCSV(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell.trim()); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim()); cell = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

/** "Rp 2,190,000" / "Rp 245.000" -> 2190000 / 245000. Harga per gram selalu rupiah bulat. */
export function parseHarga(raw) {
  const d = String(raw ?? "").replace(/\D+/g, "");
  return d ? parseInt(d, 10) : null;
}

export const rupiah = (n) => "Rp " + n.toLocaleString("id-ID");

function col(header, keywords, fallback) {
  const i = header.findIndex((h) => keywords.some((k) => h.toLowerCase().includes(k)));
  return i === -1 ? fallback : i;
}

const rapikan = (s) => (s ?? "").replace(/\s+/g, " ").trim();

export function mapKarat(rows) {
  const [header = [], ...data] = rows;
  const ip = col(header, ["produk", "kadar", "karat"], 0);
  const ih = col(header, ["harga", "price"], 1);
  return data
    .map((r) => ({ produk: rapikan(r[ip]), harga: parseHarga(r[ih]) }))
    .filter((x) => x.produk && x.harga !== null)
    .map((x) => ({ ...x, harga_format: rupiah(x.harga) }));
}

export function mapKamiBeli(rows) {
  const [header = [], ...data] = rows;
  const ip = col(header, ["produk"], 0);
  const ik = col(header, ["kadar"], 1);
  const ih = col(header, ["harga", "price"], 2);
  const ic = col(header, ["karat"], 3);
  return data
    .map((r) => {
      const karat = rapikan(r[ic]);
      return {
        produk: rapikan(r[ip]),
        kadar: rapikan(r[ik]),
        karat: karat && karat !== "-" ? karat : null,
        harga: parseHarga(r[ih]),
      };
    })
    .filter((x) => x.produk && x.harga !== null)
    .map((x) => ({ ...x, harga_format: rupiah(x.harga) }));
}

// ---------------------------------------------------------------- response

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(body, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store",
      ...cors(),
    },
  });
}
