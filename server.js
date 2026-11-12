const express = require('express');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
app.use(express.json());

// --- Configuración Criptográfica y DB MOCK ---
const SECRET_KEY = crypto.randomBytes(32); 
const IV = crypto.randomBytes(16);
const DB_FILE = './audit_log.json';

// Inicializar la base de datos mock (JSON)
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify([]));

// --- Estado del Circuit Breaker ---
let failureCount = 0;
let circuitOpen = false;
let lastFailureTime = null;
const COOLDOWN_MS = 15000;

// --- Paso 1: Sanitización (Redactor de Datos) ---
function sanitizeMessage(msg) {
    let sanitized = msg;
    // Remueve SSN o 9 dígitos
    sanitized = sanitized.replace(/\b\d{3}[-]?\d{2}[-]?\d{4}\b|\b\d{9}\b/g, '<REDACTED: SSN>');
    // Remueve Tarjetas de Crédito (13-16 dígitos)
    sanitized = sanitized.replace(/\b(?:\d[ -]*?){13,16}\b/g, '<REDACTED: CREDIT_CARD>');
    // Remueve Emails[cite: 2]
    sanitized = sanitized.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '<REDACTED: EMAIL>');
    return sanitized;
}

// --- Encriptación para el Audit Log[cite: 2] ---
function encrypt(text) {
    const cipher = crypto.createCipheriv('aes-256-cbc', SECRET_KEY, IV);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;
}

// --- Paso 2: Mock AI Call[cite: 2] ---
// Se agregó un parámetro oculto para forzar el fallo y poder demostrar el Circuit Breaker en el video.
async function mockAICall(simulateFailure = false) {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            if (simulateFailure) reject(new Error("AI Service Offline"));
            else resolve("Generated Answer"); //[cite: 2]
        }, 2000); // 2 segundos de delay[cite: 2]
    });
}

// --- El Endpoint: POST /secure-inquiry[cite: 2] ---
app.post('/secure-inquiry', async (req, res) => {
    // Acepta JSON body con userId y message[cite: 2]
    const { userId, message, simulateFailure } = req.body; 

    if (!userId || !message) {
        return res.status(400).json({ error: "Missing userId or message" });
    }

    // --- El Twist: Circuit Breaker Logic[cite: 2] ---
    if (circuitOpen) {
        if (Date.now() - lastFailureTime > COOLDOWN_MS) {
            // El tiempo de enfriamiento pasó, intentamos de nuevo (Half-Open)
            circuitOpen = false; 
            failureCount = 0;
        } else {
            // Falla instantáneamente sin esperar el timeout[cite: 2]
            return res.status(503).json({ error: "Service Busy" }); 
        }
    }

    try {
        // 1. Sanitizar el mensaje[cite: 2]
        const redactedMessage = sanitizeMessage(message);

        // 2. Llamada simulada a la IA[cite: 2]
        const aiResponse = await mockAICall(simulateFailure);

        // 3. Audit Log[cite: 2]
        const encryptedOriginal = encrypt(message);
        const logEntry = {
            timestamp: new Date().toISOString(),
            userId,
            originalEncrypted: encryptedOriginal,
            redactedMessage,
            aiResponse
        };

        const logs = JSON.parse(fs.readFileSync(DB_FILE));
        logs.push(logEntry);
        fs.writeFileSync(DB_FILE, JSON.stringify(logs, null, 2));

        // Si la llamada fue exitosa, reiniciamos el contador de fallos
        failureCount = 0;
        res.json({ response: aiResponse, redactedMessage });

    } catch (error) {
        // Manejar el fallo de la IA y activar el Circuit Breaker
        failureCount++;
        lastFailureTime = Date.now();
        
        if (failureCount >= 3) { //[cite: 2]
            circuitOpen = true;
        }
        res.status(500).json({ error: "AI Service Error" });
    }
});

app.listen(3000, () => console.log('Secure Gateway running on port 3000'));