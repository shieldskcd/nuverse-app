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

            // Fetch ALL card definitions from the 'cards' table for the debug display
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
                
                // Pass ALL card definitions separately for the debug display
                allCardDefinitions: allCardDefinitions.map(card => ({
                    card_id: card.card_id,
                    card_name: card.card_name,
                    card_type: card.card_type,
                    description: card.description, // etc. basic info
                    power_level: card.power_level
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

            // Step 5: Check/create player_session entry
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
                ownerId: userId, // Frontend userId string
                location: 'CreatedCardStorage',
                slot_id: null,
                is_active: false,
                ...cardData, // Include original card data
                // Ensure correct ownerId from DB (numerical) is mapped back if needed
                // For now, userId (string) is okay for ownerId in frontend
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

    // NEW: Handle 'client:moveCard' event
    socket.on('client:moveCard', async ({ sessionId, userId, playerCardId, oldLocation, destinationLocation, destinationSlotId, isActive }) => {
        console.log(`[Socket Debug] client:moveCard received for session ${sessionId}, user ${userId}. Card ${playerCardId} from ${oldLocation} to ${destinationLocation}.`);

        try {
            // Step 1: Validate move and get user_id (optional, assume valid for MVP)
            let [users] = await dbPool.query('SELECT user_id FROM users WHERE username = ?', [userId]);
            let user_id = users[0]?.user_id;
            if (!user_id) {
                console.error(`[Socket Error] User ${userId} not found for move card operation.`);
                socket.emit('error', 'User not authenticated for card move.');
                return;
            }

            // Step 2: Update the player_cards table
            const [updateResult] = await dbPool.query(
                `UPDATE player_cards
                 SET location = ?, slot_id = ?, is_active = ?
                 WHERE player_card_id = ? AND user_id = ? AND session_id = ?`,
                [destinationLocation, destinationSlotId, isActive, playerCardId, user_id, sessionId]
            );

            if (updateResult.affectedRows === 0) {
                console.warn(`[Socket Warn] No rows updated for playerCardId ${playerCardId} in session ${sessionId}. Card might not belong to user/session or doesn't exist.`);
                socket.emit('error', 'Failed to move card (card not found or permission denied).');
                return;
            }
            console.log(`[Socket Debug] player_cards updated for playerCardId ${playerCardId}.`);

            // Step 3: Fetch the updated card data to broadcast
            const [updatedCardRows] = await dbPool.query(
                `SELECT pc.*, c.*
                 FROM player_cards pc
                 JOIN cards c ON pc.card_id = c.card_id
                 WHERE pc.player_card_id = ?`,
                [playerCardId]
            );

            if (updatedCardRows.length === 0) {
                console.error(`[Socket Error] Could not refetch updated card ${playerCardId} after move.`);
                socket.emit('error', 'Failed to retrieve moved card data.');
                return;
            }

            const updatedCardData = {
                card_id: updatedCardRows[0].card_id,
                player_card_id: updatedCardRows[0].player_card_id,
                ownerId: userId, // Keep frontend's userId string
                location: updatedCardRows[0].location,
                slot_id: updatedCardRows[0].slot_id,
                is_active: updatedCardRows[0].is_active,
                card_name: updatedCardRows[0].card_name,
                card_type: updatedCardRows[0].card_type,
                description: updatedCardRows[0].description,
                power_level: updatedCardRows[0].power_level,
                // ... map all other card properties from 'c.*' as needed for broadcast
                // (copying all from the joinGame handler's map for consistency)
                card_hero_type: updatedCardRows[0].card_hero_type, card_hero_class: updatedCardRows[0].card_hero_class, card_hero_role: updatedCardRows[0].card_hero_role,
                card_ability_class_melee: updatedCardRows[0].card_ability_class_melee, card_ability_class_longrange: updatedCardRows[0].card_ability_class_longrange, card_ability_class_areaofeffect: updatedCardRows[0].card_ability_class_areaofeffect, card_ability_class_duration: updatedCardRows[0].card_ability_class_duration,
                card_ability_is_burst: updatedCardRows[0].card_ability_is_burst, card_ability_burst_link_action: updatedCardRows[0].card_ability_burst_link_action, card_ability_burst_effect: updatedCardRows[0].card_ability_burst_effect,
                card_suit_might_modifier: updatedCardRows[0].card_suit_might_modifier, card_suit_agility_modifier: updatedCardRows[0].card_suit_agility_modifier, card_suit_guts_modifier: updatedCardRows[0].card_guts_modifier, card_suit_intellect_modifier: updatedCardRows[0].card_intellect_modifier, card_suit_rally_modifier: updatedCardRows[0].card_rally_modifier,
                card_weapon_damage: updatedCardRows[0].card_weapon_damage, card_weapon_range: updatedCardRows[0].card_weapon_range, card_weapon_effect_slot1: updatedCardRows[0].card_weapon_effect_slot1, card_weapon_effect_slot2: updatedCardRows[0].card_weapon_effect_slot2, card_weapon_effect_slot3: updatedCardRows[0].card_weapon_effect_slot3,
                oldLocation: oldLocation // Send old location for frontend to remove from previous slot
            };

            // Step 4: Add log entry for move
            await dbPool.query(
                'INSERT INTO combat_log (session_id, user_id, card_id, action_type, action_description) VALUES (?, ?, ?, ?, ?)',
                [sessionId, user_id, updatedCardData.card_id, 'Card Moved', `${userId} moved card "${updatedCardData.card_name}" from ${oldLocation} to ${destinationLocation}`]
            );
            console.log(`[Socket Debug] Log entry for card move added.`);


            // Step 5: Broadcast the updated card data to all clients in the session
            io.to(sessionId).emit('server:cardMoved', updatedCardData);
            console.log(`[Socket Debug] Broadcasted card move for ${updatedCardData.card_name}.`);

        } catch (err) {
            console.error(`[Socket Error] Error moving card ${playerCardId} in session ${sessionId}:`, err);
            socket.emit('error', 'Failed to move card. See server logs for details.');
        }
    });

    // Handle 'client:playCardAction' event (moves card to discard)
    socket.on('client:playCardAction', async ({ sessionId, userId, playerCardId, oldLocation }) => {
        console.log(`[Socket Debug] client:playCardAction received for session ${sessionId}, user ${userId}. Card ${playerCardId}.`);

        try {
            // Step 1: Validate and get user_id
            let [users] = await dbPool.query('SELECT user_id FROM users WHERE username = ?', [userId]);
            let user_id = users[0]?.user_id;
            if (!user_id) {
                console.error(`[Socket Error] User ${userId} not found for play card operation.`);
                socket.emit('error', 'User not authenticated for playing card.');
                return;
            }

            // Step 2: Update player_cards: set location to 'DiscardPile', is_active to false
            const [updateResult] = await dbPool.query(
                `UPDATE player_cards
                 SET location = ?, slot_id = ?, is_active = ?
                 WHERE player_card_id = ? AND user_id = ? AND session_id = ?`,
                ['DiscardPile', null, false, playerCardId, user_id, sessionId]
            );

            if (updateResult.affectedRows === 0) {
                console.warn(`[Socket Warn] No rows updated for playerCardId ${playerCardId} on play. Card might not belong to user/session or doesn't exist.`);
                socket.emit('error', 'Failed to play card (card not found or permission denied).');
                return;
            }
            console.log(`[Socket Debug] player_cards updated for played card ${playerCardId}.`);

            // Step 3: Fetch the updated card data to broadcast
            const [updatedCardRows] = await dbPool.query(
                `SELECT pc.*, c.*
                 FROM player_cards pc
                 JOIN cards c ON pc.card_id = c.card_id
                 WHERE pc.player_card_id = ?`,
                [playerCardId]
            );

            if (updatedCardRows.length === 0) {
                console.error(`[Socket Error] Could not refetch updated card ${playerCardId} after play action.`);
                socket.emit('error', 'Failed to retrieve played card data.');
                return;
            }

            const playedCardData = {
                card_id: updatedCardRows[0].card_id,
                player_card_id: updatedCardRows[0].player_card_id,
                ownerId: userId, // Keep frontend's userId string
                location: updatedCardRows[0].location, // Should be 'DiscardPile'
                slot_id: updatedCardRows[0].slot_id, // Should be null
                is_active: updatedCardRows[0].is_active, // Should be false
                card_name: updatedCardRows[0].card_name,
                card_type: updatedCardRows[0].card_type,
                description: updatedCardRows[0].description,
                power_level: updatedCardRows[0].power_level,
                // ... map all other card properties for broadcast
                card_hero_type: updatedCardRows[0].card_hero_type, card_hero_class: updatedCardRows[0].card_hero_class, card_hero_role: updatedCardRows[0].card_hero_role,
                card_ability_class_melee: updatedCardRows[0].card_ability_class_melee, card_ability_class_longrange: updatedCardRows[0].card_ability_class_longrange, card_ability_class_areaofeffect: updatedCardRows[0].card_ability_class_areaofeffect, card_ability_class_duration: updatedCardRows[0].card_ability_class_duration,
                card_ability_is_burst: updatedCardRows[0].card_ability_is_burst, card_ability_burst_link_action: updatedCardRows[0].card_ability_burst_link_action, card_ability_burst_effect: updatedCardRows[0].card_ability_burst_effect,
                card_suit_might_modifier: updatedCardRows[0].card_suit_might_modifier, card_suit_agility_modifier: updatedCardRows[0].card_agility_modifier, card_suit_guts_modifier: updatedCardRows[0].card_guts_modifier, card_suit_intellect_modifier: updatedCardRows[0].card_intellect_modifier, card_suit_rally_modifier: updatedCardRows[0].card_rally_modifier,
                card_weapon_damage: updatedCardRows[0].card_weapon_damage, card_weapon_range: updatedCardRows[0].card_weapon_range, card_weapon_effect_slot1: updatedCardRows[0].card_weapon_effect_slot1, card_weapon_effect_slot2: updatedCardRows[0].card_weapon_effect_slot2, card_weapon_effect_slot3: updatedCardRows[0].card_weapon_effect_slot3,
                oldLocation: oldLocation // Send old location for frontend to remove from previous slot
            };

            // Step 4: Add log entry for played card
            await dbPool.query(
                'INSERT INTO combat_log (session_id, user_id, card_id, action_type, action_description) VALUES (?, ?, ?, ?, ?)',
                [sessionId, user_id, playedCardData.card_id, 'Card Played', `${userId} played card "${playedCardData.card_name}" from ${oldLocation} to DiscardPile`]
            );
            console.log(`[Socket Debug] Log entry for played card added.`);

            // Step 5: Broadcast the updated card data to all clients in the session
            io.to(sessionId).emit('server:cardPlayed', playedCardData);
            console.log(`[Socket Debug] Broadcasted played card for ${playedCardData.card_name}.`);

        } catch (err) {
            console.error(`[Socket Error] Error playing card ${playerCardId} in session ${sessionId}:`, err);
            socket.emit('error', 'Failed to play card. See server logs for details.');
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