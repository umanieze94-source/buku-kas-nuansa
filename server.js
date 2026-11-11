/**
 * NUANSA16A - Backend Node.js + SQLite
 * Mempertahankan database.sqlite dan tabel lama.
 *
 * Instalasi:
 * npm install express sqlite3 bcrypt cors multer
 *
 * Jalankan:
 * node server.js
 */

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

const allowedOrigin = process.env.CORS_ORIGIN;

app.use(cors({
    origin: allowedOrigin
        ? allowedOrigin.split(',').map(v => v.trim())
        : true
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Jangan membuka seluruh folder server ke publik.
// Hanya tampilkan halaman utama jika file tersedia.
app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'index.html');

    if (!fs.existsSync(indexPath)) {
        return res.status(404).send('File index.html tidak ditemukan.');
    }

    res.sendFile(indexPath);
});

const upload = multer({
    dest: UPLOAD_DIR,
    limits: {
        fileSize: 100 * 1024 * 1024,
        files: 1
    }
});

// DATABASE
const db = new sqlite3.Database(DB_PATH);

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) return reject(err);

            resolve({
                lastID: this.lastID,
                changes: this.changes
            });
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

// TRANSAKSI DATABASE
// Menggunakan antrean agar transaksi tidak saling menyela.
let transactionQueue = Promise.resolve();

function transaction(work) {
    const current = transactionQueue.then(async () => {
        await run('BEGIN IMMEDIATE');

        try {
            const result = await work();
            await run('COMMIT');
            return result;
        } catch (err) {
            await run('ROLLBACK').catch(() => {});
            throw err;
        }
    });

    transactionQueue = current.catch(() => {});
    return current;
}

// VALIDASI
function requiredText(value, field, max = 200) {
    if (
        typeof value !== 'string' ||
        !value.trim() ||
        value.trim().length > max
    ) {
        const err = new Error(
            `${field} wajib diisi dan maksimal ${max} karakter.`
        );
        err.status = 400;
        throw err;
    }

    return value.trim();
}

function numeric(value, field, { min = 0 } = {}) {
    const n = Number(value);

    if (!Number.isFinite(n) || n < min) {
        const err = new Error(
            `${field} harus berupa angka minimal ${min}.`
        );
        err.status = 400;
        throw err;
    }

    return n;
}

function publicError(res, err) {
    console.error(err);

    return res.status(err.status || 500).json({
        success: false,
        message: err.status
            ? err.message
            : 'Terjadi kesalahan pada server.'
    });
}

// MIGRASI DATABASE
async function tableHasColumn(table, column) {
    const columns = await all(`PRAGMA table_info(${table})`);

    return columns.some(c => c.name === column);
}

async function addColumnIfMissing(table, column, definition) {
    if (!(await tableHasColumn(table, column))) {
        await run(
            `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`
        );
    }
}

// INISIALISASI DATABASE
async function initDatabase() {
    await exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL,
            nama TEXT NOT NULL,
            must_change_password INTEGER DEFAULT 1
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

        CREATE TABLE IF NOT EXISTS iuran_warga (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            warga_id INTEGER,
            bulan TEXT NOT NULL,
            tahun TEXT NOT NULL,
            nominal REAL DEFAULT 0,
            keterangan TEXT,
            input_oleh TEXT,
            FOREIGN KEY(warga_id) REFERENCES members(id)
        );

        CREATE TABLE IF NOT EXISTS agenda_gang (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tanggal TEXT NOT NULL,
            waktu TEXT,
            nama_kegiatan TEXT NOT NULL,
            lokasi TEXT,
            keterangan TEXT,
            input_oleh TEXT
        );

        CREATE TABLE IF NOT EXISTS kas_gang (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tanggal TEXT NOT NULL,
            uraian TEXT,
            masuk REAL DEFAULT 0,
            keluar REAL DEFAULT 0,
            input_oleh TEXT
        );

        CREATE TABLE IF NOT EXISTS cor_jalan (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tanggal TEXT NOT NULL,
            uraian TEXT,
            masuk REAL DEFAULT 0,
            keluar REAL DEFAULT 0,
            input_oleh TEXT
        );

        CREATE TABLE IF NOT EXISTS jimpitan (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tanggal TEXT NOT NULL,
            nama_warga TEXT,
            nominal REAL DEFAULT 0,
            keluar REAL DEFAULT 0,
            keterangan TEXT,
            input_oleh TEXT
        );

        CREATE TABLE IF NOT EXISTS ibu_ibu (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tanggal TEXT NOT NULL,
            uraian TEXT,
            masuk REAL DEFAULT 0,
            keluar REAL DEFAULT 0,
            input_oleh TEXT
        );
    `);

    // Tambahan kolom untuk database lama.
    await addColumnIfMissing(
        'users',
        'must_change_password',
        'INTEGER DEFAULT 1'
    );

    await addColumnIfMissing(
        'leaders',
        'pic_modul',
        "TEXT DEFAULT 'Kas Gang'"
    );

    await addColumnIfMissing('leaders', 'pin_otp', 'TEXT');
    await addColumnIfMissing('members', 'pin_otp', 'TEXT');

    await addColumnIfMissing('kas_gang', 'input_oleh', 'TEXT');
    await addColumnIfMissing('cor_jalan', 'input_oleh', 'TEXT');
    await addColumnIfMissing('jimpitan', 'input_oleh', 'TEXT');
    await addColumnIfMissing('ibu_ibu', 'input_oleh', 'TEXT');

    // Membuat admin awal hanya jika belum ada.
    const admin = await get(
        'SELECT id FROM users WHERE username = ?',
        ['admin']
    );

    if (!admin) {
        const initialPassword = process.env.ADMIN_INITIAL_PASSWORD;

        if (!initialPassword || initialPassword.length < 12) {
            console.warn(
                'Admin belum dibuat. Atur ADMIN_INITIAL_PASSWORD minimal 12 karakter.'
            );
        } else {
            const hash = await bcrypt.hash(initialPassword, 12);

            await run(
                `INSERT INTO users
                (username, password, role, nama, must_change_password)
                VALUES (?, ?, ?, ?, 1)`,
                [
                    'admin',
                    hash,
                    'SUPER_ADMIN',
                    'Super Admin RT/RW'
                ]
            );

            console.log('Akun admin awal berhasil dibuat.');
        }
    }
}

// HEALTH CHECK
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        service: 'NUANSA16A API',
        database: 'SQLite'
    });
});

// LOGIN
app.post('/api/login', asyncRoute(async (req, res) => {
    const username = requiredText(
        req.body.username,
        'Username',
        80
    );

    const password = requiredText(
        req.body.password,
        'Password',
        200
    );

    const user = await get(
        'SELECT * FROM users WHERE username = ?',
        [username]
    );

    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({
            success: false,
            message: 'Username atau password salah.'
        });
    }

    res.json({
        success: true,
        user: {
            id: user.id,
            username: user.username,
            nama: user.nama,
            role: user.role,
            mustChangePassword: Boolean(user.must_change_password)
        }
    });
}));

// GANTI PASSWORD
app.post('/api/change-password', asyncRoute(async (req, res) => {
    const username = requiredText(
        req.body.username,
        'Username',
        80
    );

    const newPassword = requiredText(
        req.body.newPassword,
        'Password baru',
        200
    );

    if (newPassword.length < 12) {
        return res.status(400).json({
            success: false,
            message: 'Password baru minimal 12 karakter.'
        });
    }

    const user = await get(
        'SELECT id FROM users WHERE username = ?',
        [username]
    );

    if (!user) {
        return res.status(404).json({
            success: false,
            message: 'Pengguna tidak ditemukan.'
        });
    }

    const hash = await bcrypt.hash(newPassword, 12);

    await run(
        `UPDATE users
         SET password = ?, must_change_password = 0
         WHERE id = ?`,
        [hash, user.id]
    );

    res.json({
        success: true,
        message: 'Password berhasil diubah. Silakan login ulang.'
    });
}));

// OTP
function makeOtp() {
    return crypto.randomInt(100000, 1000000).toString();
}

async function requestOtp(table, noHp, label, res) {
    const phone = requiredText(noHp, 'Nomor HP', 30);

    const person = await get(
        `SELECT id FROM ${table} WHERE no_hp = ?`,
        [phone]
    );

    if (!person) {
        return res.status(404).json({
            success: false,
            message: `Nomor HP ${label} tidak terdaftar.`
        });
    }

    const otp = makeOtp();

    const hash = crypto
        .createHash('sha256')
        .update(otp)
        .digest('hex');

    await run(
        `UPDATE ${table} SET pin_otp = ? WHERE id = ?`,
        [hash, person.id]
    );

    const response = {
        success: true,
        message: 'OTP dibuat. Hubungkan layanan SMS/WhatsApp untuk pengiriman.'
    };

    if (process.env.NODE_ENV !== 'production') {
        response.dev_otp = otp;
    }

    res.json(response);
}

async function verifyOtp(table, noHp, otp, label, res) {
    const phone = requiredText(noHp, 'Nomor HP', 30);
    const code = requiredText(otp, 'OTP', 6);

    const hash = crypto
        .createHash('sha256')
        .update(code)
        .digest('hex');

    const person = await get(
        `SELECT * FROM ${table}
         WHERE no_hp = ? AND pin_otp = ?`,
        [phone, hash]
    );

    if (!person) {
        return res.status(400).json({
            success: false,
            message: `OTP ${label} salah atau sudah digunakan.`
        });
    }

    await run(
        `UPDATE ${table} SET pin_otp = NULL WHERE id = ?`,
        [person.id]
    );

    const user = table === 'leaders'
        ? {
            id: person.id,
            nama: person.nama,
            jabatan: person.jabatan,
            pic_modul: person.pic_modul,
            role: 'LEADER'
        }
        : {
            id: person.id,
            nama: person.nama,
            no_hp: person.no_hp,
            role: 'WARGA'
        };

    res.json({
        success: true,
        user
    });
}

app.post(
    '/api/leader/request-otp',
    asyncRoute((req, res) =>
        requestOtp('leaders', req.body.no_hp, 'pengurus', res)
    )
);

app.post(
    '/api/leader/verify-otp',
    asyncRoute((req, res) =>
        verifyOtp(
            'leaders',
            req.body.no_hp,
            req.body.otp,
            'pengurus',
            res
        )
    )
);

app.post(
    '/api/warga/request-otp',
    asyncRoute((req, res) =>
        requestOtp('members', req.body.no_hp, 'warga', res)
    )
);

app.post(
    '/api/warga/verify-otp',
    asyncRoute((req, res) =>
        verifyOtp(
            'members',
            req.body.no_hp,
            req.body.otp,
            'warga',
            res
        )
    )
);

// DATA WARGA
app.get('/api/members', asyncRoute(async (req, res) => {
    const rows = await all(
        `SELECT id, nik, nama, alamat, no_hp, kategori
         FROM members ORDER BY nama`
    );

    res.json({
        success: true,
        data: rows
    });
}));

app.post('/api/members', asyncRoute(async (req, res) => {
    const nama = requiredText(req.body.nama, 'Nama');

    const result = await run(
        `INSERT INTO members
        (nik, nama, alamat, no_hp, kategori)
        VALUES (?, ?, ?, ?, ?)`,
        [
            req.body.nik || null,
            nama,
            req.body.alamat || null,
            req.body.no_hp || null,
            req.body.kategori || null
        ]
    );

    res.status(201).json({
        success: true,
        id: result.lastID,
        message: 'Data warga berhasil ditambahkan.'
    });
}));

app.put('/api/members/:id', asyncRoute(async (req, res) => {
    const id = numeric(req.params.id, 'ID', { min: 1 });
    const nama = requiredText(req.body.nama, 'Nama');

    const result = await run(
        `UPDATE members
         SET nik = ?, nama = ?, alamat = ?, no_hp = ?, kategori = ?
         WHERE id = ?`,
        [
            req.body.nik || null,
            nama,
            req.body.alamat || null,
            req.body.no_hp || null,
            req.body.kategori || null,
            id
        ]
    );

    if (!result.changes) {
        return res.status(404).json({
            success: false,
            message: 'Warga tidak ditemukan.'
        });
    }

    res.json({
        success: true,
        message: 'Data warga diperbarui.'
    });
}));

app.delete('/api/members/:id', asyncRoute(async (req, res) => {
    const id = numeric(req.params.id, 'ID', { min: 1 });

    const used = await get(
        'SELECT COUNT(*) AS total FROM iuran_warga WHERE warga_id = ?',
        [id]
    );

    if (used.total > 0) {
        return res.status(409).json({
            success: false,
            message: 'Warga memiliki riwayat iuran. Nonaktifkan data, jangan hapus.'
        });
    }

    const result = await run(
        'DELETE FROM members WHERE id = ?',
        [id]
    );

    if (!result.changes) {
        return res.status(404).json({
            success: false,
            message: 'Warga tidak ditemukan.'
        });
    }

    res.json({ success: true });
}));

// DATA PENGURUS
app.get('/api/leaders', asyncRoute(async (req, res) => {
    const rows = await all(
        `SELECT id, nama, jabatan, no_hp, pic_modul
         FROM leaders ORDER BY nama`
    );

    res.json({
        success: true,
        data: rows
    });
}));

app.post('/api/leaders', asyncRoute(async (req, res) => {
    const nama = requiredText(req.body.nama, 'Nama');
    const jabatan = requiredText(req.body.jabatan, 'Jabatan');
    const noHp = requiredText(req.body.no_hp, 'Nomor HP', 30);

    const result = await run(
        `INSERT INTO leaders (nama, jabatan, no_hp, pic_modul)
         VALUES (?, ?, ?, ?)`,
        [
            nama,
            jabatan,
            noHp,
            req.body.pic_modul || 'Kas Gang'
        ]
    );

    res.status(201).json({
        success: true,
        id: result.lastID,
        message: 'Data pengurus ditambahkan.'
    });
}));

app.put('/api/leaders/:id', asyncRoute(async (req, res) => {
    const id = numeric(req.params.id, 'ID', { min: 1 });

    const result = await run(
        `UPDATE leaders
         SET nama = ?, jabatan = ?, no_hp = ?, pic_modul = ?
         WHERE id = ?`,
        [
            requiredText(req.body.nama, 'Nama'),
            requiredText(req.body.jabatan, 'Jabatan'),
            requiredText(req.body.no_hp, 'Nomor HP', 30),
            req.body.pic_modul || 'Kas Gang',
            id
        ]
    );

    if (!result.changes) {
        return res.status(404).json({
            success: false,
            message: 'Pengurus tidak ditemukan.'
        });
    }

    res.json({ success: true });
}));

app.delete('/api/leaders/:id', asyncRoute(async (req, res) => {
    const result = await run(
        'DELETE FROM leaders WHERE id = ?',
        [numeric(req.params.id, 'ID', { min: 1 })]
    );

    if (!result.changes) {
        return res.status(404).json({
            success: false,
            message: 'Pengurus tidak ditemukan.'
        });
    }

    res.json({ success: true });
}));

// AGENDA GANG
app.get('/api/agenda', asyncRoute(async (req, res) => {
    const rows = await all(
        `SELECT * FROM agenda_gang
         ORDER BY tanggal DESC, id DESC`
    );

    res.json({
        success: true,
        data: rows
    });
}));

app.post('/api/agenda', asyncRoute(async (req, res) => {
    const result = await run(
        `INSERT INTO agenda_gang
        (tanggal, waktu, nama_kegiatan, lokasi, keterangan, input_oleh)
        VALUES (?, ?, ?, ?, ?, ?)`,
        [
            requiredText(req.body.tanggal, 'Tanggal', 10),
            req.body.waktu || null,
            requiredText(req.body.nama_kegiatan, 'Nama kegiatan'),
            req.body.lokasi || null,
            req.body.keterangan || null,
            req.body.input_oleh || null
        ]
    );

    res.status(201).json({
        success: true,
        id: result.lastID,
        message: 'Agenda tersimpan.'
    });
}));

app.delete('/api/agenda/:id', asyncRoute(async (req, res) => {
    const result = await run(
        'DELETE FROM agenda_gang WHERE id = ?',
        [numeric(req.params.id, 'ID', { min: 1 })]
    );

    if (!result.changes) {
        return res.status(404).json({
            success: false,
            message: 'Agenda tidak ditemukan.'
        });
    }

    res.json({ success: true });
}));

// IURAN WARGA
app.get('/api/iuran', asyncRoute(async (req, res) => {
    const rows = await all(`
        SELECT i.*, m.nama AS nama_warga
        FROM iuran_warga i
        LEFT JOIN members m ON m.id = i.warga_id
        ORDER BY i.id DESC
    `);

    res.json({
        success: true,
        data: rows
    });
}));

app.post('/api/iuran', asyncRoute(async (req, res) => {
    const wargaId = numeric(
        req.body.warga_id,
        'Warga',
        { min: 1 }
    );

    const bulan = requiredText(req.body.bulan, 'Bulan', 30);
    const tahun = requiredText(
        String(req.body.tahun || ''),
        'Tahun',
        4
    );

    const nominal = numeric(
        req.body.nominal,
        'Nominal',
        { min: 1 }
    );

    const inputOleh = req.body.input_oleh || null;

    const warga = await get(
        'SELECT id, nama FROM members WHERE id = ?',
        [wargaId]
    );

    if (!warga) {
        return res.status(404).json({
            success: false,
            message: 'Data warga tidak ditemukan.'
        });
    }

    const tanggal = new Date().toISOString().slice(0, 10);

    const result = await transaction(async () => {
        const iuran = await run(
            `INSERT INTO iuran_warga
            (warga_id, bulan, tahun, nominal, keterangan, input_oleh)
            VALUES (?, ?, ?, ?, ?, ?)`,
            [
                wargaId,
                bulan,
                tahun,
                nominal,
                req.body.keterangan || null,
                inputOleh
            ]
        );

        await run(
            `INSERT INTO kas_gang
            (tanggal, uraian, masuk, keluar, input_oleh)
            VALUES (?, ?, ?, 0, ?)`,
            [
                tanggal,
                `Iuran Bulanan (${bulan} ${tahun}) - ${warga.nama}`,
                nominal,
                inputOleh
            ]
        );

        return iuran;
    });

    res.status(201).json({
        success: true,
        id: result.lastID,
        message: 'Iuran dan pemasukan Kas Gang berhasil dicatat.'
    });
}));

app.delete('/api/iuran/:id', asyncRoute(async (req, res) => {
    return res.status(409).json({
        success: false,
        message: 'Penghapusan iuran dinonaktifkan untuk menjaga audit keuangan. Gunakan mekanisme pembatalan/koreksi transaksi.'
    });
}));

// MODUL KAS
const MODULES = {
    'kas-gang': {
        table: 'kas_gang',
        columns: [
            'tanggal',
            'uraian',
            'masuk',
            'keluar',
            'input_oleh'
        ]
    },

    'cor-jalan': {
        table: 'cor_jalan',
        columns: [
            'tanggal',
            'uraian',
            'masuk',
            'keluar',
            'input_oleh'
        ]
    },

    'ibu-ibu': {
        table: 'ibu_ibu',
        columns: [
            'tanggal',
            'uraian',
            'masuk',
            'keluar',
            'input_oleh'
        ]
    },

    'jimpitan': {
        table: 'jimpitan',
        columns: [
            'tanggal',
            'nama_warga',
            'nominal',
            'keluar',
            'keterangan',
            'input_oleh'
        ]
    }
};

for (const [route, config] of Object.entries(MODULES)) {
    const table = config.table;

    app.get(`/api/${route}`, asyncRoute(async (req, res) => {
        const rows = await all(
            `SELECT * FROM ${table}
             ORDER BY tanggal DESC, id DESC`
        );

        res.json({
            success: true,
            data: rows
        });
    }));

    app.post(`/api/${route}`, asyncRoute(async (req, res) => {
        const b = req.body;
        let values;

        if (route === 'jimpitan') {
            values = [
                requiredText(b.tanggal, 'Tanggal', 10),
                b.nama_warga || null,
                numeric(b.nominal, 'Nominal'),
                numeric(b.keluar || 0, 'Pengeluaran'),
                b.keterangan || null,
                b.input_oleh || null
            ];
        } else {
            values = [
                requiredText(b.tanggal, 'Tanggal', 10),
                b.uraian || null,
                numeric(b.masuk || 0, 'Pemasukan'),
                numeric(b.keluar || 0, 'Pengeluaran'),
                b.input_oleh || null
            ];
        }

        if (
            route !== 'jimpitan' &&
            values[2] === 0 &&
            values[3] === 0
        ) {
            return res.status(400).json({
                success: false,
                message: 'Isi nominal pemasukan atau pengeluaran.'
            });
        }

        const placeholders = config.columns
            .map(() => '?')
            .join(',');

        const result = await run(
            `INSERT INTO ${table}
            (${config.columns.join(',')})
            VALUES (${placeholders})`,
            values
        );

        res.status(201).json({
            success: true,
            id: result.lastID,
            message: 'Data berhasil disimpan.'
        });
    }));

    app.put(`/api/${route}/:id`, asyncRoute(async (req, res) => {
        const b = req.body;
        let fields;
        let values;

        if (route === 'jimpitan') {
            fields = [
                'tanggal = ?',
                'nama_warga = ?',
                'nominal = ?',
                'keluar = ?',
                'keterangan = ?'
            ];

            values = [
                requiredText(b.tanggal, 'Tanggal', 10),
                b.nama_warga || null,
                numeric(b.nominal, 'Nominal'),
                numeric(b.keluar || 0, 'Pengeluaran'),
                b.keterangan || null
            ];
        } else {
            fields = [
                'tanggal = ?',
                'uraian = ?',
                'masuk = ?',
                'keluar = ?'
            ];

            values = [
                requiredText(b.tanggal, 'Tanggal', 10),
                b.uraian || null,
                numeric(b.masuk || 0, 'Pemasukan'),
                numeric(b.keluar || 0, 'Pengeluaran')
            ];
        }

        const result = await run(
            `UPDATE ${table}
             SET ${fields.join(',')}
             WHERE id = ?`,
            [
                ...values,
                numeric(req.params.id, 'ID', { min: 1 })
            ]
        );

        if (!result.changes) {
            return res.status(404).json({
                success: false,
                message: 'Transaksi tidak ditemukan.'
            });
        }

        res.json({
            success: true,
            message: 'Transaksi diperbarui.'
        });
    }));

    app.delete(`/api/${route}/:id`, asyncRoute(async (req, res) => {
        const result = await run(
            `DELETE FROM ${table} WHERE id = ?`,
            [numeric(req.params.id, 'ID', { min: 1 })]
        );

        if (!result.changes) {
            return res.status(404).json({
                success: false,
                message: 'Transaksi tidak ditemukan.'
            });
        }

        res.json({ success: true });
    }));
}

// BACKUP DATABASE
app.get('/api/admin/backup', asyncRoute(async (req, res) => {
    const filename =
        `backup-database-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`;

    const destination = path.join(BACKUP_DIR, filename);

    db.backup(destination, err => {
        if (err) {
            console.error('Backup gagal:', err);

            if (!res.headersSent) {
                res.status(500).json({
                    success: false,
                    message: 'Gagal membuat backup database.'
                });
            }

            return;
        }

        res.download(destination, filename, downloadErr => {
            if (downloadErr) {
                console.error(
                    'Pengiriman file backup gagal:',
                    downloadErr
                );
            }
        });
    });
}));

// RESTORE DATABASE
// Restore online dinonaktifkan untuk menghindari kerusakan database aktif.
app.post(
    '/api/admin/restore',
    upload.single('database_file'),
    (req, res) => {
        if (req.file) {
            fs.unlink(req.file.path, () => {});
        }

        return res.status(501).json({
            success: false,
            message: 'Restore online dinonaktifkan demi keamanan database. Hentikan server terlebih dahulu dan lakukan restore offline setelah membuat salinan database.sqlite.'
        });
    }
);

// ENDPOINT TIDAK DITEMUKAN
app.use('/api', (req, res) => {
    res.status(404).json({
        success: false,
        message: 'Endpoint API tidak ditemukan.'
    });
});

// PENANGANAN ERROR
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        return res.status(400).json({
            success: false,
            message: 'Upload gagal: ' + err.message
        });
    }

    return publicError(res, err);
});

// JALANKAN SERVER SETELAH DATABASE SIAP
async function startServer() {
    try {
        await new Promise((resolve, reject) => {
            db.run('PRAGMA foreign_keys = ON', err => {
                if (err) reject(err);
                else resolve();
            });
        });

        await new Promise((resolve, reject) => {
            db.run('PRAGMA journal_mode = WAL', err => {
                if (err) reject(err);
                else resolve();
            });
        });

        await new Promise((resolve, reject) => {
            db.run('PRAGMA busy_timeout = 5000', err => {
                if (err) reject(err);
                else resolve();
            });
        });

        await initDatabase();

        const server = app.listen(PORT, () => {
            console.log(
                `NUANSA16A berjalan di http://localhost:${PORT}`
            );
            console.log('Database SQLite siap digunakan.');
        });

        function shutdown() {
            console.log('Menutup server...');

            server.close(() => {
                db.close(err => {
                    if (err) {
                        console.error(
                            'Gagal menutup database:',
                            err.message
                        );
                        process.exit(1);
                    }

                    process.exit(0);
                });
            });
        }

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);

    } catch (err) {
        console.error('Server gagal dijalankan:', err);
        db.close(() => process.exit(1));
    }
}

startServer();