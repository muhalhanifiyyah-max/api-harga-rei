"use client";

// Dua tabel terpisah seperti widget aslinya, masing-masing dengan dropdown wilayahnya sendiri:
//   <TabelKarat>    = widget kode 1 (Kadar Karat / Harga per Gram)
//   <TabelKamiBeli> = widget kode 2 (Harga Kami Beli)
// Data diambil di server (lihat app/harga/page.tsx) lalu dikirim sebagai props.

import { useState } from "react";
import type { HargaSemua, Tabel } from "@/lib/harga-emas";

function useWilayah<Id extends string, Item>(tabel: Tabel<Id, Item>) {
  const [aktif, setAktif] = useState<Id | undefined>(tabel.wilayah[0]?.id);
  const w = tabel.wilayah.find((x) => x.id === aktif) ?? tabel.wilayah[0];
  const select = (
    <>
      <label className="rei-label">
        Pilih Wilayah
        <select className="rei-select" value={w?.id} onChange={(e) => setAktif(e.target.value as Id)}>
          {tabel.wilayah.map((x) => (
            <option key={x.id} value={x.id}>{x.nama}</option>
          ))}
        </select>
      </label>
    </>
  );
  return { w, select };
}

export function TabelKarat({ data }: { data: HargaSemua }) {
  const { w, select } = useWilayah(data.tabel.karat);
  if (!w) return <p>Data harga belum tersedia.</p>;
  return (
    <section className="rei-harga">
      {select}
      <table className="rei-table">
        <thead><tr><th>Kadar Karat</th><th>Harga per Gram</th></tr></thead>
        <tbody>
          {w.harga.map((r) => (
            <tr key={r.produk}><td>{r.produk}</td><td>{r.harga_format}</td></tr>
          ))}
        </tbody>
      </table>
      <Catatan iso={data.diperbarui} />
    </section>
  );
}

export function TabelKamiBeli({ data }: { data: HargaSemua }) {
  const { w, select } = useWilayah(data.tabel["kami-beli"]);
  if (!w) return <p>Data harga belum tersedia.</p>;
  return (
    <section className="hkb-harga">
      {select}
      <table className="hkb-table">
        <thead><tr><th>Produk</th><th>Kadar</th><th>Harga</th><th>Karat</th></tr></thead>
        <tbody>
          {w.harga.map((r) => (
            <tr key={r.produk}>
              <td>{r.produk}</td><td>{r.kadar}</td><td>{r.harga_format}</td><td>{r.karat ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Catatan iso={data.diperbarui} />
    </section>
  );
}

function Catatan({ iso }: { iso: string }) {
  const waktu = new Date(iso).toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  });
  return <p className="rei-note">Diperbarui {waktu} WIB · Harga dapat berubah sewaktu-waktu</p>;
}
