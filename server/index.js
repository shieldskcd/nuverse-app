// server/index.js

// ... (previous code including dbPool, etc.)

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // ... (existing client:joinGame handler)

    // NEW: Handle client:createCard event
    socket.on('client:createCard', async ({ sessionId, userId, cardData }) => { // <--- ADD THIS HANDLER
        console.log(`[Socket Debug] client:createCard received for session ${sessionId}, user ${userId}. Card:`, cardData.card_name);

        try {
            // Step 1: Ensure the user exists in the 'users' table
            // For MVP, if user doesn't exist, create a dummy one
            let [users] = await dbPool.query('SELECT user_id FROM users WHERE username = ?', [userId]);
            let user_id;
            if (users.length === 0) {
                console.log(`[Socket Debug] User ${userId} not found, creating dummy user.`);
                const [insertResult] = await dbPool.query('INSERT INTO users (username) VALUES (?)', [userId]);
                user_id = insertResult.insertId;
            } else {
                user_id = users[0].user_id;
            }

            // Step 2: Insert the new card into the 'cards' table
            // This is a simplified insert using only common fields.
            // In a real app, you'd dynamically build the query based on card_type
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
                    // Hero Card fields (null for Ability cards)
                    cardData.card_hero_type || null, cardData.card_hero_class || null, cardData.card_hero_role || null,
                    // Ability Card fields (use values or null if not provided)
                    cardData.card_ability_class_melee || null, cardData.card_ability_class_longrange || null, cardData.card_ability_class_areaofeffect || null, cardData.card_ability_class_duration || null,
                    cardData.card_ability_is_burst || null, cardData.card_ability_burst_link_action || null, cardData.card_ability_burst_effect || null,
                    // Suit Card fields (null for Ability cards)
                    cardData.card_suit_might_modifier || null, cardData.card_suit_agility_modifier || null, cardData.card_suit_guts_modifier || null, cardData.card_suit_intellect_modifier || null, cardData.card_suit_rally_modifier || null,
                    // Weapon Card fields (null for Ability cards)
                    cardData.card_weapon_damage || null, cardData.card_weapon_range || null, cardData.card_weapon_effect_slot1 || null, cardData.card_weapon_effect_slot2 || null, cardData.card_weapon_effect_slot3 || null
                ]
            );
            const newCardId = cardInsertResult.insertId;
            console.log(`[Socket Debug] Card inserted into 'cards' table with ID: ${newCardId}`);

            // Step 3: Insert into 'player_cards' to link it to the session and user
            const [playerCardInsertResult] = await dbPool.query(
                'INSERT INTO player_cards (user_id, card_id, session_id, location, slot_id) VALUES (?, ?, ?, ?, ?)',
                [user_id, newCardId, sessionId, 'CreatedCardStorage', null] // Initially in 'CreatedCardStorage'
            );
            console.log(`[Socket Debug] Card linked to player_cards table with ID: ${playerCardInsertResult.insertId}`);

            // Step 4: Construct the full new card object to send back to clients
            const fullNewCard = {
                card_id: newCardId,
                ownerId: userId, // Add ownerId for frontend filtering
                location: 'CreatedCardStorage',
                slot_id: null,
                ...cardData // Include all original card data
            };
            
            // Step 5: Add entry to combat_log
            await dbPool.query(
                'INSERT INTO combat_log (session_id, user_id, card_id, action_type, action_description) VALUES (?, ?, ?, ?, ?)',
                [sessionId, user_id, newCardId, 'Card Created', `${userId} created card "${cardData.card_name}"`]
            );
            console.log(`[Socket Debug] Log entry for card creation added.`);

            // Step 6: Broadcast the new card to all clients in the session
            io.to(sessionId).emit('server:cardCreated', fullNewCard);
            console.log(`[Socket Debug] Broadcasted new card to session ${sessionId}`);

        } catch (err) {
            console.error(`[Socket Error] Error creating card for session ${sessionId}:`, err);
            socket.emit('error', 'Failed to create card. See server logs for details.');
        }
    });

    // ... (rest of your socket.on handlers and disconnect)
});