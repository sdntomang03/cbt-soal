import sqlite3
from pathlib import Path


OUTPUT = Path(__file__).resolve().parents[1] / "public" / "latihan-contoh.db"

schema = """
PRAGMA foreign_keys = ON;
CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0
);
CREATE TABLE packages (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  difficulty TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0
);
CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  position INTEGER DEFAULT 0,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  explanation TEXT DEFAULT ''
);
CREATE TABLE options (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  option_text TEXT NOT NULL,
  is_correct INTEGER DEFAULT 0,
  score_weight REAL,
  position INTEGER DEFAULT 0
);
CREATE TABLE matches (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  premise_text TEXT NOT NULL,
  target_id TEXT NOT NULL
);
CREATE TABLE targets (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  target_text TEXT NOT NULL,
  position INTEGER DEFAULT 0
);
CREATE TABLE learning_materials (
  id TEXT PRIMARY KEY,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  summary TEXT DEFAULT '',
  content TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);
CREATE INDEX idx_learning_materials_category_order
  ON learning_materials(category_id, sort_order, title);

INSERT INTO categories VALUES
  ('tkp', 'TKP', 'Tes Karakteristik Pribadi', 1),
  ('twk', 'TWK', 'Tes Wawasan Kebangsaan', 2),
  ('tiu', 'TIU', 'Tes Intelegensia Umum', 3);

INSERT INTO learning_materials (id, category_id, title, summary, content, sort_order) VALUES
  ('materi-tkp-pelayanan-publik', 'tkp', 'Pelayanan Publik',
   'Prinsip dasar memberikan pelayanan yang profesional dan berorientasi pada masyarakat.',
   '<h2>Prinsip pelayanan publik</h2><p>Pelayanan publik adalah kegiatan untuk memenuhi kebutuhan masyarakat atas barang, jasa, dan pelayanan administratif. Petugas perlu memberikan layanan yang adil, ramah, transparan, dan bertanggung jawab.</p><h3>Sikap yang perlu diterapkan</h3><ul><li><strong>Berorientasi pada pelayanan:</strong> memahami kebutuhan dan membantu masyarakat dengan sungguh-sungguh.</li><li><strong>Akuntabel:</strong> bekerja dengan jujur, cermat, disiplin, dan bertanggung jawab.</li><li><strong>Kompeten:</strong> terus belajar agar mampu memberikan layanan yang bermutu.</li><li><strong>Adaptif:</strong> menyesuaikan cara kerja terhadap perubahan kebutuhan dan teknologi.</li></ul><p>Dalam menghadapi keluhan, dengarkan dengan tenang, klarifikasi kebutuhan, jelaskan solusi sesuai prosedur, dan pastikan masyarakat memahami langkah berikutnya.</p>',
   1),
  ('materi-twk-pancasila', 'twk', 'Pancasila sebagai Dasar Negara',
   'Memahami kedudukan, fungsi, dan nilai-nilai Pancasila dalam kehidupan berbangsa.',
   '<h2>Kedudukan Pancasila</h2><p>Pancasila merupakan dasar negara dan pandangan hidup bangsa Indonesia. Nilai-nilainya menjadi pedoman dalam penyelenggaraan negara serta kehidupan bermasyarakat.</p><h3>Lima sila Pancasila</h3><ol><li>Ketuhanan Yang Maha Esa</li><li>Kemanusiaan yang adil dan beradab</li><li>Persatuan Indonesia</li><li>Kerakyatan yang dipimpin oleh hikmat kebijaksanaan dalam permusyawaratan/perwakilan</li><li>Keadilan sosial bagi seluruh rakyat Indonesia</li></ol><h3>Penerapan nilai</h3><p>Contohnya adalah menghormati kebebasan beragama, memperlakukan orang secara adil, menjaga persatuan, bermusyawarah untuk mengambil keputusan, dan bergotong royong mewujudkan kesejahteraan bersama.</p>',
   1),
  ('materi-tiu-aljabar-dasar', 'tiu', 'Dasar Aljabar',
   'Mengenal variabel dan menyelesaikan persamaan linear satu variabel.',
   '<h2>Variabel dan persamaan</h2><p>Variabel adalah lambang yang mewakili suatu nilai, biasanya ditulis dengan huruf seperti $x$ atau $y$. Persamaan linear satu variabel dapat ditulis dalam bentuk $ax + b = c$, dengan $a \\ne 0$.</p><h3>Langkah penyelesaian</h3><p>Lakukan operasi yang sama pada kedua ruas agar variabel berada di satu ruas dan konstanta di ruas lainnya.</p><p>Contoh: selesaikan $2x + 3 = 11$.</p><ol><li>Kurangi kedua ruas dengan 3: $2x = 8$.</li><li>Bagi kedua ruas dengan 2: $x = 4$.</li></ol><p>Periksa hasil dengan memasukkan kembali nilai $x$: $2(4) + 3 = 11$.</p>',
   1);

INSERT INTO packages VALUES
  ('tkp-paket-1', 'tkp', 'Paket 1', 'Latihan situasi kerja dan pelayanan publik.', 'Dasar', 1),
  ('twk-paket-1', 'twk', 'Paket 1', 'Latihan wawasan kebangsaan.', 'Dasar', 1),
  ('tiu-paket-1', 'tiu', 'Paket 1', 'Latihan kemampuan numerik dan logika.', 'Dasar', 1);

INSERT INTO questions VALUES
  ('tkp-q1', 'tkp-paket-1', 1, 'tkp',
   '<p>Seorang warga kesulitan memahami prosedur layanan yang baru. Apa tindakan yang paling tepat?</p>',
   '<p>Berikan bantuan dengan sabar dan jelaskan langkah yang perlu dilakukan secara jelas.</p>'),
  ('twk-q1', 'twk-paket-1', 1, 'single_choice',
   '<p>Nilai utama yang tercermin dalam kegiatan musyawarah untuk mencapai mufakat adalah ...</p>',
   '<p>Musyawarah mencerminkan pengambilan keputusan bersama dan menghargai pendapat, sejalan dengan sila keempat Pancasila.</p>'),
  ('tiu-q1', 'tiu-paket-1', 1, 'single_choice',
   '<p>Jika $2x + 3 = 11$, berapakah nilai $x$?</p>',
   '<p>Kurangi kedua ruas dengan 3, lalu bagi dengan 2. Jadi $x = 4$.</p>');

INSERT INTO options VALUES
  ('tkp-o1', 'tkp-q1', '<p>Mengabaikan pertanyaan karena warga seharusnya membaca pengumuman.</p>', 0, 1, 1),
  ('tkp-o2', 'tkp-q1', '<p>Menjelaskan prosedur dengan ramah dan memastikan warga memahami langkahnya.</p>', 0, 5, 2),
  ('tkp-o3', 'tkp-q1', '<p>Meminta warga kembali lain hari tanpa menjelaskan alasannya.</p>', 0, 2, 3),
  ('tkp-o4', 'tkp-q1', '<p>Mengarahkan warga kepada petugas terkait sambil memberi informasi yang diperlukan.</p>', 0, 4, 4),
  ('twk-o1', 'twk-q1', '<p>Musyawarah untuk mencapai mufakat</p>', 1, NULL, 1),
  ('twk-o2', 'twk-q1', '<p>Persaingan untuk memperoleh kedudukan</p>', 0, NULL, 2),
  ('twk-o3', 'twk-q1', '<p>Keputusan sepihak oleh kelompok terbanyak</p>', 0, NULL, 3),
  ('twk-o4', 'twk-q1', '<p>Kebebasan tanpa tanggung jawab</p>', 0, NULL, 4),
  ('tiu-o1', 'tiu-q1', '<p>$x = 3$</p>', 0, NULL, 1),
  ('tiu-o2', 'tiu-q1', '<p>$x = 4$</p>', 1, NULL, 2),
  ('tiu-o3', 'tiu-q1', '<p>$x = 5$</p>', 0, NULL, 3),
  ('tiu-o4', 'tiu-q1', '<p>$x = 7$</p>', 0, NULL, 4);
"""

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
if OUTPUT.exists():
    raise FileExistsError(f"Refusing to overwrite existing database: {OUTPUT}")
with sqlite3.connect(OUTPUT) as connection:
    connection.executescript(schema)
    result = connection.execute("PRAGMA integrity_check").fetchone()[0]
    if result != "ok":
        raise sqlite3.DatabaseError(f"SQLite integrity check failed: {result}")

print(f"Created {OUTPUT}")
