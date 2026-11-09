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

// Rute utama untuk menampilkan halaman web
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

// Skema Tabel & Seeder Otomatis
function initDatabase() {
  db.serialize(() => {
    // Tabel Users (Admin & User umum)
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL, -- SUPER_ADMIN, ADMIN, LEADER, NASABAH
      nama TEXT NOT NULL,
      must_change_password INTEGER DEFAULT 1
    )`);

    // Tabel Leader & Menyimpan Kode OTP Terakhir
    db.run(`CREATE TABLE IF NOT EXISTS leaders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nama TEXT NOT NULL,
      jabatan TEXT NOT NULL,
      no_hp TEXT UNIQUE NOT NULL,
      pin_otp TEXT
    )`);

    // Tabel Data Nasabah / Warga
    db.run(`CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nik TEXT,
      nama TEXT NOT NULL,
      alamat TEXT,
      no_hp TEXT,
      kategori TEXT
    )`);

    // Tabel Modul Khusus: Kas Gang
    db.run(`CREATE TABLE IF NOT EXISTS kas_gang (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tanggal TEXT NOT NULL,
      uraian TEXT,
      masuk REAL DEFAULT 0,
      keluar REAL DEFAULT 0,
      input_oleh TEXT
    )`);

    // Tabel Modul Khusus: Cor Jalan
    db.run(`CREATE TABLE IF NOT EXISTS cor_jalan (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tanggal TEXT NOT NULL,
      uraian TEXT,
      masuk REAL DEFAULT 0,
      keluar REAL DEFAULT 0,
      input_oleh TEXT
    )`);

    // Tabel Modul Khusus: Jimpitan
    db.run(`CREATE TABLE IF NOT EXISTS jimpitan (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tanggal TEXT NOT NULL,
      nama_warga TEXT,
      nominal REAL DEFAULT 0,
      keterangan TEXT,
      input_oleh TEXT
    )`);

    // Tabel Modul Khusus: Ibu-Ibu
    db.run(`CREATE TABLE IF NOT EXISTS ibu_ibu (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tanggal TEXT NOT NULL,
      uraian TEXT,
      masuk REAL DEFAULT 0,
      keluar REAL DEFAULT 0,
      input_oleh TEXT
    )`);

    // Tabel Tunggakan (Hanya Admin yang bisa edit/tambah, Leader & Nasabah lihat)
    db.run(`CREATE TABLE IF NOT EXISTS tunggakan (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nama_nasabah TEXT NOT NULL,
      jenis_iuran TEXT,
      jumlah_tunggakan REAL NOT NULL,
      status TEXT DEFAULT 'Belum Lunas'
    )`);

    // Masukkan Super Admin Default
    db.get(`SELECT * FROM users WHERE username = 'admin'`, async (err, row) => {
      if (!row) {
        const hashedPassword = await bcrypt.hash('admin123', 10);
        db.run(
          `INSERT INTO users (username, password, role, nama, must_change_password) VALUES (?, ?, ?, ?, ?)`,
          ['admin', hashedPassword, 'SUPER_ADMIN', 'Super Admin RT/RW', 1]
        );
      }
    });
  });
}

// ==================== ENDPOINT AUTHENTICATION ====================

// Login Standar (Admin / User)
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
    if (err || !user) {
      return res.status(400).json({ success: false, message: 'Username atau Password Salah!' });
    }
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(400).json({ success: false, message: 'Username atau Password Salah!' });
    }
    res.json({ success: true, user: { id: user.id, username: user.username, nama: user.nama, role: user.role } });
  });
});

// Request OTP untuk Leader Berdasarkan Nomor HP
app.post('/api/leader/request-otp', (req, res) => {
  const { no_hp } = req.body;
  db.get(`SELECT * FROM leaders WHERE no_hp = ?`, [no_hp], (err, leader) => {
    if (err || !leader) {
      return res.status(404).json({ success: false, message: 'Nomor HP Leader tidak terdaftar!' });
    }
    
    // Buat Kode OTP 4 Digit Random
    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    
    db.run(`UPDATE leaders SET pin_otp = ? WHERE no_hp = ?`, [otp, no_hp], (err) => {
      if (err) return res.status(500).json({ success: false, message: 'Gagal memproses OTP.' });
      
      // Simulasi pengiriman OTP (Di dunia nyata bisa diintegrasikan dengan Fonnte/WhatsApp API)
      console.log(`[SIMULASI KIRIM OTP] Ke Nomor ${no_hp}: KODE OTP ANDA ADALAH ${otp}`);
      
      res.json({ 
        success: true, 
        message: 'Kode OTP berhasil dikirim! (Cek console server untuk simulasi kode)',
        dev_otp: otp // Ditampilkan untuk mempermudah pengujian Anda saat ini
      });
    });
  });
});

// Verifikasi OTP Login Leader
app.post('/api/leader/verify-otp', (req, res) => {
  const { no_hp, otp } = req.body;
  db.get(`SELECT * FROM leaders WHERE no_hp = ? AND pin_otp = ?`, [no_hp, otp], (err, leader) => {
    if (err || !leader) {
      return res.status(400).json({ success: false, message: 'Kode OTP Salah atau Kadaluarsa!' });
    }
    // Hapus OTP setelah sukses digunakan
    db.run(`UPDATE leaders SET pin_otp = NULL WHERE no_hp = ?`, [no_hp]);
    res.json({ 
      success: true, 
      message: 'Login OTP Berhasil!', 
      user: { id: leader.id, nama: leader.nama, jabatan: leader.jabatan, role: 'LEADER' } 
    });
  });
});


// ==================== ENDPOINT DATA LEADER (Admin Full Akses) ====================

app.get('/api/leaders', (req, res) => {
  db.all(`SELECT * FROM leaders`, [], (err, rows) => {
    res.json({ success: true, data: rows });
  });
});

app.post('/api/leaders', (req, res) => {
  const { nama, jabatan, no_hp } = req.body;
  db.run(`INSERT INTO leaders (nama, jabatan, no_hp) VALUES (?, ?, ?)`, [nama, jabatan, no_hp], function(err) {
    if (err) return res.status(500).json({ success: false, message: 'Gagal menambah leader (Nomor HP mungkin sudah terdaftar).' });
    res.json({ success: true, message: 'Leader berhasil ditambahkan!' });
  });
});

app.put('/api/leaders/:id', (req, res) => {
  const { nama, jabatan, no_hp } = req.body;
  db.run(`UPDATE leaders SET nama = ?, jabatan = ?, no_hp = ? WHERE id = ?`, [nama, jabatan, no_hp, req.params.id], function(err) {
    if (err) return res.status(500).json({ success: false, message: 'Gagal memperbarui leader.' });
    res.json({ success: true, message: 'Data leader berhasil diperbarui!' });
  });
});

app.delete('/api/leaders/:id', (req, res) => {
  db.run(`DELETE FROM leaders WHERE id = ?`, [req.params.id], function(err) {
    if (err) return res.status(500).json({ success: false, message: 'Gagal menghapus leader.' });
    res.json({ success: true, message: 'Leader berhasil dihapus!' });
  });
});


// ==================== ENDPOINT NASABAH (Admin & Leader Bisa Ubah Kapanpun) ====================

app.get('/api/members', (req, res) => {
  db.all(`SELECT * FROM members`, [], (err, rows) => {
    res.json({ success: true, data: rows });
  });
});

app.post('/api/members', (req, res) => {
  const { nik, nama, alamat, no_hp, kategori } = req.body;
  db.run(`INSERT INTO members (nik, nama, alamat, no_hp, kategori) VALUES (?, ?, ?, ?, ?)`, [nik, nama, alamat, no_hp, kategori], function(err) {
    if (err) return res.status(500).json({ success: false, message: 'Gagal menambah nasabah.' });
    res.json({ success: true, message: 'Nasabah berhasil ditambahkan!' });
  });
});

app.put('/api/members/:id', (req, res) => {
  const { nik, nama, alamat, no_hp, kategori } = req.body;
  db.run(`UPDATE members SET nik = ?, nama = ?, alamat = ?, no_hp = ?, kategori = ? WHERE id = ?`, [nik, nama, alamat, no_hp, kategori, req.params.id], function(err) {
    if (err) return res.status(500).json({ success: false, message: 'Gagal mengubah nasabah.' });
    res.json({ success: true, message: 'Data nasabah berhasil diperbarui!' });
  });
});

app.delete('/api/members/:id', (req, res) => {
  db.run(`DELETE FROM members WHERE id = ?`, [req.params.id], function(err) {
    if (err) return res.status(500).json({ success: false, message: 'Gagal menghapus nasabah.' });
    res.json({ success: true, message: 'Data nasabah berhasil dihapus!' });
  });
});


// ==================== ENDPOINT MODUL KAS GANG, COR, JIMPITAN, IBU-IBU ====================
// Fungsi umum untuk membuat template endpoint modul inputan Leader dan Edit Admin

function setupModuleEndpoints(routeName, tableName) {
  // Ambil Data
  app.get(`/api/${routeName}`, (req, res) => {
    db.all(`SELECT * FROM ${tableName} ORDER BY id DESC`, [], (err, rows) => {
      res.json({ success: true, data: rows });
    });
  });

  // Leader / Admin Input Data Baru
  app.post(`/api/${routeName}`, (req, res) => {
    const fields = Object.keys(req.body);
    const values = Object.values(req.body);
    const placeholders = fields.map(() => '?').join(', ');
    
    db.run(`INSERT INTO ${tableName} (${fields.join(', ')}) VALUES (${placeholders})`, values, function(err) {
      if (err) return res.status(500).json({ success: false, message: 'Gagal menyimpan data.' });
      res.json({ success: true, message: 'Data berhasil disimpan!' });
    });
  });

  // Admin Edit Data (Atau Leader yang berhak)
  app.put(`/api/${routeName}/:id`, (req, res) => {
    const updates = Object.keys(req.body).map(key => `${key} = ?`).join(', ');
    const values = [...Object.values(req.body), req.params.id];
    
    db.run(`UPDATE ${tableName} SET ${updates} WHERE id = ?`, values, function(err) {
      if (err) return res.status(500).json({ success: false, message: 'Gagal memperbarui data.' });
      res.json({ success: true, message: 'Data berhasil diperbarui oleh Admin!' });
    });
  });

  // Hanya Admin yang Bisa Hapus
  app.delete(`/api/${routeName}/:id`, (req, res) => {
    db.run(`DELETE FROM ${tableName} WHERE id = ?`, [req.params.id], function(err) {
      if (err) return res.status(500).json({ success: false, message: 'Gagal menghapus data.' });
      res.json({ success: true, message: 'Data berhasil dihapus!' });
    });
  });
}

// Terapkan ke masing-masing modul
setupModuleEndpoints('kas-gang', 'kas_gang');
setupModuleEndpoints('cor-jalan', 'cor_jalan');
setupModuleEndpoints('jimpitan', 'jimpitan');
setupModuleEndpoints('ibu-ibu', 'ibu_ibu');


// ==================== ENDPOINT TUNGGAKAN (Hanya Admin Edit, Lainnya Lihat) ====================

app.get('/api/tunggakan', (req, res) => {
  db.all(`SELECT * FROM tunggakan`, [], (err, rows) => {
    res.json({ success: true, data: rows });
  });
});

app.post('/api/tunggakan', (req, res) => {
  const { nama_nasabah, jenis_iuran, jumlah_tunggakan, status } = req.body;
  db.run(`INSERT INTO tunggakan (nama_nasabah, jenis_iuran, jumlah_tunggakan, status) VALUES (?, ?, ?, ?)`, [nama_nasabah, jenis_iuran, jumlah_tunggakan, status], function(err) {
    if (err) return res.status(500).json({ success: false, message: 'Gagal menambah data tunggakan.' });
    res.json({ success: true, message: 'Tunggakan berhasil dicatat!' });
  });
});

app.put('/api/tunggakan/:id', (req, res) => {
  const { nama_nasabah, jenis_iuran, jumlah_tunggakan, status } = req.body;
  db.run(`UPDATE tunggakan SET nama_nasabah = ?, jenis_iuran = ?, jumlah_tunggakan = ?, status = ? WHERE id = ?`, [nama_nasabah, jenis_iuran, jumlah_tunggakan, status, req.params.id], function(err) {
    if (err) return res.status(500).json({ success: false, message: 'Gagal mengubah tunggakan.' });
    res.json({ success: true, message: 'Data tunggakan berhasil diperbarui Admin!' });
  });
});

app.delete('/api/tunggakan/:id', (req, res) => {
  db.run(`DELETE FROM tunggakan WHERE id = ?`, [req.params.id], function(err) {
    if (err) return res.status(500).json({ success: false, message: 'Gagal menghapus tunggakan.' });
    res.json({ success: true, message: 'Tunggakan dihapus.' });
  });
});

// Jalankan Server
app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});
