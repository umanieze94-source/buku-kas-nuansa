const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
  db.serialize(async () => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      nama TEXT NOT NULL,
      must_change_password INTEGER DEFAULT 1
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
              console.log('==================================================');
              console.log('Akun Super Admin Default Berhasil Dibuat!');
              console.log('Username: admin');
              console.log('Password: admin123');
              console.log('==================================================');
            }
          }
        );
      }
    });
  });
}

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

// Endpoint Ganti Password Pertama
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

// Jalankan Server
app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});