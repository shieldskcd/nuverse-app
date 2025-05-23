// server/index.js
require('dotenv').config(); // Load environment variables from .env file

const express = require('express');
const http = require('http'); // Node.js built-in HTTP module
const { Server } = require('socket.io');
const mysql = require('mysql2/promise'); // Using promise-based version for async/await
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// --- Define 'io' here, AFTER 'server' and 'app' ---
const io = new Server(server, {
    cors: {
        origin: process.env.CLIENT_URL || "http://localhost:3000", // Allow your React app to connect
        methods: ["GET", "POST"]
    }
});
// --- END 'io' DEFINITION ---

const PORT = process.env.PORT || 3001; // Backend will run on port 3001 by default

// Middleware for Express HTTP routes
app.use(cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
}));
app.use(express.json()); // For parsing JSON request bodies

// Database Connection Pool
let dbPool;
async function connectToDatabase() {
    try {
        dbPool = await mysql.createPool({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
        });
        console.log('Connected to MariaDB/MySQL database.');
    } catch (err) {
        console.error('Failed to connect to database:', err);
        process.exit(1); // Exit process if database connection fails
    }
}
connectToDatabase();

// Basic API Route (for testing if server is running)
app.get('/', (req, res) => {
    res.send('NuVerse Backend is running!');
});

// --- Socket.IO Connection and Event Handlers ---
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Handle 'client:joinGame' event
    socket.on('client:joinGame', async ({ sessionId: sessionName, userId }) => { // sessionId is now sessionName
        console.log(`[Socket Debug] client:joinGame event received for session: ${sessionName}, user: ${userId}`);
        
        try {
            // Step 1: Ensure user exists in 'users' table or create a dummy one
            let [users] = await dbPool.query('SELECT user_id FROM users WHERE username = ?', [userId]);
            let user_id;
            if (users.length === 0) {
                console.log(`[Socket Debug] User ${userId} not found, creating dummy user.`);
                const [insertResult] = await dbPool.query('INSERT INTO users (username) VALUES (?)', [userId]);
                user_id = insertResult.insertId;
            } else {
                user_id = users[0].user_id;
            }

            // Step 2: Get or Create numerical game_session ID from sessionName
            let [sessions] = await dbPool.query('SELECT session_id FROM game_sessions WHERE session_name = ?', [sessionName]);
            let numerical_session_id;

            if (sessions.length === 0) {
                // Session does not exist, create it (assign GM to this user for MVP)
                console.log(`[Socket Debug] Game session '${sessionName}' not found, creating new session.`);
                const [insertSessionResult] = await dbPool.query(
                    'INSERT INTO game_sessions (gm_user_id, session_name) VALUES (?, ?)',
                    [user_id, sessionName] // Assigning the joining user as GM for now
                );
                numerical_session_id = insertSessionResult.insertId;
            } else {
                // Session exists, use its ID
                numerical_session_id = sessions[0].session_id;
                console.log(`[Socket Debug] Found existing session '${sessionName}' with ID: ${numerical_session_id}`);
            }

            // Step 3: Join the Socket.IO room using the numerical session ID
            socket.join(numerical_session_id);
            console.log(`[Socket Debug] Socket ${socket.id} joined room ${numerical_session_id}`);

            // Step 4: Fetch initial game state from DB using numerical_session_id

            // NEW: Fetch ALL card definitions from the 'cards' table for the debug display
            const [allCardDefinitions] = await dbPool.query(`SELECT * FROM cards ORDER BY card_id ASC LIMIT 50`); // Limit for sanity
            console.log(`[Socket Debug] Fetched ${allCardDefinitions.length} general card definitions.`);

            // Fetch specific player_cards for the session (for actual game state)
            const [sessionPlayerCards] = await dbPool.query(
                `SELECT pc.*, c.*
                 FROM player_cards pc
                 JOIN cards c ON pc.card_id = c.card_id
                 WHERE pc.session_id = ?`,
                [numerical_session_id]
            );

            const [combatLogEntries] = await dbPool.query(
                `SELECT * FROM combat_log WHERE session_id = ? ORDER BY action_timestamp ASC`,
                [numerical_session_id]
            );

            const gameState = {
                sessionId: numerical_session_id, // Send numerical ID to frontend
                sessionName: sessionName, // Also send the friendly name
                players: [{ userId, username: 'TestUser' }], // Dummy, will fetch from DB later
                
                // NEW: Pass ALL card definitions separately for the debug display
                allCardDefinitions: allCardDefinitions.map(card => ({
                    card_id: card.card_id,
                    card_name: card.card_name,
                    card_type: card.card_type,
                    description: card.description, // etc. basic info
                    power_level: card.power_level // For basic display
                })),
                
                // Pass player_cards for the session, for actual game state components later
                cards: sessionPlayerCards.map(pc => ({ // This 'cards' array should still be for player_cards
                    card_id: pc.card_id,
                    player_card_id: pc.player_card_id,
                    ownerId: pc.user_id,
                    location: pc.location,
                    slot_id: pc.slot_id,
                    is_active: pc.is_active,
                    // Include all card properties from the 'cards' table
                    card_name: pc.card_name, card_type: pc.card_type, description: pc.description, power_level: pc.power_level,
                    card_hero_type: pc.card_hero_type, card_hero_class: pc.card_hero_class, card_hero_role: pc.card_hero_role,
                    card_ability_class_melee: pc.card_ability_class_melee, card_ability_class_longrange: pc.card_ability_class_longrange, card_ability_class_areaofeffect: pc.card_ability_class_areaofeffect, card_ability_class_duration: pc.card_ability_class_duration,
                    card_ability_is_burst: pc.card_ability_is_burst, card_ability_burst_link_action: pc.card_ability_burst_link_action, card_ability_burst_effect: pc.card_ability_burst_effect,
                    card_suit_might_modifier: pc.card_suit_might_modifier, card_suit_agility_modifier: pc.card_suit_agility_modifier, card_suit_guts_modifier: pc.card_suit_guts_modifier, card_suit_intellect_modifier: pc.card_intellect_modifier, card_suit_rally_modifier: pc.card_rally_modifier,
                    card_weapon_damage: pc.card_weapon_damage, card_weapon_range: pc.card_weapon_range, card_weapon_effect_slot1: pc.card_weapon_effect_slot1, card_weapon_effect_slot2: pc.card_weapon_effect_slot2, card_weapon_effect_slot3: pc.card_weapon_effect_slot3,
                })),
                combatLog: combatLogEntries.map(log => ({
                    logId: log.log_id, userId: log.user_id, cardId: log.card_id, actionType: log.action_type, actionDescription: log.action_description, timestamp: log.action_timestamp
                }))
            };
            socket.emit('server:gameState', gameState);
            socket.to(numerical_session_id).emit('server:playerJoined', { userId, username: 'TestUser' }); // Broadcast to others
            console.log(`[Socket Debug] Emitted initial game state for session ${numerical_session_id}.`);

            // Check if player_session exists, if not, create it
            const [playerSessions] = await dbPool.query('SELECT * FROM player_sessions WHERE user_id = ? AND session_id = ?', [user_id, numerical_session_id]);
            if (playerSessions.length === 0) {
                await dbPool.query('INSERT INTO player_sessions (user_id, session_id) VALUES (?, ?)', [user_id, numerical_session_id]);
                console.log(`[Socket Debug] Created player_session entry for user ${user_id} in session ${numerical_session_id}.`);
            }

        } catch (err) {
            console.error(`[Socket Error] Error processing client:joinGame for session ${sessionName}:`, err);
            socket.emit('error', 'Failed to join game. See server logs for details.');
        }
    });

    // Handle 'client:createCard' event
    socket.on('client:createCard', async ({ sessionId: numerical_session_id, userId, cardData }) => { // sessionId is now numerical_session_id
        console.log(`[Socket Debug] client:createCard received for session ${numerical_session_id}, user ${userId}. Card:`, cardData.card_name);

        try {
            // Ensure the user exists and get user_id
            let [users] = await dbPool.query('SELECT user_id FROM users WHERE username = ?', [userId]);
            let user_id;
            if (users.length === 0) {
                console.log(`[Socket Debug] User ${userId} not found during card creation, creating dummy user.`);
                const [insertResult] = await dbPool.query('INSERT INTO users (username) VALUES (?)', [userId]);
                user_id = insertResult.insertId;
            } else {
                user_id = users[0].user_id;
            }

            // Insert the new card into the 'cards' table
            const [cardInsertResult] = await dbPool.query(
                `INSERT INTO cards (
                    card_name, card_type, description, is_active, power_level,
                    card_hero_type, card_hero_class, card_hero_role,
                    card_ability_class_melee, card_ability_class_longrange, card_ability_class_areaofeffect, card_ability_class_duration,
                    card_ability_is_burst, card_ability_burst_link_action, card_ability_burst_effect,
                    card_suit_might_modifier, card_suit_agility_modifier, card_suit_guts_modifier, card_suit_intellect_modifier, card_suit_rally_modifier,
                    card_weapon_damage, card_weapon_range, card_weapon_effect_slot1, card_weapon_effect_slot2, card_weapon_effect_slot3
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    cardData.card_name, cardData.card_type, cardData.description, cardData.is_active, cardData.power_level,
                    cardData.card_hero_type || null, cardData.card_hero_class || null, cardData.card_hero_role || null,
                    cardData.card_ability_class_melee || null, cardData.card_ability_class_longrange || null, cardData.card_ability_class_areaofeffect || null, cardData.card_ability_class_duration || null,
                    cardData.card_ability_is_burst || null, cardData.card_ability_burst_link_action || null, cardData.card_ability_burst_effect || null,
                    cardData.card_suit_might_modifier || null, cardData.card_suit_agility_modifier || null, cardData.card_suit_guts_modifier || null, cardData.card_intellect_modifier || null, cardData.card_rally_modifier || null,
                    cardData.card_weapon_damage || null, cardData.card_weapon_range || null, cardData.card_weapon_effect_slot1 || null, cardData.card_weapon_effect_slot2 || null, cardData.card_weapon_effect_slot3 || null
                ]
            );
            const newCardId = cardInsertResult.insertId;
            console.log(`[Socket Debug] Card inserted into 'cards' table with ID: ${newCardId}`);

            // Insert into 'player_cards' to link it to the session and user
            const [playerCardInsertResult] = await dbPool.query(
                'INSERT INTO player_cards (user_id, card_id, session_id, location, slot_id) VALUES (?, ?, ?, ?, ?)',
                [user_id, newCardId, numerical_session_id, 'CreatedCardStorage', null]
            );
            const playerCardId = playerCardInsertResult.insertId;

            // Construct the full new card object to send back to clients
            const fullNewCard = {
                card_id: newCardId,
                player_card_id: playerCardId,
                ownerId: userId,
                location: 'CreatedCardStorage',
                slot_id: null,
                is_active: false,
                ...cardData
            };
            
            // Add entry to combat_log
            await dbPool.query(
                'INSERT INTO combat_log (session_id, user_id, card_id, action_type, action_description) VALUES (?, ?, ?, ?, ?)',
                [numerical_session_id, user_id, newCardId, 'Card Created', `${userId} created card "${cardData.card_name}"`]
            );
            console.log(`[Socket Debug] Log entry for card creation added.`);

            // Broadcast the new card to all clients in the session
            io.to(numerical_session_id).emit('server:cardCreated', fullNewCard);
            console.log(`[Socket Debug] Broadcasted new card to session ${numerical_session_id}`);

        } catch (err) {
            console.error(`[Socket Error] Error creating card for session ${numerical_session_id}:`, err);
            socket.emit('error', 'Failed to create card. See server logs for details.');
        }
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        // Handle user leaving rooms, update session, etc.
    });
});

// Start the server
server.listen(PORT, () => {
    console.log(`NuVerse Backend listening on port ${PORT}`);
});