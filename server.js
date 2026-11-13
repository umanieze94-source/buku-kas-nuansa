'use strict';

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const https = require('https');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Path Database untuk Railway (Mendukung Persistent Volume di /app/data atau direktori lokal)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname);
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'database.sqlite');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

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

// Fungsi KIRIM WA OTP ASLI (Contoh Integrasi Fonnte / WhatsApp Gateway)
async function sendWhatsAppMessage(target, message) {
    const token = process.env.WHATSAPP_API_TOKEN; // Set di Environment Variable Railway jika punya
    if (!token) {
        console.log(`[SIMULASI WA] Ke ${target}: ${message}`);
        return true;
    }

    return new Promise((resolve) => {
        const data = JSON.stringify({ target, message });
        const options = {
            hostname: 'api.fonnte.com',
            port: 443,
            path: '/send',
            method: 'POST',
            headers: {
                'Authorization': token,
                'Content-Type': 'application/json',
                'Content-Length': data.length
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => resolve(true));
        });

        req.on('error', (e) => {
            console.error('Gagal kirim WA:', e);
            resolve(false);
        });

        req.write(data);
        req.end();
    });
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
            alamat TEXT,
            no_hp TEXT UNIQUE NOT NULL,
            pic_modul TEXT DEFAULT 'Kas Gang'
        );

        CREATE TABLE IF NOT EXISTS members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nik TEXT,
            nama TEXT NOT NULL,
            nomor_rumah TEXT UNIQUE NOT NULL,
            alamat TEXT,
            no_hp TEXT,
            kategori TEXT DEFAULT 'Warga Tetap',
            status_iuran TEXT DEFAULT 'Belum Bayar',
            tabungan_cor REAL DEFAULT 0,
            tunggakan REAL DEFAULT 0,
            keterangan TEXT
        );

        CREATE TABLE IF NOT EXISTS otp_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            no_hp TEXT NOT NULL,
            otp TEXT NOT NULL,
            expires_at DATETIME NOT NULL
        );

        CREATE TABLE IF NOT EXISTS keuangan (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kategori_transaksi TEXT NOT NULL,
            tanggal TEXT NOT NULL,
            bulan_tahun TEXT NOT NULL,
            nomor_rumah TEXT,
            nama_warga TEXT,
            uraian TEXT,
            masuk REAL DEFAULT 0,
            keluar REAL DEFAULT 0,
            status_diterima TEXT DEFAULT 'Belum',
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

        CREATE TABLE IF NOT EXISTS agendas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            judul TEXT NOT NULL,
            tanggal TEXT NOT NULL,
            waktu TEXT,
            lokasi TEXT,
            kategori TEXT DEFAULT 'Umum',
            deskripsi TEXT,
            pembuat TEXT
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
    }
}

// LOGIN ADMIN
app.post('/api/login/admin', asyncRoute(async (req, res) => {
    const { email, password } = req.body;
    const user = await get('SELECT * FROM users WHERE email = ?', [email]);

    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ success: false, message: 'Email atau password admin salah.' });
    }

    await logAudit('LOGIN ADMIN', user.nama, 'Super Admin masuk ke sistem');
    res.json({
        success: true,
        user: { id: user.id, email: user.email, nama: user.nama, role: 'SUPER_ADMIN' }
    });
}));

// REQUEST OTP WHATSAPP
app.post('/api/auth/request-otp', asyncRoute(async (req, res) => {
    const { no_hp, role_target } = req.body;
    
    if (role_target === 'PENGURUS') {
        const leader = await get('SELECT * FROM leaders WHERE no_hp = ?', [no_hp]);
        if (!leader) return res.status(404).json({ success: false, message: 'Nomor WhatsApp pengurus tidak terdaftar.' });
    } else if (role_target === 'WARGA') {
        const member = await get('SELECT * FROM members WHERE no_hp = ?', [no_hp]);
        if (!member) return res.status(404).json({ success: false, message: 'Nomor WhatsApp warga tidak terdaftar.' });
    } else {
        return res.status(400).json({ success: false, message: 'Target role tidak valid.' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    await run('DELETE FROM otp_codes WHERE no_hp = ?', [no_hp]);
    await run('INSERT INTO otp_codes (no_hp, otp, expires_at) VALUES (?, ?, ?)', [no_hp, otp, expiresAt]);

    const pesanWA = `[NUANSA 16A] Kode OTP verifikasi login Anda adalah: *${otp}*. Berlaku selama 5 menit. Jangan bagikan kode ini kepada siapapun.`;
    await sendWhatsAppMessage(no_hp, pesanWA);

    res.json({ success: true, message: 'Kode OTP berhasil dikirim ke nomor WhatsApp Anda.', dev_otp: otp });
}));

// VERIFY OTP
app.post('/api/auth/verify-otp', asyncRoute(async (req, res) => {
    const { no_hp, otp, role_target } = req.body;
    const record = await get('SELECT * FROM otp_codes WHERE no_hp = ? AND otp = ?', [no_hp, otp]);
    if (!record || new Date() > new Date(record.expires_at)) {
        return res.status(400).json({ success: false, message: 'Kode OTP salah atau kadaluarsa.' });
    }

    await run('DELETE FROM otp_codes WHERE no_hp = ?', [no_hp]);

    let userData = null;
    if (role_target === 'PENGURUS') {
        const leader = await get('SELECT * FROM leaders WHERE no_hp = ?', [no_hp]);
        userData = { id: leader.id, nama: leader.nama, role: 'PENGURUS', jabatan: leader.jabatan, pic_modul: leader.pic_modul };
    } else {
        const member = await get('SELECT * FROM members WHERE no_hp = ?', [no_hp]);
        userData = { id: member.id, nama: member.nama, nomor_rumah: member.nomor_rumah, role: 'WARGA', alamat: member.alamat };
    }

    await logAudit(`LOGIN ${role_target}`, userData.nama, `Masuk via OTP WhatsApp`);
    res.json({ success: true, user: userData });
}));

// DASHBOARD STATS
app.get('/api/dashboard/stats', asyncRoute(async (req, res) => {
    const membersCount = await get('SELECT COUNT(*) as cnt FROM members');
    const leadersCount = await get('SELECT COUNT(*) as cnt FROM leaders');
    const assetsSum = await get('SELECT SUM(nilai_pembelian) as total, COUNT(*) as cnt FROM assets');
    
    const kas = await get('SELECT SUM(masuk - keluar) as saldo FROM keuangan WHERE kategori_transaksi IN ("Kas", "Iuran Bulanan", "Dansos", "Lain Lain")');
    const cor = await get('SELECT SUM(masuk - keluar) as saldo FROM keuangan WHERE kategori_transaksi = "Tabungan Cor"');
    const jimpitan = await get('SELECT SUM(masuk - keluar) as saldo FROM keuangan WHERE kategori_transaksi = "Jimpitan"');
    const totalKeluar = await get('SELECT SUM(keluar) as total FROM keuangan');

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
            totalPengeluaran: totalKeluar.total || 0
        }
    });
}));

// KEUANGAN / KAS WARGA
app.get('/api/keuangan', asyncRoute(async (req, res) => {
    const rows = await all('SELECT * FROM keuangan ORDER BY tanggal DESC, id DESC');
    res.json({ success: true, data: rows });
}));

app.post('/api/keuangan', asyncRoute(async (req, res) => {
    const { kategori_transaksi, tanggal, bulan_tahun, nomor_rumah, nama_warga, uraian, masuk, keluar, input_oleh } = req.body;
    
    await run(
        `INSERT INTO keuangan (kategori_transaksi, tanggal, bulan_tahun, nomor_rumah, nama_warga, uraian, masuk, keluar, status_diterima, input_oleh) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [kategori_transaksi, tanggal, bulan_tahun || tanggal.slice(0, 7), nomor_rumah, nama_warga, uraian, Number(masuk) || 0, Number(keluar) || 0, kategori_transaksi === 'Tabungan Cor' ? 'Belum' : 'Sudah', input_oleh || 'Admin']
    );

    if (kategori_transaksi === 'Tabungan Cor' && Number(masuk) > 0) {
        await run('UPDATE members SET tabungan_cor = tabungan_cor + ? WHERE nomor_rumah = ?', [Number(masuk), nomor_rumah]);
    }

    await logAudit(`TRANSAKSI ${kategori_transaksi.toUpperCase()}`, input_oleh || 'Admin', `Warga No. ${nomor_rumah} (${nama_warga}) - ${uraian} (Masuk: Rp ${masuk || 0})`);
    res.json({ success: true, message: 'Transaksi berhasil dicatat.' });
}));

app.put('/api/keuangan/konfirmasi-cor/:id', asyncRoute(async (req, res) => {
    const { id } = req.params;
    const { actor } = req.body;
    await run('UPDATE keuangan SET status_diterima = "Sudah" WHERE id = ?', [id]);
    await logAudit('KONFIRMASI COR', actor || 'PIC Cor', `Mengkonfirmasi penerimaan dana iuran cor ID ${id}`);
    res.json({ success: true, message: 'Dana cor jalan berhasil dikonfirmasi diterima.' });
}));

app.post('/api/keuangan/keluar', asyncRoute(async (req, res) => {
    const { tanggal, uraian, keluar, input_oleh } = req.body;
    await run(
        `INSERT INTO keuangan (kategori_transaksi, tanggal, bulan_tahun, uraian, masuk, keluar, status_diterima, input_oleh) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ['Kas', tanggal, tanggal.slice(0, 7), uraian, 0, Number(keluar) || 0, 'Sudah', input_oleh || 'Admin']
    );
    await logAudit('PENGELUARAN KAS', input_oleh || 'Admin', `Keluar: Rp ${keluar} - ${uraian}`);
    res.json({ success: true, message: 'Pengeluaran berhasil dicatat.' });
}));

app.post('/api/jimpitan', asyncRoute(async (req, res) => {
    const { tanggal, bulan_tahun, nominal, keterangan, actor } = req.body;
    await run(
        `INSERT INTO keuangan (kategori_transaksi, tanggal, bulan_tahun, uraian, masuk, keluar, status_diterima, input_oleh) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ['Jimpitan', tanggal, bulan_tahun || tanggal.slice(0, 7), keterangan || 'Setoran Jimpitan Harian', Number(nominal) || 0, 0, 'Sudah', actor || 'PIC Jimpitan']
    );
    await logAudit('JIMPITAN HARIAN', actor || 'PIC Jimpitan', `Input jimpitan Rp ${nominal}`);
    res.json({ success: true, message: 'Jimpitan berhasil dicatat.' });
}));

// LEADERS
app.get('/api/leaders', asyncRoute(async (req, res) => {
    const rows = await all('SELECT * FROM leaders ORDER BY id');
    res.json({ success: true, data: rows });
}));

app.post('/api/leaders', asyncRoute(async (req, res) => {
    const { nama, jabatan, alamat, no_hp, pic_modul, actor } = req.body;
    await run('INSERT INTO leaders (nama, jabatan, alamat, no_hp, pic_modul) VALUES (?, ?, ?, ?, ?)', [nama, jabatan, alamat, no_hp, pic_modul || 'Kas Gang']);
    await logAudit('TAMBAH PENGURUS', actor || 'Admin', `Menambahkan pengurus: ${nama} (${jabatan})`);
    res.json({ success: true, message: 'Pengurus berhasil ditambahkan.' });
}));

// MEMBERS (WARGA) - LENGKAP DENGAN EDIT KHUSUS ADMIN
app.get('/api/members', asyncRoute(async (req, res) => {
    const rows = await all('SELECT * FROM members ORDER BY nomor_rumah ASC');
    res.json({ success: true, data: rows });
}));

app.post('/api/members', asyncRoute(async (req, res) => {
    const { nik, nama, nomor_rumah, alamat, no_hp, kategori, status_iuran, tabungan_cor, tunggakan, keterangan, actor } = req.body;
    await run(
        `INSERT INTO members (nik, nama, nomor_rumah, alamat, no_hp, kategori, status_iuran, tabungan_cor, tunggakan, keterangan) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [nik, nama, nomor_rumah, alamat, no_hp, kategori || 'Warga Tetap', status_iuran || 'Belum Bayar', tabungan_cor || 0, tunggakan || 0, keterangan]
    );
    await logAudit('TAMBAH WARGA', actor || 'Admin', `Warga No. ${nomor_rumah} - ${nama}`);
    res.json({ success: true, message: 'Warga berhasil ditambahkan.' });
}));

app.put('/api/members/:id', asyncRoute(async (req, res) => {
    const { id } = req.params;
    const { nik, nama, nomor_rumah, alamat, no_hp, kategori, status_iuran, tabungan_cor, tunggakan, keterangan, actor } = req.body;
    await run(
        `UPDATE members SET nik = ?, nama = ?, nomor_rumah = ?, alamat = ?, no_hp = ?, kategori = ?, status_iuran = ?, tabungan_cor = ?, tunggakan = ?, keterangan = ? WHERE id = ?`,
        [nik, nama, nomor_rumah, alamat, no_hp, kategori, status_iuran, Number(tabungan_cor) || 0, Number(tunggakan) || 0, keterangan, id]
    );
    await logAudit('EDIT WARGA', actor || 'Admin', `Update data warga No. ${nomor_rumah} (${nama})`);
    res.json({ success: true, message: 'Data warga berhasil diperbarui.' });
}));

app.delete('/api/members/:id', asyncRoute(async (req, res) => {
    await run('DELETE FROM members WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Warga dihapus.' });
}));

// ASSETS
app.get('/api/assets', asyncRoute(async (req, res) => {
    const rows = await all('SELECT * FROM assets ORDER BY id DESC');
    res.json({ success: true, data: rows });
}));

app.post('/api/assets', asyncRoute(async (req, res) => {
    const { nama_aset, kategori, tanggal_pembelian, nilai_pembelian, kondisi, lokasi, keterangan, actor } = req.body;
    await run('INSERT INTO assets (nama_aset, kategori, tanggal_pembelian, nilai_pembelian, kondisi, lokasi, keterangan) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [nama_aset, kategori, tanggal_pembelian, Number(nilai_pembelian) || 0, kondisi, lokasi, keterangan]);
    await logAudit('TAMBAH ASET', actor || 'Admin', `Aset: ${nama_aset}`);
    res.json({ success: true, message: 'Aset dicatat.' });
}));

// AGENDAS
app.get('/api/agendas', asyncRoute(async (req, res) => {
    const rows = await all('SELECT * FROM agendas ORDER BY tanggal ASC');
    res.json({ success: true, data: rows });
}));

app.post('/api/agendas', asyncRoute(async (req, res) => {
    const { judul, tanggal, waktu, lokasi, kategori, deskripsi, actor } = req.body;
    await run(
        'INSERT INTO agendas (judul, tanggal, waktu, lokasi, kategori, deskripsi, pembuat) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [judul, tanggal, waktu, lokasi, kategori || 'Umum', deskripsi, actor || 'Admin']
    );
    await logAudit('TAMBAH AGENDA', actor || 'Admin', `Agenda: ${judul}`);
    res.json({ success: true, message: 'Agenda berhasil ditambah.' });
}));

// AUDIT LOGS & BACKUP
app.get('/api/audit-logs', asyncRoute(async (req, res) => {
    const rows = await all('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 100');
    res.json({ success: true, data: rows });
}));

app.get('/api/admin/backup', asyncRoute(async (req, res) => {
    const filename = `backup-nuansa16a-${new Date().toISOString().slice(0,10)}.sqlite`;
    const destination = path.join(BACKUP_DIR, filename);
    db.backup(destination, err => {
        if (err) return res.status(500).json({ success: false, message: 'Gagal backup database.' });
        res.download(destination, filename);
    });
}));

app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ success: false, message: 'Kesalahan pada server.' });
});

async function startServer() {
    await initDatabase();
    app.listen(PORT, () => {
        console.log(`Server NUANSA16A berjalan di port ${PORT}`);
    });
}

startServer();
