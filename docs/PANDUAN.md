# Kirimrasa Web — Panduan Pasang Server Sendiri

Kirimrasa Web adalah versi browser dari aplikasi Kirimrasa. Kamu memasang **server milikmu sendiri** di Render (gratis). Pesan WhatsApp-mu, kontakmu, dan sesi WhatsApp-mu hanya ada di server itu.

Waktu yang dibutuhkan: sekitar **15 menit**, cukup sekali. Bisa dari HP atau laptop, **tanpa terminal dan tanpa kartu kredit**.

---

## 1. Daftar Render (2 menit)

1. Buka **https://render.com** → klik **Get Started** / **Sign Up**.
2. Daftar pakai **Google** atau email. Tidak perlu kartu kredit.
3. Kalau diminta, konfirmasi email.

## 2. Pasang server dengan 1 klik (5 menit)

1. Buka tombol ini: **https://render.com/deploy?repo=https://github.com/jaegu504/kirimrasa-web**
2. Render menampilkan halaman **"Blueprint"** dengan layanan bernama `kirimrasa`.
   - **Blueprint Name:** isi bebas, misalnya `kirimrasa-budi`.
3. Di kolom **APP_PASSWORD**, buat **password** untuk masuk ke Kirimrasa.
   - Minimal 8 karakter, jangan dibagikan ke orang lain.
   - **Catat password ini.**
4. Klik **Deploy Blueprint** (atau **Apply**).
5. Tunggu sampai statusnya **Live** (hijau). Biasanya 3–5 menit.
6. Klik nama layanan `kirimrasa`. Di bagian atas ada alamat seperti **`https://kirimrasa-xxxx.onrender.com`** — itulah alamat Kirimrasa-mu. Simpan di bookmark.

> Server dipasang di Singapura. Untuk pengguna di Turki tetap bisa dipakai normal.

## 3. Masuk dan tautkan WhatsApp (3 menit)

1. Buka alamat Kirimrasa-mu → masukkan **password** tadi.
2. Buka tab **Pengaturan** → di **WhatsApp Pribadi** klik **Tautkan**.
3. Masukkan nomor WhatsApp-mu (contoh `0812xxxx` atau `+90 5xx…`) → muncul **kode 8 huruf**.
4. Di HP: buka **WhatsApp** → **⋮ / Setelan** → **Perangkat tertaut** → **Tautkan perangkat** → **Tautkan dengan nomor telepon saja** → masukkan kodenya.
5. Tunggu beberapa detik sampai statusnya **Tersambung** (titik hijau).

## 4. Supaya server tidak tidur (5 menit, sangat disarankan)

Server gratis Render **tidur** setelah 15 menit tidak dipakai. Saat tidur, pengiriman bisa berhenti. Cegah dengan UptimeRobot (gratis):

1. Daftar di **https://uptimerobot.com**.
2. Klik **+ New Monitor** → tipe **HTTP(s)**.
3. **URL:** alamat Kirimrasa-mu + `/health`, contoh `https://kirimrasa-xxxx.onrender.com/health`
4. **Interval:** 5 menit → **Create Monitor**.

## 5. Mulai kirim

1. **Kontak:** impor file CSV atau VCF. File VCF bisa diekspor dari aplikasi **Kontak** di HP (menu **Ekspor**). Cara mengambil kontak dari Google:
   - Buka **contacts.google.com** → **Ekspor** → pilih **Google CSV** → unduh.
   - Di Kirimrasa tab **Kontak** → **Impor CSV/VCF** → pilih file tadi.
2. Isi **nama panggilan** kontak (dipakai untuk `{Nickname}`).
3. **Kirim:** tulis pesan (sampai 5 balon), boleh pakai **Rapikan (AI)**, lampirkan foto/file, lalu tekan **Kirim**.
4. **Status:** lihat progres. Halaman **boleh ditutup** — pengiriman tetap jalan di server.

## Yang perlu diketahui

- **Restart = tautkan ulang.** Versi gratis Render tidak menyimpan file permanen. Kalau server restart (update, perawatan dari Render), kamu perlu **menautkan WhatsApp lagi**, dan antrean yang sedang jalan berhenti. Kontak dan pengaturan juga bisa hilang — simpan cadangan dengan **Ekspor CSV** di tab Kontak.
- **Ukuran file maksimal 16 MB** per lampiran.
- **Jangan percepat jeda kirim** di bawah bawaan kalau tidak perlu. Jeda acak dan istirahat otomatis melindungi nomormu dari blokir WhatsApp.
- **Kirim hanya ke orang yang kamu kenal.** WhatsApp memblokir nomor yang banyak dilaporkan sebagai spam.

## Update ke versi terbaru

Server-mu **tidak** update otomatis (supaya tidak restart di tengah pengiriman). Saat ada versi baru:

1. Buka **dashboard.render.com** → klik layanan `kirimrasa`.
2. Klik **Manual Deploy** → **Deploy latest commit**.
3. Setelah **Live**, tautkan WhatsApp lagi (langkah 3).

## Ganti password

Render → layanan `kirimrasa` → **Environment** → ubah **APP_PASSWORD** → **Save Changes**. Server akan restart (tautkan WhatsApp lagi).

## Ada masalah?

| Masalah | Coba ini |
|---|---|
| Halaman lama terbuka / loading lama | Server sedang bangun dari tidur, tunggu ±1 menit. Pasang UptimeRobot (langkah 4). |
| Kode tautan gagal | Pastikan nomor benar dengan kode negara, minta kode baru, masukkan dalam 1–2 menit. |
| Status kembali "Belum tertaut" | Server baru restart. Tautkan ulang. |
| Lupa password | Lihat/ubah di Render → Environment → APP_PASSWORD. |

---

# Kirimrasa Web — Kendi Sunucunu Kurma Rehberi

Kirimrasa Web, Kirimrasa uygulamasının tarayıcı sürümüdür. Render'da (ücretsiz) **kendine ait bir sunucu** kurarsın. WhatsApp mesajların, kişilerin ve WhatsApp oturumun yalnızca o sunucuda durur.

Süre: yaklaşık **15 dakika**, bir kez yapılır. Telefondan veya bilgisayardan; **terminal ve kredi kartı gerekmez**.

## 1. Render'a kaydol (2 dk)

1. **https://render.com** → **Get Started / Sign Up**.
2. **Google** veya e-posta ile kaydol. Kredi kartı gerekmez.

## 2. Tek tıkla sunucuyu kur (5 dk)

1. Şu bağlantıyı aç: **https://render.com/deploy?repo=https://github.com/jaegu504/kirimrasa-web**
2. **Blueprint Name:** istediğin bir ad, örn. `kirimrasa-ahmet`.
3. **APP_PASSWORD** alanına Kirimrasa'ya giriş **şifreni** yaz (en az 8 karakter). **Şifreyi not al.**
4. **Deploy Blueprint / Apply**'a tıkla.
5. Durum **Live** (yeşil) olana kadar bekle, genelde 3–5 dakika.
6. `kirimrasa` servisine tıkla. Üstteki **`https://kirimrasa-xxxx.onrender.com`** adresi senin Kirimrasa adresindir. Yer imlerine ekle.

## 3. Giriş yap ve WhatsApp'ı bağla (3 dk)

1. Adresini aç → **şifreni** gir.
2. **Ayarlar** sekmesi → **Kişisel WhatsApp** → **Bağla**.
3. WhatsApp numaranı yaz (örn. `0 5xx xxx xx xx`) → **8 haneli kod** çıkar.
4. Telefonda: **WhatsApp** → **Ayarlar** → **Bağlı cihazlar** → **Cihaz bağla** → **Bunun yerine telefon numarasıyla bağla** → kodu gir.
5. Durum **Bağlı** (yeşil nokta) olana kadar bekle.

> Türkiye'deki kullanıcılar: Ayarlar → **Varsayılan ülke kodu**nu **+90** yap, böylece `05…` ile başlayan numaralar doğru okunur.

## 4. Sunucunun uyumaması için (5 dk, şiddetle önerilir)

Ücretsiz Render sunucusu 15 dakika kullanılmazsa **uyur** ve gönderim durabilir. UptimeRobot (ücretsiz) ile önle:

1. **https://uptimerobot.com** → kaydol.
2. **+ New Monitor** → **HTTP(s)**.
3. **URL:** adresin + `/health`, örn. `https://kirimrasa-xxxx.onrender.com/health`
4. **Interval:** 5 dakika → **Create Monitor**.

## 5. Göndermeye başla

1. **Kişiler:** CSV veya VCF içe aktar (VCF'yi telefonun **Kişiler** uygulamasından **Dışa aktar** ile alabilirsin). Google'dan almak için **contacts.google.com** → **Dışa aktar** → **Google CSV** → indir → Kirimrasa **Kişiler** → **CSV/VCF içe aktar**.
2. Kişilere **hitap adı** ver (`{Nickname}` için kullanılır).
3. **Gönder:** mesajını yaz (5 balona kadar), istersen **Düzenle (AI)**, dosya ekle, **Gönder**'e bas.
4. **Durum:** ilerlemeyi izle. Sayfayı **kapatabilirsin**, gönderim sunucuda devam eder.

## Bilmen gerekenler

- **Yeniden başlatma = yeniden bağlama.** Ücretsiz Render kalıcı dosya saklamaz. Sunucu yeniden başlarsa (güncelleme, bakım) WhatsApp'ı **tekrar bağlaman** gerekir; süren gönderim durur. Kişiler ve ayarlar da silinebilir, **CSV dışa aktar** ile yedek al.
- Ek başına **en fazla 16 MB**.
- Gönderim aralıklarını gereksiz yere kısaltma; rastgele bekleme ve otomatik mola numaranı korur.
- **Yalnızca tanıdığın kişilere** gönder.

## Güncelleme

Sunucu kendiliğinden güncellenmez. Yeni sürümde: **dashboard.render.com** → `kirimrasa` → **Manual Deploy** → **Deploy latest commit** → Live olunca WhatsApp'ı tekrar bağla.

## Şifre değiştirme

Render → `kirimrasa` → **Environment** → **APP_PASSWORD**'u değiştir → **Save Changes**. Sunucu yeniden başlar, WhatsApp'ı tekrar bağla.
