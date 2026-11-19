import { TabelKarat, TabelKamiBeli } from "@/components/TabelHarga";
import { getHargaSemua } from "@/lib/harga-emas";

export const revalidate = 300; // halaman dibangun ulang paling lama tiap 5 menit

export default async function HalamanHarga() {
  const data = await getHargaSemua();
  return (
    <main>
      <h1>Harga Emas Hari Ini</h1>
      <h2>{data.tabel.karat.judul}</h2>
      <TabelKarat data={data} />
      <h2>{data.tabel["kami-beli"].judul}</h2>
      <TabelKamiBeli data={data} />
    </main>
  );
}
