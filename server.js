const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Rute utama untuk menampilkan index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Inisialisasi Database SQLite
const db = new sqlite3.Database('./database.sqlite', (err) => {
  if (err) {
    console.error('Gagal membuka database SQLite:', err.message);
  } else {
    console.log('Terhubung ke database SQLite.');
    initDatabase();
  }
});

// Skema & Data Awal (Seeder Otomatis)
function initDatabase() {
  db.serialize(() => {
    // Tabel Users
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      nama TEXT NOT NULL,
      must_change_password INTEGER DEFAULT 1
    )`);

    // Tabel Anggota / Nasabah (Contoh tambahan tabel data warga)
    db.run(`CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nik TEXT,
      nama TEXT NOT NULL,
      alamat TEXT,
      no_hp TEXT,
      kategori TEXT
    )`);

    // Tabel Transaksi Kas
    db.run(`CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tanggal TEXT NOT NULL,
      jenis TEXT NOT NULL,
      keterangan TEXT,
      jumlah REAL NOT NULL,
      kategori_kas TEXT
    )`);

    // Masukkan Super Admin Default
    db.get(`SELECT * FROM users WHERE username = 'admin'`, async (err, row) => {
      if (!row) {
        const hashedPassword = await bcrypt.hash('admin123', 10);
        db.run(
          `INSERT INTO users (username, password, role, nama, must_change_password) VALUES (?, ?, ?, ?, ?)`,
          ['admin', hashedPassword, 'SUPER_ADMIN', 'Super Admin RT/RW', 1],
          (err) => {
            if (!err) {
              console.log('Akun Super Admin Default Berhasil Dibuat!');
            }
          }
        );
      }
    });
  });
}

// ==================== ENDPOINT AUTHENTICATION ====================

// Endpoint Login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username dan Password wajib diisi!' });
  }

  db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server.' });
    }

    if (!user) {
      return res.status(400).json({ success: false, message: 'Username atau Password Salah!' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(400).json({ success: false, message: 'Username atau Password Salah!' });
    }

    res.json({
      success: true,
      message: 'Login Berhasil',
      user: {
        id: user.id,
        username: user.username,
        nama: user.nama,
        role: user.role,
        mustChangePassword: Boolean(user.must_change_password)
      }
    });
  });
});

// Endpoint Ganti Password
app.post('/api/change-password', async (req, res) => {
  const { username, newPassword } = req.body;

  if (!username || !newPassword) {
    return res.status(400).json({ success: false, message: 'Data tidak lengkap!' });
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);

  db.run(
    `UPDATE users SET password = ?, must_change_password = 0 WHERE username = ?`,
    [hashedPassword, username],
    function (err) {
      if (err) {
        return res.status(500).json({ success: false, message: 'Gagal memperbarui password.' });
      }
      res.json({ success: true, message: 'Password berhasil diperbarui!' });
    }
  );
});

// ==================== ENDPOINT DATA ANGGOTA / NASABAH ====================

// Ambil Semua Data Anggota
app.get('/api/members', (req, res) => {
  db.all(`SELECT * FROM members`, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Gagal mengambil data anggota.' });
    }
    res.json({ success: true, data: rows });
  });
});

// Tambah Anggota Baru
app.post('/api/members', (req, res) => {
  const { nik, nama, alamat, no_hp, kategori } = req.body;
  if (!nama) {
    return res.status(400).json({ success: false, message: 'Nama wajib diisi!' });
  }

  db.run(
    `INSERT INTO members (nik, nama, alamat, no_hp, kategori) VALUES (?, ?, ?, ?, ?)`,
    [nik, nama, alamat, no_hp, kategori],
    function (err) {
      if (err) {
        return res.status(500).json({ success: false, message: 'Gagal menambah anggota.' });
      }
      res.json({ success: true, message: 'Anggota berhasil ditambahkan!', id: this.lastID });
    }
  );
});

// ==================== ENDPOINT TRANSAKSI KAS ====================

// Ambil Semua Transaksi Kas
app.get('/api/transactions', (req, res) => {
  db.all(`SELECT * FROM transactions ORDER BY id DESC`, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Gagal mengambil data transaksi.' });
    }
    res.json({ success: true, data: rows });
  });
});

// Tambah Transaksi Kas (Masuk / Keluar)
app.post('/api/transactions', (req, res) => {
  const { tanggal, jenis, keterangan, jumlah, kategori_kas } = req.body;
  
  db.run(
    `INSERT INTO transactions (tanggal, jenis, keterangan, jumlah, kategori_kas) VALUES (?, ?, ?, ?, ?)`,
    [tanggal, jenis, keterangan, jumlah, kategori_kas],
    function (err) {
      if (err) {
        return res.status(500).json({ success: false, message: 'Gagal mencatat transaksi.' });
      }
      res.json({ success: true, message: 'Transaksi berhasil disimpan!', id: this.lastID });
    }
  );
});

// Jalankan Server
app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});
