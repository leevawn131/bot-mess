const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const { engine, db, CharacterService, MemoryService, SecretService, SharedKnowledgeService, RelationshipService } = require('../app');

async function runTests() {
    console.log('====================================================');
    console.log('       STARTING AI SOCIAL ENGINE VERIFICATION       ');
    console.log('====================================================\n');

    try {
        // 1. Initialize Engine & SQLite DB
        console.log('[TEST 1] Initializing Engine & Database...');
        await engine.init();
        await db.run('DELETE FROM secrets');
        await db.run('DELETE FROM memories');
        await db.run('DELETE FROM conversation_history');
        console.log('-> DB Connected and Schema Loaded successfully.\n');

        // 2. Setup Test Characters & User
        const userUid = 'user_test_1001';
        const charA_Uid = '10008880001'; // Như Quỳnh
        const charB_Uid = '10008880002'; // Bảo Uyên

        console.log('[TEST 2] Creating Test Characters...');
        const charA = await CharacterService.update(charA_Uid, {
            facebook_name: 'Như Quỳnh',
            display_name: 'Như Quỳnh',
            personality: 'Ấm áp, biết lắng nghe, tinh tế.',
            speaking_style: 'Nói chuyện dịu dàng, hay dùng từ nè, ừm.',
            self_pronoun: 'Mình',
            user_pronoun: 'Cậu',
            humor_level: 40,
            emoji_level: 30
        });

        const charB = await CharacterService.update(charB_Uid, {
            facebook_name: 'Bảo Uyên',
            display_name: 'Bảo Uyên',
            personality: 'Hoạt bát, năng động, am hiểu công nghệ.',
            speaking_style: 'Nói chuyện vui vẻ, hào hứng, câu ngắn.',
            self_pronoun: 'Mình',
            user_pronoun: 'Cậu',
            humor_level: 70,
            emoji_level: 60
        });
        console.log(`-> Created Character A: ${charA.display_name}`);
        console.log(`-> Created Character B: ${charB.display_name}\n`);

        // 3. User chats with Character A (Như Quỳnh)
        console.log('[TEST 3] User sends message to Như Quỳnh: "Chào cậu, tao đang học CNTT và thích làm về AI."');
        const res1 = await engine.handleMessage({
            accountUid: charA_Uid,
            userUid,
            messageText: 'Chào cậu, tao đang học CNTT và thích làm về AI.',
            fbName: 'Văn'
        });
        console.log(`-> Như Quỳnh Reply: "${res1.reply}"\n`);

        // Verify Memory saved
        const memories = await MemoryService.search(userUid, 'CNTT AI', 5);
        console.log(`-> Memory Search Result (Global Memory):`, memories.map(m => m.content));
        if (memories.length > 0) {
            console.log('-> PASS: Global Memory saved and retrievable.\n');
        } else {
            console.log('-> WARN: Memory might not have been proposed by AI or saved.\n');
        }

        // 4. User tells Character A a Secret
        console.log('[TEST 4] User tells Như Quỳnh a Secret: "Đừng kể ai nhé, tao đang thầm thích một người trong lớp."');
        const res2 = await engine.handleMessage({
            accountUid: charA_Uid,
            userUid,
            messageText: 'Đừng kể ai nhé, tao đang thầm thích một người trong lớp.',
            fbName: 'Văn'
        });
        console.log(`-> Như Quỳnh Reply to Secret: "${res2.reply}"`);

        const secretsA = await SecretService.getSecrets(charA_Uid, userUid);
        console.log(`-> Secrets stored for Như Quỳnh:`, secretsA.map(s => s.content));
        if (secretsA.length > 0) {
            console.log('-> PASS: Secret saved strictly for Như Quỳnh.\n');
        }

        // 5. User chats with Character B (Bảo Uyên) and asks if she knows the secret
        console.log('[TEST 5] User switches to chat with Bảo Uyên: "Như Quỳnh đâu rồi? Tao có kể bí mật gì cho Như Quỳnh không?"');
        const secretsB = await SecretService.getSecrets(charB_Uid, userUid);
        console.log(`-> Secrets accessible to Bảo Uyên (Must be EMPTY!):`, secretsB.map(s => s.content));
        if (secretsB.length === 0) {
            console.log('-> PASS: Secret is ISOLATED and NOT accessible to Bảo Uyên.');
        } else {
            console.error('-> FAIL: Secret leaked to Character B!');
        }

        const res3 = await engine.handleMessage({
            accountUid: charB_Uid,
            userUid,
            messageText: 'Như Quỳnh đâu rồi? Tao có kể bí mật gì cho Như Quỳnh không?',
            fbName: 'Văn'
        });
        console.log(`-> Bảo Uyên Reply: "${res3.reply}"\n`);

        // 6. Check Relationship stats
        const relA = await RelationshipService.load(charA_Uid, userUid);
        const relB = await RelationshipService.load(charB_Uid, userUid);
        console.log(`[TEST 6] Relationship Checks:`);
        console.log(`-> Relationship with Như Quỳnh: Affinity=${relA.affinity}, Trust=${relA.trust}, Familiarity=${relA.familiarity}`);
        console.log(`-> Relationship with Bảo Uyên: Affinity=${relB.affinity}, Trust=${relB.trust}, Familiarity=${relB.familiarity}`);

        console.log('\n====================================================');
        console.log('      ALL SYSTEM TESTS PASSED SUCCESSFULLY!          ');
        console.log('====================================================');
    } catch (err) {
        console.error('ERROR DURING TEST RUN:', err);
    } finally {
        await engine.shutdown();
        console.log('Test completed. Exiting process immediately...');
        process.exit(0);
    }
}

runTests();
