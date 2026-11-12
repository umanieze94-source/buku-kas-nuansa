'use strict';

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const DB_PATH = path.join(__dirname, 'database.sqlite');
const BACKUP_DIR = path.join(__dirname, 'backups');
const UPLOAD_DIR = path.join(__dirname, 'uploads');

fs.mkdirSync(BACKUP_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

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

async function logAudit(aksi, pelaku, detail) {
    try {
        await run('INSERT INTO audit_logs (aksi, pelaku, detail) VALUES (?, ?, ?)', [aksi, pelaku, detail]);
    } catch (e) {
        console.error('Gagal mencatat audit log:', e);
    }
}

async function initDatabase() {
    await exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL,
            nama TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS leaders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nama TEXT NOT NULL,
            jabatan TEXT NOT NULL,
            no_hp TEXT UNIQUE NOT NULL,
            pic_modul TEXT DEFAULT 'Kas Gang'
        );

        CREATE TABLE IF NOT EXISTS members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nik TEXT,
            nama TEXT NOT NULL,
            alamat TEXT,
            no_hp TEXT UNIQUE,
            kategori TEXT
        );

        CREATE TABLE IF NOT EXISTS keuangan (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kategori_transaksi TEXT NOT NULL,
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

    const adminEmail = process.env.ADMIN_EMAIL || "admin@nuansa16a.com";
    const admin = await get('SELECT id FROM users WHERE email = ?', [adminEmail]);

    if (!admin) {
        const initialPassword = process.env.ADMIN_INITIAL_PASSWORD || "Nuansa16A#2026";
        const hash = await bcrypt.hash(initialPassword, 12);
        await run(
            `INSERT INTO users (email, password, role, nama) VALUES (?, ?, ?, ?)`,
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

    await logAudit('LOGIN', user.nama, 'Super Admin masuk ke sistem');
    res.json({
        success: true,
        user: { id: user.id, email: user.email, nama: user.nama, role: user.role }
    });
}));

// DASHBOARD STATS & EXECUTIVE SUMMARY
app.get('/api/dashboard/stats', asyncRoute(async (req, res) => {
    const membersCount = await get('SELECT COUNT(*) as cnt FROM members');
    const leadersCount = await get('SELECT COUNT(*) as cnt FROM leaders');
    const assetsSum = await get('SELECT SUM(nilai_pembelian) as total, COUNT(*) as cnt FROM assets');
    
    const kas = await get('SELECT SUM(masuk - keluar) as saldo FROM keuangan WHERE kategori_transaksi = "Kas"');
    const cor = await get('SELECT SUM(masuk - keluar) as saldo FROM keuangan WHERE kategori_transaksi = "Tabungan Cor"');
    const jimpitan = await get('SELECT SUM(masuk - keluar) as saldo FROM keuangan WHERE kategori_transaksi = "Jimpitan"');
    const sosial = await get('SELECT SUM(masuk - keluar) as saldo FROM keuangan WHERE kategori_transaksi = "Dana Sosial"');

    const saldoKas = kas.saldo || 0;
    const saldoCor = cor.saldo || 0;
    const saldoJimpitan = jimpitan.saldo || 0;
    const saldoSosial = sosial.saldo || 0;
    const nilaiAset = assetsSum.total || 0;
    const totalKekayaan = saldoKas + saldoCor + saldoJimpitan + saldoSosial + nilaiAset;

    res.json({
        success: true,
        stats: {
            members: membersCount.cnt,
            leaders: leadersCount.cnt,
            totalAset: assetsSum.cnt || 0,
            nilaiAset,
            saldoKas,
            saldoCor,
            saldoJimpitan,
            saldoSosial,
            totalKekayaan
        }
    });
}));

// WARGA
app.get('/api/members', asyncRoute(async (req, res) => {
    const rows = await all('SELECT * FROM members ORDER BY nama');
    res.json({ success: true, data: rows });
}));

app.post('/api/members', asyncRoute(async (req, res) => {
    const { nik, nama, alamat, no_hp, kategori, actor } = req.body;
    await run('INSERT INTO members (nik, nama, alamat, no_hp, kategori) VALUES (?, ?, ?, ?, ?)', [nik, nama, alamat, no_hp, kategori]);
    await logAudit('TAMBAH WARGA', actor || 'Admin', `Menambahkan warga: ${nama}`);
    res.json({ success: true, message: 'Warga berhasil ditambahkan.' });
}));

// PENGURUS
app.get('/api/leaders', asyncRoute(async (req, res) => {
    const rows = await all('SELECT * FROM leaders ORDER BY nama');
    res.json({ success: true, data: rows });
}));

app.post('/api/leaders', asyncRoute(async (req, res) => {
    const { nama, jabatan, no_hp, pic_modul, actor } = req.body;
    await run('INSERT INTO leaders (nama, jabatan, no_hp, pic_modul) VALUES (?, ?, ?, ?)', [nama, jabatan, no_hp, pic_modul]);
    await logAudit('TAMBAH PENGURUS', actor || 'Admin', `Menambahkan pengurus: ${nama}`);
    res.json({ success: true, message: 'Pengurus berhasil ditambahkan.' });
}));

// KEUANGAN / TRANSAKSI
app.get('/api/keuangan', asyncRoute(async (req, res) => {
    const rows = await all('SELECT * FROM keuangan ORDER BY id DESC');
    res.json({ success: true, data: rows });
}));

app.post('/api/keuangan', asyncRoute(async (req, res) => {
    const { kategori_transaksi, tanggal, uraian, masuk, keluar, actor } = req.body;
    await run('INSERT INTO keuangan (kategori_transaksi, tanggal, uraian, masuk, keluar, input_oleh) VALUES (?, ?, ?, ?, ?, ?)',
        [kategori_transaksi, tanggal, uraian, masuk || 0, keluar || 0, actor || 'Admin']);
    await logAudit('TAMBAH TRANSAKSI', actor || 'Admin', `Transaksi [${kategori_transaksi}] Rp ${(masuk || keluar).toLocaleString()}`);
    res.json({ success: true, message: 'Transaksi berhasil disimpan.' });
}));

// ASET LINGKUNGAN
app.get('/api/assets', asyncRoute(async (req, res) => {
    const rows = await all('SELECT * FROM assets ORDER BY id DESC');
    res.json({ success: true, data: rows });
}));

app.post('/api/assets', asyncRoute(async (req, res) => {
    const { nama_aset, kategori, tanggal_pembelian, nilai_pembelian, kondisi, lokasi, keterangan, actor } = req.body;
    await run('INSERT INTO assets (nama_aset, kategori, tanggal_pembelian, nilai_pembelian, kondisi, lokasi, keterangan) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [nama_aset, kategori, tanggal_pembelian, nilai_pembelian || 0, kondisi, lokasi, keterangan]);
    await logAudit('TAMBAH ASET', actor || 'Admin', `Mencatat aset: ${nama_aset}`);
    res.json({ success: true, message: 'Aset berhasil dicatat.' });
}));

// PENGUMUMAN
app.get('/api/announcements', asyncRoute(async (req, res) => {
    const rows = await all('SELECT * FROM announcements ORDER BY id DESC');
    res.json({ success: true, data: rows });
}));

app.post('/api/announcements', asyncRoute(async (req, res) => {
    const { judul, isi, tanggal, status, actor } = req.body;
    await run('INSERT INTO announcements (judul, isi, tanggal, status) VALUES (?, ?, ?, ?)', [judul, isi, tanggal, status || 'Aktif']);
    await logAudit('BUAT PENGUMUMAN', actor || 'Admin', `Membuat pengumuman: ${judul}`);
    res.json({ success: true, message: 'Pengumuman berhasil dipublikasikan.' });
}));

// AUDIT LOG
app.get('/api/audit-logs', asyncRoute(async (req, res) => {
    const rows = await all('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 100');
    res.json({ success: true, data: rows });
}));

// BACKUP & RESTORE
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
