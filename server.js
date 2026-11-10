const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const upload = multer({ dest: 'uploads/' });

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const db = new sqlite3.Database('./database.sqlite', (err) => {
  if (err) {
    console.error('Gagal membuka database SQLite:', err.message);
  } else {
    console.log('Terhubung ke database SQLite.');
    initDatabase();
  }
});

function initDatabase() {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      nama TEXT NOT NULL,
      must_change_password INTEGER DEFAULT 1
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS leaders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nama TEXT NOT NULL,
      jabatan TEXT NOT NULL,
      no_hp TEXT UNIQUE NOT NULL,
      pic_modul TEXT DEFAULT 'Kas Gang',
      pin_otp TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nik TEXT,
      nama TEXT NOT NULL,
      alamat TEXT,
      no_hp TEXT UNIQUE,
      kategori TEXT,
      pin_otp TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS iuran_warga (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      warga_id INTEGER,
      bulan TEXT NOT NULL,
      tahun TEXT NOT NULL,
      nominal REAL DEFAULT 0,
      keterangan TEXT,
      input_oleh TEXT,
      FOREIGN KEY(warga_id) REFERENCES members(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS agenda_gang (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tanggal TEXT NOT NULL,
      waktu TEXT,
      nama_kegiatan TEXT NOT NULL,
      lokasi TEXT,
      keterangan TEXT,
      input_oleh TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS kas_gang (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tanggal TEXT NOT NULL,
      uraian TEXT,
      masuk REAL DEFAULT 0,
      keluar REAL DEFAULT 0,
      input_oleh TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS cor_jalan (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tanggal TEXT NOT NULL,
      uraian TEXT,
      masuk REAL DEFAULT 0,
      keluar REAL DEFAULT 0,
      input_oleh TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS jimpitan (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tanggal TEXT NOT NULL,
      nama_warga TEXT,
      nominal REAL DEFAULT 0,
      keluar REAL DEFAULT 0,
      keterangan TEXT,
      input_oleh TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS ibu_ibu (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tanggal TEXT NOT NULL,
      uraian TEXT,
      masuk REAL DEFAULT 0,
      keluar REAL DEFAULT 0,
      input_oleh TEXT
    )`);

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

// BACKUP & RESTORE ENDPOINTS
app.get('/api/admin/backup', (req, res) => {
  const file = path.join(__dirname, 'database.sqlite');
  if (fs.existsSync(file)) {
    res.download(file, `backup-database-${new Date().toISOString().split('T')[0]}.sqlite`);
  } else {
    res.status(404).json({ success: false, message: 'File database belum tersedia.' });
  }
});

app.post('/api/admin/restore', upload.single('database_file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Tidak ada file backup yang diunggah.' });
  }

  const targetPath = path.join(__dirname, 'database.sqlite');
  
  fs.copyFile(req.file.path, targetPath, (err) => {
    fs.unlink(req.file.path, () => {}); // Hapus file temporary
    if (err) {
      res.status(500).json({ success: false, message: 'Gagal memulihkan database.' });
    } else {
      res.json({ success: true, message: 'Database berhasil dipulihkan! Silakan muat ulang halaman.' });
    }
  });
});

// AUTH
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
    if (err || !user) return res.status(400).json({ success: false, message: 'Username atau Password Salah!' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ success: false, message: 'Username atau Password Salah!' });
    res.json({ success: true, user: { id: user.id, username: user.username, nama: user.nama, role: user.role } });
  });
});

app.post('/api/leader/request-otp', (req, res) => {
  const { no_hp } = req.body;
  db.get(`SELECT * FROM leaders WHERE no_hp = ?`, [no_hp], (err, leader) => {
    if (err || !leader) return res.status(404).json({ success: false, message: 'Nomor HP Pengurus tidak terdaftar!' });
    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    db.run(`UPDATE leaders SET pin_otp = ? WHERE no_hp = ?`, [otp, no_hp], () => {
      res.json({ success: true, message: 'Kode OTP berhasil dikirim!', dev_otp: otp });
    });
  });
});

app.post('/api/leader/verify-otp', (req, res) => {
  const { no_hp, otp } = req.body;
  db.get(`SELECT * FROM leaders WHERE no_hp = ? AND pin_otp = ?`, [no_hp, otp], (err, leader) => {
    if (err || !leader) return res.status(400).json({ success: false, message: 'Kode OTP Salah!' });
    db.run(`UPDATE leaders SET pin_otp = NULL WHERE no_hp = ?`, [no_hp]);
    res.json({ success: true, user: { id: leader.id, nama: leader.nama, jabatan: leader.jabatan, pic_modul: leader.pic_modul, role: 'LEADER' } });
  });
});

app.post('/api/warga/request-otp', (req, res) => {
  const { no_hp } = req.body;
  db.get(`SELECT * FROM members WHERE no_hp = ?`, [no_hp], (err, warga) => {
    if (err || !warga) return res.status(404).json({ success: false, message: 'Nomor HP Warga tidak terdaftar!' });
    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    db.run(`UPDATE members SET pin_otp = ? WHERE no_hp = ?`, [otp, no_hp], () => {
      res.json({ success: true, message: 'Kode OTP Warga berhasil dikirim!', dev_otp: otp });
    });
  });
});

app.post('/api/warga/verify-otp', (req, res) => {
  const { no_hp, otp } = req.body;
  db.get(`SELECT * FROM members WHERE no_hp = ? AND pin_otp = ?`, [no_hp, otp], (err, warga) => {
    if (err || !warga) return res.status(400).json({ success: false, message: 'Kode OTP Salah!' });
    db.run(`UPDATE members SET pin_otp = NULL WHERE no_hp = ?`, [no_hp]);
    res.json({ success: true, user: { id: warga.id, nama: warga.nama, no_hp: warga.no_hp, role: 'WARGA' } });
  });
});

// MEMBERS
app.get('/api/members', (req, res) => {
  db.all(`SELECT * FROM members`, [], (err, rows) => res.json({ success: true, data: rows }));
});
app.post('/api/members', (req, res) => {
  const { nik, nama, alamat, no_hp, kategori } = req.body;
  db.run(`INSERT INTO members (nik, nama, alamat, no_hp, kategori) VALUES (?, ?, ?, ?, ?)`, [nik, nama, alamat, no_hp, kategori], function(err) {
    if (err) return res.status(500).json({ success: false, message: 'Gagal menambah warga.' });
    res.json({ success: true, message: 'Data warga berhasil ditambahkan!' });
  });
});
app.put('/api/members/:id', (req, res) => {
  const { nik, nama, alamat, no_hp, kategori } = req.body;
  db.run(`UPDATE members SET nik = ?, nama = ?, alamat = ?, no_hp = ?, kategori = ? WHERE id = ?`, [nik, nama, alamat, no_hp, kategori, req.params.id], () => res.json({ success: true }));
});
app.delete('/api/members/:id', (req, res) => {
  db.run(`DELETE FROM members WHERE id = ?`, [req.params.id], () => res.json({ success: true }));
});

// LEADERS
app.get('/api/leaders', (req, res) => {
  db.all(`SELECT * FROM leaders`, [], (err, rows) => res.json({ success: true, data: rows }));
});
app.post('/api/leaders', (req, res) => {
  const { nama, jabatan, no_hp, pic_modul } = req.body;
  db.run(`INSERT INTO leaders (nama, jabatan, no_hp, pic_modul) VALUES (?, ?, ?, ?)`, [nama, jabatan, no_hp, pic_modul || 'Kas Gang'], function(err) {
    if (err) return res.status(500).json({ success: false, message: 'Nomor HP sudah terdaftar.' });
    res.json({ success: true, message: 'Data pengurus berhasil ditambahkan!' });
  });
});
app.put('/api/leaders/:id', (req, res) => {
  const { nama, jabatan, no_hp, pic_modul } = req.body;
  db.run(`UPDATE leaders SET nama = ?, jabatan = ?, no_hp = ?, pic_modul = ? WHERE id = ?`, [nama, jabatan, no_hp, pic_modul, req.params.id], () => res.json({ success: true }));
});
app.delete('/api/leaders/:id', (req, res) => {
  db.run(`DELETE FROM leaders WHERE id = ?`, [req.params.id], () => res.json({ success: true }));
});

// AGENDA GANG
app.get('/api/agenda', (req, res) => {
  db.all(`SELECT * FROM agenda_gang ORDER BY tanggal DESC`, [], (err, rows) => res.json({ success: true, data: rows }));
});
app.post('/api/agenda', (req, res) => {
  const { tanggal, waktu, nama_kegiatan, lokasi, keterangan, input_oleh } = req.body;
  db.run(`INSERT INTO agenda_gang (tanggal, waktu, nama_kegiatan, lokasi, keterangan, input_oleh) VALUES (?, ?, ?, ?, ?, ?)`,
    [tanggal, waktu || '-', nama_kegiatan, lokasi || '-', keterangan || '-', input_oleh], function(err) {
      if (err) return res.status(500).json({ success: false, message: 'Gagal menyimpan agenda.' });
      res.json({ success: true, message: 'Agenda kegiatan berhasil dicatat!' });
    });
});
app.delete('/api/agenda/:id', (req, res) => {
  db.run(`DELETE FROM agenda_gang WHERE id = ?`, [req.params.id], () => res.json({ success: true }));
});

// IURAN
app.get('/api/iuran', (req, res) => {
  db.all(`SELECT iuran_warga.*, members.nama as nama_warga FROM iuran_warga JOIN members ON iuran_warga.warga_id = members.id ORDER BY id DESC`, [], (err, rows) => {
    res.json({ success: true, data: rows });
  });
});

app.post('/api/iuran', (req, res) => {
  const { warga_id, bulan, tahun, nominal, keterangan, input_oleh } = req.body;
  db.run(`INSERT INTO iuran_warga (warga_id, bulan, tahun, nominal, keterangan, input_oleh) VALUES (?, ?, ?, ?, ?, ?)`, 
    [warga_id, bulan, tahun, nominal, keterangan, input_oleh], function(err) {
      if (err) return res.status(500).json({ success: false, message: 'Gagal menyimpan iuran.' });
      
      db.get(`SELECT nama FROM members WHERE id = ?`, [warga_id], (err, warga) => {
        const namaWarga = warga ? warga.nama : 'Warga';
        const uraianKas = `Iuran Bulanan (${bulan} ${tahun}) - ${namaWarga}`;
        const tanggalHariIni = new Date().toISOString().split('T')[0];
        
        db.run(`INSERT INTO kas_gang (tanggal, uraian, masuk, keluar, input_oleh) VALUES (?, ?, ?, 0, ?)`,
          [tanggalHariIni, uraianKas, nominal, input_oleh]);
      });

      res.json({ success: true, message: 'Iuran bulanan berhasil dicatat & masuk ke Kas Gang!' });
  });
});

app.delete('/api/iuran/:id', (req, res) => {
  db.run(`DELETE FROM iuran_warga WHERE id = ?`, [req.params.id], () => res.json({ success: true }));
});

// MODUL KAS
function setupModuleEndpoints(routeName, tableName) {
  app.get(`/api/${routeName}`, (req, res) => {
    db.all(`SELECT * FROM ${tableName} ORDER BY id DESC`, [], (err, rows) => res.json({ success: true, data: rows }));
  });
  app.post(`/api/${routeName}`, (req, res) => {
    const { tanggal, uraian, nama_warga, masuk, keluar, keterangan, input_oleh } = req.body;
    db.run(`INSERT INTO ${tableName} (tanggal, uraian, nama_warga, masuk, keluar, keterangan, input_oleh) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [tanggal, uraian || '-', nama_warga || '-', masuk || 0, keluar || 0, keterangan || '-', input_oleh], function(err) {
        if (err) return res.status(500).json({ success: false, message: 'Gagal menyimpan data.' });
        res.json({ success: true, message: 'Data berhasil disimpan!' });
      });
  });
  app.put(`/api/${routeName}/:id`, (req, res) => {
    const { tanggal, uraian, masuk, keluar } = req.body;
    db.run(`UPDATE ${tableName} SET tanggal = ?, uraian = ?, masuk = ?, keluar = ? WHERE id = ?`,
      [tanggal, uraian, masuk || 0, keluar || 0, req.params.id], function(err) {
        if (err) return res.status(500).json({ success: false, message: 'Gagal update.' });
        res.json({ success: true, message: 'Berhasil diperbarui!' });
      });
  });
  app.delete(`/api/${routeName}/:id`, (req, res) => {
    db.run(`DELETE FROM ${tableName} WHERE id = ?`, [req.params.id], () => res.json({ success: true }));
  });
}

setupModuleEndpoints('kas-gang', 'kas_gang');
setupModuleEndpoints('cor-jalan', 'cor_jalan');
setupModuleEndpoints('jimpitan', 'jimpitan');
setupModuleEndpoints('ibu-ibu', 'ibu_ibu');

app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});
