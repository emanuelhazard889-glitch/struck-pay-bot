const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const http = require('http'); // For Dummy Server

// 1. Basic Information
const TOKEN = process.env.BOT_TOKEN || '8992406767:AAGYEddJcQ3gZnfZjvNkaP7jx7spt8TFqfA';
const ADMIN_ID = 8319043148;
const MONGO_URL = process.env.MONGO_URL || 'mongodb+srv://Alpha:406976aaa@cluster0.sgcjmyi.mongodb.net/omega_bot?retryWrites=true&w=majority';
const PROOF_CHANNEL = '@proof_struck';

const bot = new TelegramBot(TOKEN, { polling: true });

// 2. MongoDB Schemas (Reset code ተወግዷል!)
mongoose.connect(MONGO_URL).then(async () => {
    console.log("Database Connected Successfully");
    await Config.updateOne({ key: "main" }, { refReward: 2 }, { upsert: true });
}).catch(err => console.log(err));

const User = mongoose.model('User', { 
    userId: Number, 
    balance: { type: Number, default: 0 }, 
    wallet: String, 
    refs: { type: Number, default: 0 }, 
    referrer: Number, 
    verified: { type: Boolean, default: false } 
});

const Channel = mongoose.model('Channel', { 
    channelId: String, 
    link: String 
});

const Config = mongoose.model('Config', { 
    key: String, 
    refReward: { type: Number, default: 2 }, 
    totalWithdrawn: { type: Number, default: 0 } 
});

// State Management
const userStates = {};
let botUsername = '';

// Bot Username በቅድሚያ ማምጣት
bot.getMe().then(me => {
    botUsername = me.username;
    console.log(`Bot username set to: @${botUsername}`);
});

// Configuration Initialization 
async function initConfig() {
    let conf = await Config.findOne({ key: "main" });
    if (!conf) await Config.create({ key: "main", refReward: 2, totalWithdrawn: 0 });
}
initConfig();

// --- 3. Start and Force Join Logic ---
bot.onText(/\/start(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const text = match[1] ? match[1].trim() : "";
    const firstName = msg.from.first_name || "User";
    
    let referrer = null;
    if (text && !isNaN(text) && Number(text) !== chatId) {
        referrer = Number(text);
    }

    let user = await User.findOne({ userId: chatId });
    if (!user) {
        user = await User.create({ userId: chatId, referrer: referrer });
    } else if (!user.verified && !user.referrer && referrer) {
        // ገና ሳይረጋገጥ በሪፈራል ሊንክ ከተመለሰ
        user.referrer = referrer;
        await user.save();
    }

    sendForceJoin(chatId, firstName);
});

async function sendForceJoin(chatId, firstName = "") {
    const channels = await Channel.find();
    let keyboard = [];
    let row = [];
    
    channels.forEach((ch, index) => {
        let url = ch.link.startsWith('http') ? ch.link : `https://t.me/${ch.link.replace('@', '')}`;
        row.push({ text: `𝐂𝐡𝐚𝐧𝐧𝐞𝐥 ${index + 1}`, url: url });
        if (row.length === 2) {
            keyboard.push(row);
            row = [];
        }
    });
    if (row.length > 0) keyboard.push(row);

    keyboard.push([{ text: "✅ Verify", callback_data: "verify" }]);

    const captionMsg = `Hello ${firstName}, Welcome to Struck Pay Bot!\n\nFirst, please join these channels:`;

    bot.sendPhoto(chatId, "5454.jpg", {
        caption: captionMsg,
        reply_markup: { inline_keyboard: keyboard }
    }).catch(err => console.log("Force join error: ", err));
}

function showMainMenu(chatId) {
    const opts = {
        reply_markup: {
            keyboard: [
                [{ text: "🟦 Balance" }, { text: "🟩 Withdraw" }],
                [{ text: "🟦 Wallet" }, { text: "🟩 Stats" }],
                [{ text: "🟥 Referral" }]
            ],
            resize_keyboard: true,
            is_persistent: true
        }
    };
    bot.sendMessage(chatId, "You have entered the main menu:", opts);
}

// --- 4. Callbacks (Inline Buttons for Verify and Admin) ---
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    const user = await User.findOne({ userId: chatId });
    const conf = await Config.findOne({ key: "main" });

    if (data === 'verify') {
        const channels = await Channel.find();
        let allJoined = true;
        
        for (let ch of channels) {
            try {
                let member = await bot.getChatMember(ch.channelId, chatId);
                if (member.status === 'left' || member.status === 'kicked') {
                    allJoined = false;
                    break;
                }
            } catch (e) {
                allJoined = false; 
            }
        }

        if (allJoined) {
            if (!user.verified) {
                user.verified = true;
                await user.save();
                
                if (user.referrer) {
                    let refUser = await User.findOne({ userId: user.referrer });
                    if (refUser) {
                        refUser.balance += conf.refReward;
                        refUser.refs += 1;
                        await refUser.save();
                        bot.sendMessage(user.referrer, `🎉 Someone joined via your link and verified! ${conf.refReward} Birr has been added to your balance.`);
                    }
                }
            }
            bot.deleteMessage(chatId, query.message.message_id).catch(()=>{});
            showMainMenu(chatId);
        } else {
            bot.answerCallbackQuery(query.id, { text: "You haven't joined all channels!", show_alert: true });
        }
        return;
    }

    // Admin Callbacks
    if (chatId !== ADMIN_ID) return;

    if (data === 'admin_broadcast') {
        userStates[chatId] = 'WAITING_BROADCAST';
        bot.sendMessage(chatId, "Enter the message to broadcast to all bot users:");
    }
    if (data === 'admin_add_channel') {
        userStates[chatId] = 'WAITING_CHANNEL_ID';
        bot.sendMessage(chatId, "Enter the channel username (e.g., @mychannel) or channel ID:");
    }
    if (data === 'admin_remove_channel') {
        const channels = await Channel.find();
        if (channels.length === 0) return bot.sendMessage(chatId, "No channels found in Force Join currently.");
        let keys = channels.map(ch => [{ text: `❌ Remove: ${ch.channelId}`, callback_data: `remch_${ch._id}` }]);
        bot.sendMessage(chatId, "Select the channel you want to remove from force join:", { reply_markup: { inline_keyboard: keys } });
    }
    if (data.startsWith('remch_')) {
        let chId = data.split('_')[1];
        await Channel.findByIdAndDelete(chId);
        bot.sendMessage(chatId, "Channel removed from force join!");
    }
    if (data === 'admin_ref_income') {
        userStates[chatId] = 'WAITING_REF_AMOUNT';
        bot.sendMessage(chatId, "Enter new referral reward amount:");
    }
    if (data === 'admin_channel_post') {
        userStates[chatId] = 'WAITING_CHANNEL_POST';
        bot.sendMessage(chatId, "Enter the message to send to the channels:");
    }
    if (data === 'admin_add_balance') {
        userStates[chatId] = 'WAITING_USER_ID_BALANCE';
        bot.sendMessage(chatId, "Enter the user's User ID:");
    }
});

// --- 5. Message Input Handler ---
bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;
    const chatId = msg.chat.id;
    const text = msg.text;
    const state = userStates[chatId];
    
    const user = await User.findOne({ userId: chatId });
    const conf = await Config.findOne({ key: "main" });

    const mainButtons = ["🟦 Balance", "🟩 Withdraw", "🟦 Wallet", "🟩 Stats", "🟥 Referral"];
    
    if (mainButtons.includes(text)) {
        
        const channels = await Channel.find();
        let leftChannels = [];
        
        for (let ch of channels) {
            try {
                let member = await bot.getChatMember(ch.channelId, chatId);
                if (member.status === 'left' || member.status === 'kicked') {
                    leftChannels.push(ch);
                }
            } catch (e) {
                leftChannels.push(ch);
            }
        }

        if (leftChannels.length > 0) {
            if (user && user.verified) {
                user.verified = false;
                await user.save();
            }

            let keyboard = [];
            let row = [];
            
            leftChannels.forEach((ch, index) => {
                let url = ch.link.startsWith('http') ? ch.link : `https://t.me/${ch.link.replace('@', '')}`;
                row.push({ text: `𝐂𝐡𝐚𝐧𝐧𝐞𝐥 ${index + 1}`, url: url });
                if (row.length === 2) {
                    keyboard.push(row);
                    row = [];
                }
            });
            if (row.length > 0) keyboard.push(row);
            keyboard.push([{ text: "✅ Verify", callback_data: "verify" }]);

            return bot.sendPhoto(chatId, "5454.jpg", {
                caption: "❌ To continue using the service, please rejoin the channels you left and verify!",
                reply_markup: { inline_keyboard: keyboard }
            });
        }

        if (!user || !user.verified) {
            return bot.sendMessage(chatId, "Please join the channels first and verify!");
        }

        if (text === "🟦 Balance") {
            const walletInfo = user.wallet ? `Telebirr Account: ${user.wallet}` : "Not registered yet";
            return bot.sendMessage(chatId, `Your Balance: ${user.balance} Birr\n${walletInfo}`);
        }

        if (text === "🟦 Wallet") {
            userStates[chatId] = 'WAITING_WALLET';
            return bot.sendMessage(chatId, "Please enter your telebirr account:");
        }

        if (text === "🟩 Withdraw") {
            if (!user.wallet) return bot.sendMessage(chatId, "Please enter your Wallet (telebirr) first. (Click Wallet)");
            if (user.balance < 50) return bot.sendMessage(chatId, "You cannot withdraw less than 50 Birr.");
            
            userStates[chatId] = 'WAITING_WITHDRAW';
            return bot.sendMessage(chatId, "Enter the amount of Birr you want to withdraw:");
        }

        if (text === "🟩 Stats") {
            const totalUsers = await User.countDocuments();
            return bot.sendPhoto(chatId, "12345.jpg", { 
                caption: `📊 Total Users: ${totalUsers}\n💸 Total Withdrawn: ${conf.totalWithdrawn} Birr` 
            });
        }

        if (text === "🟥 Referral") {
            if (!botUsername) {
                const me = await bot.getMe();
                botUsername = me.username;
            }
            const refLink = `https://t.me/${botUsername}?start=${chatId}`;
            return bot.sendPhoto(chatId, "12345.jpg", {
                caption: `Referral Link:\n${refLink}\n\nEarn ${conf.refReward} Birr for each referral (when they join channels and verify).\nTotal users joined via you: ${user.refs}`
            });
        }
    }

    if (state === 'WAITING_WALLET') {
        user.wallet = text;
        await user.save();
        bot.sendMessage(chatId, "Wallet saved successfully!");
        delete userStates[chatId];
    }
    else if (state === 'WAITING_WITHDRAW') {
        const amount = parseFloat(text);
        if (isNaN(amount) || amount <= 0) return bot.sendMessage(chatId, "Please enter a valid amount in numbers.");
        if (amount > user.balance || amount < 50) return bot.sendMessage(chatId, "Enter a valid amount (greater than or equal to 50)");
        
        user.balance -= amount;
        await user.save();
        conf.totalWithdrawn += amount;
        await conf.save();

        if (!botUsername) {
            const me = await bot.getMe();
            botUsername = me.username;
        }
        const refLink = `https://t.me/${botUsername}?start=${chatId}`;
        const caption = `ID: ${chatId}\n\nAccount or wallet: ${user.wallet}\n\nAmount: ${amount}\n\nName: Struck Pay Bot\n\nStatus: checking\n\nReferral link:\n${refLink}`;
        
        bot.sendPhoto(PROOF_CHANNEL, "12345.jpg", { caption: caption });
        bot.sendMessage(chatId, "Your withdrawal request has been sent to the proof channel. Payment will be deposited within 24 hours!");

        delete userStates[chatId];
    }
    
    if (chatId === ADMIN_ID) {
        if (state === 'WAITING_BROADCAST') {
            const users = await User.find();
            users.forEach(u => bot.sendMessage(u.userId, text).catch(()=>{}));
            bot.sendMessage(chatId, "Message sent to all users!");
            delete userStates[chatId];
        }
        else if (state === 'WAITING_USER_ID_BALANCE') {
            userStates[chatId] = `WAITING_AMOUNT_BALANCE_${text}`;
            bot.sendMessage(chatId, "Enter the amount of Birr:");
        }
        else if (state.startsWith('WAITING_AMOUNT_BALANCE_')) {
            const uId = state.split('_')[3];
            const amount = parseFloat(text);
            const targetUser = await User.findOne({ userId: uId });
            if (targetUser) {
                targetUser.balance += amount;
                await targetUser.save();
                bot.sendMessage(chatId, `Added ${amount} Birr to ${uId}.`);
                bot.sendMessage(uId, `🎉 Admin added ${amount} Birr to your balance!`);
            } else {
                bot.sendMessage(chatId, "User not found!");
            }
            delete userStates[chatId];
        }
        else if (state === 'WAITING_CHANNEL_ID') {
            userStates[chatId] = `WAITING_CHANNEL_LINK_${text}`;
            bot.sendMessage(chatId, "Enter the channel link:");
        }
        else if (state.startsWith('WAITING_CHANNEL_LINK_')) {
            const chId = state.replace('WAITING_CHANNEL_LINK_', '');
            await Channel.create({ channelId: chId, link: text });
            bot.sendMessage(chatId, "Channel saved successfully!");
            delete userStates[chatId];
        }
        else if (state === 'WAITING_REF_AMOUNT') {
            const amt = parseFloat(text);
            await Config.updateOne({ key: "main" }, { refReward: amt });
            bot.sendMessage(chatId, `Referral reward updated to ${amt}.`);
            delete userStates[chatId];
        }
        else if (state === 'WAITING_CHANNEL_POST') {
            const channels = await Channel.find();
            channels.forEach(ch => bot.sendMessage(ch.channelId, text).catch(()=>{}));
            bot.sendMessage(chatId, "Message sent to the channels!");
            delete userStates[chatId];
        }
    }
});

bot.onText(/\/admin/, (msg) => {
    if (msg.chat.id !== ADMIN_ID) return;
    const opts = {
        reply_markup: {
            inline_keyboard: [
                [{ text: "📣 Broadcast", callback_data: "admin_broadcast" }],
                [{ text: "➕ Add Channel", callback_data: "admin_add_channel" }, { text: "➖ Remove Channel", callback_data: "admin_remove_channel" }],
                [{ text: "💰 Add Balance", callback_data: "admin_add_balance" }],
                [{ text: "💵 Ref Income", callback_data: "admin_ref_income" }, { text: "📝 Channel Post", callback_data: "admin_channel_post" }]
            ]
        }
    };
    bot.sendMessage(ADMIN_ID, "Admin Panel", opts);
});

const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is successfully running and active!\n');
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Bot Dummy server is listening on port ${PORT}`);
});

console.log("Bot is running and successfully started...");
