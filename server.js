'use strict';

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const DB_PATH = path.join(__dirname, 'database.sqlite');
const BACKUP_DIR = path.join(__dirname, 'backups');
const UPLOAD_DIR = path.join(__dirname, 'uploads');

fs.mkdirSync(BACKUP_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'index.html');
    if (!fs.existsSync(indexPath)) {
        return res.status(404).send('File index.html tidak ditemukan.');
    }
    res.sendFile(indexPath);
});

const upload = multer({ dest: UPLOAD_DIR });
const db = new sqlite3.Database(DB_PATH);

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) return reject(err);
            resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
}

function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) return reject(err);
            resolve(rows);
        });
    });
}

function exec(sql) {
    return new Promise((resolve, reject) => {
        db.exec(sql, err => {
            if (err) return reject(err);
            resolve();
        });
    });
}

function asyncRoute(handler) {
    return (req, res, next) => {
        Promise.resolve(handler(req, res, next)).catch(next);
    };
}

async function initDatabase() {
    await exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL,
            nama TEXT NOT NULL,
            must_change_password INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS leaders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nama TEXT NOT NULL,
            jabatan TEXT NOT NULL,
            no_hp TEXT UNIQUE NOT NULL,
            pic_modul TEXT DEFAULT 'Kas Gang',
            pin_otp TEXT
        );

        CREATE TABLE IF NOT EXISTS members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nik TEXT,
            nama TEXT NOT NULL,
            alamat TEXT,
            no_hp TEXT UNIQUE,
            kategori TEXT,
            pin_otp TEXT
        );

        CREATE TABLE IF NOT EXISTS keuangan (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kategori_transaksi TEXT NOT NULL, -- Kas, Tabungan Cor, Jimpitan, Dana Sosial
            tanggal TEXT NOT NULL,
            uraian TEXT,
            masuk REAL DEFAULT 0,
            keluar REAL DEFAULT 0,
            input_oleh TEXT
        );

        CREATE TABLE IF NOT EXISTS assets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nama_aset TEXT NOT NULL,
            kategori TEXT NOT NULL,
            tanggal_pembelian TEXT,
            nilai_pembelian REAL DEFAULT 0,
            kondisi TEXT,
            lokasi TEXT,
            keterangan TEXT
        );

        CREATE TABLE IF NOT EXISTS announcements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            judul TEXT NOT NULL,
            isi TEXT NOT NULL,
            tanggal TEXT NOT NULL,
            status TEXT DEFAULT 'Aktif'
        );

        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            aksi TEXT NOT NULL,
            pelaku TEXT NOT NULL,
            detail TEXT,
            waktu DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // Inisialisasi Admin Utama
    const adminEmail = process.env.ADMIN_EMAIL || "admin@nuansa16a.com";
    const admin = await get('SELECT id FROM users WHERE email = ?', [adminEmail]);

    if (!admin) {
        const initialPassword = process.env.ADMIN_INITIAL_PASSWORD || "Nuansa16A#2026";
        const hash = await bcrypt.hash(initialPassword, 12);
        await run(
            `INSERT INTO users (email, password, role, nama, must_change_password) VALUES (?, ?, ?, ?, 0)`,
            [adminEmail, hash, 'SUPER_ADMIN', 'Super Admin Utama']
        );
        console.log('Akun Super Admin berhasil diinisialisasi.');
    }
}

// LOGIN ADMIN
app.post('/api/login/admin', asyncRoute(async (req, res) => {
    const { email, password } = req.body;
    const user = await get('SELECT * FROM users WHERE email = ?', [email]);

    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ success: false, message: 'Email atau password admin salah.' });
    }

    res.json({
        success: true,
        user: { id: user.id, email: user.email, nama: user.nama, role: user.role }
    });
}));

// API STATISTIK DASHBOARD EXECUTIVE & KEUANGAN
app.get('/api/dashboard/stats', asyncRoute(async (req, res) => {
    const membersCount = await get('SELECT COUNT(*) as cnt FROM members');
    const leadersCount = await get('SELECT COUNT(*) as cnt FROM leaders');
    const assetsSum = await get('SELECT SUM(nilai_pembelian) as total, COUNT(*) as cnt FROM assets');
    
    const kas = await get('SELECT SUM(masuk - keluar) as saldo FROM keuangan WHERE kategori_transaksi = "Kas"');
    const cor = await get('SELECT SUM(masuk - keluar) as saldo FROM keuangan WHERE kategori_transaksi = "Tabungan Cor"');
    const jimpitan = await get('SELECT SUM(masuk - keluar) as saldo FROM keuangan WHERE kategori_transaksi = "Jimpitan"');
    const sosial = await get('SELECT SUM(masuk - keluar) as saldo FROM keuangan WHERE kategori_transaksi = "Dana Sosial"');

    res.json({
        success: true,
        stats: {
            members: membersCount.cnt,
            leaders: leadersCount.cnt,
            totalAset: assetsSum.cnt || 0,
            nilaiAset: assetsSum.total || 0,
            saldoKas: kas.saldo || 0,
            saldoCor: cor.saldo || 0,
            saldoJimpitan: jimpitan.saldo || 0,
            saldoSosial: sosial.saldo || 0
        }
    });
}));

// API WARGA & PENGURUS
app.get('/api/members', asyncRoute(async (req, res) => {
    const rows = await all('SELECT * FROM members ORDER BY nama');
    res.json({ success: true, data: rows });
}));

app.post('/api/members', asyncRoute(async (req, res) => {
    const { nik, nama, alamat, no_hp, kategori } = req.body;
    await run('INSERT INTO members (nik, nama, alamat, no_hp, kategori) VALUES (?, ?, ?, ?, ?)', [nik, nama, alamat, no_hp, kategori]);
    res.json({ success: true, message: 'Warga berhasil ditambahkan.' });
}));

app.get('/api/leaders', asyncRoute(async (req, res) => {
    const rows = await all('SELECT * FROM leaders ORDER BY nama');
    res.json({ success: true, data: rows });
}));

app.post('/api/leaders', asyncRoute(async (req, res) => {
    const { nama, jabatan, no_hp, pic_modul } = req.body;
    await run('INSERT INTO leaders (nama, jabatan, no_hp, pic_modul) VALUES (?, ?, ?, ?)', [nama, jabatan, no_hp, pic_modul]);
    res.json({ success: true, message: 'Pengurus berhasil ditambahkan.' });
}));

// API ASET
app.get('/api/assets', asyncRoute(async (req, res) => {
    const rows = await all('SELECT * FROM assets ORDER BY id DESC');
    res.json({ success: true, data: rows });
}));

app.post('/api/assets', asyncRoute(async (req, res) => {
    const { nama_aset, kategori, tanggal_pembelian, nilai_pembelian, kondisi, lokasi, keterangan } = req.body;
    await run('INSERT INTO assets (nama_aset, kategori, tanggal_pembelian, nilai_pembelian, kondisi, lokasi, keterangan) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [nama_aset, kategori, tanggal_pembelian, nilai_pembelian, kondisi, lokasi, keterangan]);
    res.json({ success: true, message: 'Aset berhasil dicatat.' });
}));

// BACKUP DATABASE
app.get('/api/admin/backup', asyncRoute(async (req, res) => {
    const filename = `backup-nuansa16a-${new Date().toISOString().slice(0,10)}.sqlite`;
    const destination = path.join(BACKUP_DIR, filename);
    db.backup(destination, err => {
        if (err) return res.status(500).json({ success: false, message: 'Gagal backup.' });
        res.download(destination, filename);
    });
}));

app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server.' });
});

async function startServer() {
    await initDatabase();
    app.listen(PORT, () => {
        console.log(`Server NUANSA16A berjalan di port ${PORT}`);
    });
}

startServer();
