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
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

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

        CREATE TABLE IF NOT EXISTS kas_gang (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tanggal TEXT NOT NULL,
            uraian TEXT,
            masuk REAL DEFAULT 0,
            keluar REAL DEFAULT 0,
            input_oleh TEXT
        );
    `);

    // Inisialisasi Admin Utama via Email dari Environment Variable
    const adminEmail = process.env.ADMIN_EMAIL || "admin@nuansa16a.com";
    const admin = await get('SELECT id FROM users WHERE email = ?', [adminEmail]);

    if (!admin) {
        const initialPassword = process.env.ADMIN_INITIAL_PASSWORD || "AdminNuansa16A#2026";
        const hash = await bcrypt.hash(initialPassword, 12);
        await run(
            `INSERT INTO users (email, password, role, nama, must_change_password) VALUES (?, ?, ?, ?, 0)`,
            [adminEmail, hash, 'SUPER_ADMIN', 'Super Admin Utama']
        );
        console.log('Akun Super Admin berhasil dibuat dengan email:', adminEmail);
    }
}

// 1. LOGIN ADMIN (Menggunakan Email & Password)
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

// 2. REQUEST & VERIFY OTP PENGURUS & WARGA (Menggunakan No WhatsApp)
function makeOtp() {
    return crypto.randomInt(100000, 1000000).toString();
}

async function requestOtp(table, noHp, res) {
    const person = await get(`SELECT id FROM ${table} WHERE no_hp = ?`, [noHp]);
    if (!person) {
        return res.status(404).json({ success: false, message: 'Nomor WhatsApp tidak terdaftar di sistem oleh Admin.' });
    }

    const otp = makeOtp();
    const hash = crypto.createHash('sha256').update(otp).digest('hex');

    await run(`UPDATE ${table} SET pin_otp = ? WHERE id = ?`, [hash, person.id]);

    res.json({
        success: true,
        message: 'Kode OTP WhatsApp berhasil digenerate.',
        dev_otp: otp // Ditampilkan untuk pengujian langsung
    });
}

async function verifyOtp(table, noHp, otp, roleName, res) {
    const hash = crypto.createHash('sha256').update(otp).digest('hex');
    const person = await get(`SELECT * FROM ${table} WHERE no_hp = ? AND pin_otp = ?`, [noHp, hash]);

    if (!person) {
        return res.status(400).json({ success: false, message: 'Kode OTP salah atau sudah kedaluwarsa.' });
    }

    await run(`UPDATE ${table} SET pin_otp = NULL WHERE id = ?`, [person.id]);

    res.json({
        success: true,
        user: {
            id: person.id,
            nama: person.nama,
            no_hp: person.no_hp,
            role: roleName,
            jabatan: person.jabatan || 'Warga'
        }
    });
}

app.post('/api/login/pengurus/request', asyncRoute((req, res) => requestOtp('leaders', req.body.no_hp, res)));
app.post('/api/login/pengurus/verify', asyncRoute((req, res) => verifyOtp('leaders', req.body.no_hp, req.body.otp, 'LEADER', res)));

app.post('/api/login/warga/request', asyncRoute((req, res) => requestOtp('members', req.body.no_hp, res)));
app.post('/api/login/warga/verify', asyncRoute((req, res) => verifyOtp('members', req.body.no_hp, req.body.otp, 'WARGA', res)));

// API DATA WARGA & PENGURUS (Hanya Admin yang bisa CRUD)
app.get('/api/members', asyncRoute(async (req, res) => {
    const rows = await all('SELECT * FROM members ORDER BY nama');
    res.json({ success: true, data: rows });
}));

app.post('/api/members', asyncRoute(async (req, res) => {
    const { nik, nama, alamat, no_hp, kategori } = req.body;
    await run('INSERT INTO members (nik, nama, alamat, no_hp, kategori) VALUES (?, ?, ?, ?, ?)', [nik, nama, alamat, no_hp, kategori]);
    res.json({ success: true, message: 'Warga berhasil didaftarkan.' });
}));

app.get('/api/leaders', asyncRoute(async (req, res) => {
    const rows = await all('SELECT * FROM leaders ORDER BY nama');
    res.json({ success: true, data: rows });
}));

app.post('/api/leaders', asyncRoute(async (req, res) => {
    const { nama, jabatan, no_hp, pic_modul } = req.body;
    await run('INSERT INTO leaders (nama, jabatan, no_hp, pic_modul) VALUES (?, ?, ?, ?)', [nama, jabatan, no_hp, pic_modul]);
    res.json({ success: true, message: 'Pengurus berhasil didaftarkan.' });
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
