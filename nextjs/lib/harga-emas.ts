// Klien API Harga Emas Raja Emas (Cloudflare Worker di folder ../worker).
// Dipanggil dari Server Component / Route Handler, jadi tidak ada masalah CORS
// dan tidak perlu proxy publik (allorigins / corsproxy) seperti widget lama.
//
// Set di .env.local:
//   RAJAEMAS_API_URL=https://api-harga.rajaemasindonesia.co.id
//
// Dua tabel BERBEDA, masing-masing punya pembagian wilayah sendiri:
//   karat      -> harga per karat (widget kode 1)
//   kami-beli  -> Harga Kami Beli (widget kode 2)

export type ItemKarat = {
  produk: string; // "K24*", "K24 (99.5%)", "K23", ...
  harga: number; // 2190000
  harga_format: string; // "Rp 2.190.000"
};

export type ItemKamiBeli = {
  produk: string; // "LM ANTAM BARU", "PERAK", ...
  kadar: string; // "99.99%"
  karat: string | null; // "K24" atau null
  harga: number;
  harga_format: string;
};

export type WilayahKarat =
  | "jawa"
  | "bali-sumatera-lombok-bangka"
  | "kalimantan-sulawesi-indonesia-timur"
  | "batam";

export type WilayahKamiBeli = "jawa" | "sumatera-bali" | "kalimantan-sulawesi-lombok" | "batam";

export type Wilayah<Id extends string, Item> = { id: Id; nama: string; harga: Item[] };

export type Tabel<Id extends string, Item> = {
  judul: string;
  kolom: string[];
  wilayah: Wilayah<Id, Item>[];
};

export type HargaSemua = {
  diperbarui: string; // ISO 8601 (UTC)
  sumber: "langsung" | "cadangan";
  mata_uang: "IDR";
  satuan: "gram";
  tabel: {
    karat: Tabel<WilayahKarat, ItemKarat>;
    "kami-beli": Tabel<WilayahKamiBeli, ItemKamiBeli>;
  };
};

const BASE = process.env.RAJAEMAS_API_URL;
if (!BASE) throw new Error("RAJAEMAS_API_URL belum di-set di .env.local");
const REVALIDATE = 300; // 5 menit, sama dengan cache di Worker

export async function getHargaSemua(): Promise<HargaSemua> {
  const res = await fetch(`${BASE}/harga`, {
    next: { revalidate: REVALIDATE, tags: ["harga-emas"] },
  });
  if (!res.ok) throw new Error(`API harga emas: HTTP ${res.status}`);
  return res.json();
}
