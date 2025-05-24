const { Client, GatewayIntentBits, Partials, EmbedBuilder, PermissionsBitField } = require('discord.js');
const fs = require('fs'); // Corrected: removed quotes
const path = require('path');

// --- CONFIGURATION ---
const configFileArg = process.argv[2];
const CONFIG_PATH = configFileArg ? path.resolve(process.cwd(), configFileArg) : path.join(__dirname, 'config.json');
const DATA_PATH = path.join(__dirname, 'data.json');

let config;
try {
    console.log(`Loading configuration from: ${CONFIG_PATH}`);
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
} catch (error) {
    console.error(`Error loading configuration from ${CONFIG_PATH}:`, error);
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
});

// --- DATA HANDLING ---
let botData = {
    lastScanTimestamp: 0,
    lastVerificationScanTimestamp: 0,
    users: {}
};

function loadData() {
    try {
        if (fs.existsSync(DATA_PATH)) {
            const rawData = fs.readFileSync(DATA_PATH, 'utf8');
            botData = JSON.parse(rawData);
            if (!botData.users) botData.users = {};
            if (botData.lastVerificationScanTimestamp === undefined) botData.lastVerificationScanTimestamp = 0;
            if (botData.lastScanTimestamp === undefined) botData.lastScanTimestamp = 0;


            for (const userId in botData.users) {
                const user = botData.users[userId];
                if (user.joinTimestamp === undefined) user.joinTimestamp = null;
                if (user.isVerified === undefined) user.isVerified = false;
                if (user.verificationMessages === undefined) user.verificationMessages = user.messageCount || 0;
                if (user.lastMessageTimestamp === undefined) user.lastMessageTimestamp = null;
                if (user.messageCount === undefined) user.messageCount = 0;
                if (user.username === undefined) user.username = "UnknownUser";
            }
            console.log("User activity data loaded.");
        } else {
            console.log("No existing data file found. Starting fresh.");
            saveData();
        }
    } catch (error) {
        console.error("Error loading data.json:", error);
    }
}

function saveData() {
    try {
        fs.writeFileSync(DATA_PATH, JSON.stringify(botData, null, 2));
    } catch (error) {
        console.error("Error saving data.json:", error);
    }
}

// --- HELPER FUNCTIONS ---
function formatTimeAgo(timestamp) {
    if (!timestamp) return "Unknown";
    const now = Date.now();
    const seconds = Math.round((now - timestamp) / 1000);
    if (seconds < 5) return "Just now";
    if (seconds < 60) return `${seconds} secs ago`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min(s) ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} hour(s) ago`;
    const days = Math.round(hours / 24);
    return `${days} day(s) ago`;
}

async function isModerator(member) {
    if (!member) return false;
    if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
    const moderatorRole = member.guild.roles.cache.find(role => role.name === config.moderatorRoleName);
    return moderatorRole && member.roles.cache.has(moderatorRole.id);
}

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    const guild = client.guilds.cache.get(config.guildId);
    if (!guild) {
        console.error(`CRITICAL: Guild with ID ${config.guildId} not found. Bot will not function correctly.`);
    } else {
        console.log(`Operating in guild: ${guild.name} (ID: ${guild.id})`);
        client.newMemberRole = guild.roles.cache.find(role => role.name === config.newMemberRoleName);
        client.verifiedMemberRole = guild.roles.cache.find(role => role.name === config.verifiedMemberRoleName);
        if (!client.newMemberRole) console.warn(`New Member Role "${config.newMemberRoleName}" not found! Ensure it exists and the name is correct in config.`);
        if (!client.verifiedMemberRole) console.warn(`Verified Member Role "${config.verifiedMemberRoleName}" not found! Ensure it exists and the name is correct in config.`);
    }

    console.log(`Monitoring #${config.activityChannelName} for activity.`);
    console.log(`Announcement channel: #${config.announcementChannelName}`);
    console.log(`Verification poll channel: #${config.verificationPollChannelName}`);
    console.log(`Command prefix: ${config.prefix}`);

    loadData();

    const kickScanIntervalMs = config.scanIntervalDays * 24 * 60 * 60 * 1000;
    if (Date.now() - (botData.lastScanTimestamp || 0) >= kickScanIntervalMs && guild) {
        console.log("Kick pruning scan is overdue. Running now.");
        await performActivityScan().catch(console.error);
    }
    setInterval(async () => { if (client.guilds.cache.get(config.guildId)) await performActivityScan().catch(console.error); }, kickScanIntervalMs);

    const verificationScanIntervalMs = (config.verificationPollDays / 2) * 24 * 60 * 60 * 1000;
    if (Date.now() - (botData.lastVerificationScanTimestamp || 0) >= verificationScanIntervalMs && guild) {
        console.log("New member verification scan is overdue. Running now.");
        await performVerificationScan().catch(console.error);
    }
    setInterval(async () => { if (client.guilds.cache.get(config.guildId)) await performVerificationScan().catch(console.error); }, verificationScanIntervalMs);

    console.log("Bot ready and scans scheduled.");
});

client.on('guildMemberAdd', async member => {
    if (member.guild.id !== config.guildId) return;
    if (member.user.bot) return;

    console.log(`New member joined: ${member.user.tag} (ID: ${member.id})`);
    const newMemberRole = client.newMemberRole || member.guild.roles.cache.find(role => role.name === config.newMemberRoleName);
    if (!newMemberRole) {
        console.error(`Error: Role "${config.newMemberRoleName}" not found on server for new member.`);
        return;
    }

    try {
        await member.roles.add(newMemberRole);
        console.log(`Assigned "${config.newMemberRoleName}" to ${member.user.tag}.`);

        botData.users[member.id] = {
            username: member.user.username,
            messageCount: 0,
            lastMessageTimestamp: null,
            joinTimestamp: Date.now(),
            isVerified: false,
            verificationMessages: 0
        };
        saveData();

        const activityChannel = member.guild.channels.cache.find(ch => ch.name === config.activityChannelName && ch.isTextBased());
        if (activityChannel) {
            activityChannel.send(`Welcome <@${member.id}>! Please be active in this channel to gain full server access. You need ${config.verificationMessageThreshold} messages and to be here for ${config.verificationPollDays} days for a verification poll.`).catch(console.error);
        }
    } catch (error) {
        console.error(`Failed to assign role or save data for new member ${member.user.tag}:`, error);
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild || message.guild.id !== config.guildId) return;

    let activityChannel;
    if (!client.activityChannel) {
        client.activityChannel = message.guild.channels.cache.find(ch => ch.name === config.activityChannelName && ch.isTextBased());
    }
    activityChannel = client.activityChannel;

    if (activityChannel && message.channel.id === activityChannel.id) {
        const userId = message.author.id;
        if (!botData.users[userId]) {
            const member = await message.guild.members.fetch(userId).catch(() => null);
            const verifiedRole = client.verifiedMemberRole || message.guild.roles.cache.find(role => role.name === config.verifiedMemberRoleName);
            botData.users[userId] = {
                username: message.author.username,
                messageCount: 0,
                lastMessageTimestamp: null,
                joinTimestamp: member ? member.joinedTimestamp : Date.now(),
                isVerified: member && verifiedRole ? member.roles.cache.has(verifiedRole.id) : false,
                verificationMessages: 0
            };
        }
        botData.users[userId].messageCount = (botData.users[userId].messageCount || 0) + 1;
        botData.users[userId].username = message.author.username;
        botData.users[userId].lastMessageTimestamp = Date.now();

        if (!botData.users[userId].isVerified) {
            botData.users[userId].verificationMessages = (botData.users[userId].verificationMessages || 0) + 1;
        }
        saveData();
    }

    if (!message.content.startsWith(config.prefix)) return;

    const args = message.content.slice(config.prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const memberIsModerator = await isModerator(message.member);

    if (command === "activity") {
        try {
            await message.channel.sendTyping();
            const guild = message.guild;
            let currentActivityChannelName = config.activityChannelName;
            if (client.activityChannel) currentActivityChannelName = client.activityChannel.name;

            await guild.members.fetch();
            const members = guild.members.cache.filter(m => !m.user.bot).sort((a, b) => a.displayName.localeCompare(b.displayName));
            if (members.size === 0) return message.channel.send("No non-bot members found.").catch(console.error);

            const userActivityInfo = [];
            for (const member of members.values()) {
                const userData = botData.users[member.id];
                const timeAgo = formatTimeAgo(userData?.lastMessageTimestamp);
                const verifiedStatus = userData?.isVerified ? " (Verified)" : (client.newMemberRole && member.roles.cache.has(client.newMemberRole.id) ? " (New Member)" : "");
                userActivityInfo.push({
                    name: `${member.displayName}${verifiedStatus}`,
                    value: `Activity Channel (#${currentActivityChannelName}): ${timeAgo}\nVerification Msgs: ${userData?.verificationMessages || 0}`,
                });
            }

            const embeds = []; const usersPerEmbed = 10;
            for (let i = 0; i < userActivityInfo.length; i += usersPerEmbed) {
                const chunk = userActivityInfo.slice(i, i + usersPerEmbed);
                const embed = new EmbedBuilder().setColor(0x00AAFF).setTitle(`User Activity Report (Page ${Math.floor(i / usersPerEmbed) + 1})`)
                    .setDescription(`Activity in **#${currentActivityChannelName}**.`).setTimestamp();
                chunk.forEach(ui => embed.addFields({ name: ui.name, value: ui.value, inline: false }));
                embeds.push(embed);
            }
            for (const embed of embeds) { await message.channel.send({ embeds: [embed] }).catch(console.error); }

        } catch (error) { console.error("Error in !activity:", error); message.reply("Error fetching activity.").catch(console.error); }
    } else if (command === "allow") {
        if (!memberIsModerator) return message.reply("You don't have permission.").catch(console.error);
        if (!client.verifiedMemberRole || !client.newMemberRole) return message.reply("Role(s) not configured/found.").catch(console.error);

        const daysArg = parseInt(args[0]);
        const messagesArg = parseInt(args[1]);
        let verifiedCount = 0;
        const announcementChannel = message.guild.channels.cache.find(ch => ch.name === config.announcementChannelName);
        await message.guild.members.fetch();
        let membersToVerify = [];

        if (args.length === 0) {
            membersToVerify = message.guild.members.cache.filter(m =>
                !m.user.bot && botData.users[m.id] && !botData.users[m.id].isVerified && m.roles.cache.has(client.newMemberRole.id)
            ).map(m => m);
        } else if (!isNaN(daysArg) && !isNaN(messagesArg) && daysArg >= 0 && messagesArg >= 0) {
            const requiredJoinTime = Date.now() - (daysArg * 24 * 60 * 60 * 1000);
            membersToVerify = message.guild.members.cache.filter(m =>
                !m.user.bot && botData.users[m.id] && !botData.users[m.id].isVerified &&
                m.roles.cache.has(client.newMemberRole.id) &&
                (botData.users[m.id].joinTimestamp && botData.users[m.id].joinTimestamp <= requiredJoinTime) &&
                (botData.users[m.id].verificationMessages || 0) >= messagesArg
            ).map(m => m);
        } else {
            return message.reply("Usage: `!allow` or `!allow <days> <messages>`").catch(console.error);
        }

        if (membersToVerify.length === 0) return message.reply("No members found matching criteria.").catch(console.error);
        await message.reply(`Attempting to verify ${membersToVerify.length} member(s)...`).catch(console.error);

        for (const member of membersToVerify) {
            if (await isModerator(member)) continue;
            try {
                await member.roles.add(client.verifiedMemberRole);
                await member.roles.remove(client.newMemberRole);
                botData.users[member.id].isVerified = true;
                verifiedCount++;
                if (announcementChannel) announcementChannel.send(`✅ ${member.user.tag} was manually verified by ${message.author.tag}.`).catch(console.error);
            } catch (err) { console.error(`Failed to verify ${member.user.tag} via !allow:`, err); }
        }
        saveData();
        message.channel.send(`Successfully verified ${verifiedCount} member(s).`).catch(console.error);

    } else if (command === "deny") {
        if (!memberIsModerator) return message.reply("You don't have permission.").catch(console.error);
        if (!client.newMemberRole) return message.reply("New Member role not found.").catch(console.error);

        const daysArg = parseInt(args[0]); const messagesArg = parseInt(args[1]);
        if (isNaN(daysArg) || isNaN(messagesArg) || daysArg < 0 || messagesArg < 0) {
            return message.reply("Usage: `!deny <days_on_server> <max_messages>`").catch(console.error);
        }

        const requiredJoinTime = Date.now() - (daysArg * 24 * 60 * 60 * 1000);
        let kickedCount = 0;
        const announcementChannel = message.guild.channels.cache.find(ch => ch.name === config.announcementChannelName);
        await message.guild.members.fetch();

        const membersToConsider = message.guild.members.cache.filter(m =>
            !m.user.bot && botData.users[m.id] && !botData.users[m.id].isVerified &&
            m.roles.cache.has(client.newMemberRole.id) &&
            (botData.users[m.id].joinTimestamp && botData.users[m.id].joinTimestamp <= requiredJoinTime) &&
            (botData.users[m.id].verificationMessages || 0) <= messagesArg
        ).map(m => m);

        if (membersToConsider.length === 0) return message.reply("No members found matching criteria.").catch(console.error);
        await message.reply(`Found ${membersToConsider.length} members. Kicking...`).catch(console.error);

        for (const member of membersToConsider) {
            if (await isModerator(member)) continue;
            try {
                await member.kick(`Denied by ${message.author.tag}: ${daysArg}d, <=${messagesArg}m.`);
                kickedCount++;
                if (announcementChannel) announcementChannel.send(`👢 ${member.user.tag} kicked by ${message.author.tag} (denied).`).catch(console.error);
                delete botData.users[member.id];
            } catch (err) { console.error(`Failed to kick ${member.user.tag} via !deny:`, err); }
        }
        saveData();
        message.channel.send(`Successfully kicked ${kickedCount} member(s).`).catch(console.error);

    } else if (command === "kickpollinactive") {
        if (!memberIsModerator) return message.reply("You don't have permission.").catch(console.error);
        const daysSilentArg = parseInt(args[0]);
        const silentThreshold = daysSilentArg || config.kickPollSilentDaysThreshold;
        if (isNaN(silentThreshold) || silentThreshold <= 0) {
            return message.reply(`Usage: \`!kickpollinactive [days]\` (default: ${config.kickPollSilentDaysThreshold}d).`).catch(console.error);
        }

        const guild = message.guild;
        const announcementChannel = guild.channels.cache.find(ch => ch.name === config.announcementChannelName);
        if (!announcementChannel) return message.reply("Announcement channel not found.").catch(console.error);

        const silentTimeMs = Date.now() - (silentThreshold * 24 * 60 * 60 * 1000);
        let pollCount = 0;
        await guild.members.fetch();
        const membersToPoll = [];

        for (const member of guild.members.cache.values()) {
            if (member.user.bot || await isModerator(member)) continue;
            const userData = botData.users[member.id];
            if (userData && ((userData.lastMessageTimestamp && userData.lastMessageTimestamp < silentTimeMs) ||
                (!userData.lastMessageTimestamp && userData.joinTimestamp && userData.joinTimestamp < silentTimeMs))) {
                membersToPoll.push(member);
            }
        }

        if (membersToPoll.length === 0) return message.reply(`No members inactive for >${silentThreshold} days.`).catch(console.error);
        await message.reply(`Found ${membersToPoll.length} inactive members. Starting polls...`).catch(console.error);
        for (const member of membersToPoll) {
            await createKickPoll(guild, announcementChannel, member.id, member.user.username, `Silent for >${silentThreshold} days in #${config.activityChannelName}`);
            pollCount++;
        }
        message.channel.send(`Initiated ${pollCount} kick polls. Check ${announcementChannel}.`).catch(console.error);

    } else if (command === "roles") {
        if (!memberIsModerator) return message.reply("You don't have permission.").catch(console.error);
        await message.channel.sendTyping();
        const guild = message.guild;
        await guild.members.fetch();
        const membersWithRoles = guild.members.cache.filter(m => !m.user.bot)
            .map(member => ({
                name: member.displayName,
                value: member.roles.cache.filter(role => role.id !== guild.id).map(role => role.name).join(', ') || "No specific roles"
            })).sort((a, b) => a.name.localeCompare(b.name));

        if (membersWithRoles.length === 0) return message.reply("No non-bot members found.").catch(console.error);
        const embeds = []; const usersPerEmbed = 15;
        for (let i = 0; i < membersWithRoles.length; i += usersPerEmbed) {
            const chunk = membersWithRoles.slice(i, i + usersPerEmbed);
            const embed = new EmbedBuilder().setColor(0x00FFFF).setTitle(`Member Roles (Page ${Math.floor(i / usersPerEmbed) + 1})`);
            chunk.forEach(item => embed.addFields({ name: item.name, value: item.value, inline: false }));
            embeds.push(embed);
        }
        for (const embed of embeds) { await message.channel.send({ embeds: [embed] }).catch(console.error); }
    }     else if (command === "commands" || command === "help") {
        const embed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle("📜 Bot Commands List")
            .setDescription("Here are all the available commands:")
            .setTimestamp();

        // Public Commands
        embed.addFields({ name: "📢 Public Commands", value: "\u200B" }); // \u200B is a zero-width space for spacing
        embed.addFields(
            {
                name: `\`${config.prefix}activity\``,
                value: "Shows a report of user activity in the monitored channel, including last message time and verification status.\n**Usage:** `!activity`",
                inline: false
            }
        );

        // Moderator Only Commands
        embed.addFields({ name: "\u200B", value: "\u200B" }); // Spacer
        embed.addFields({ name: "🛠️ Moderator Commands", value: "*(Requires Moderator role or Administrator permission)*" });
        embed.addFields(
            {
                name: `\`${config.prefix}allow [days messages]\``,
                value: "Manually verifies members. \n- With `[days messages]`: Verifies unverified 'New Members' who joined at least `[days]` ago and have sent at least `[messages]` in the activity channel.\n- Without arguments: Verifies ALL unverified 'New Members'.\n**Usage:** `!allow` OR `!allow 7 20`",
                inline: false
            },
            {
                name: `\`${config.prefix}deny <days> <messages>\``,
                value: "Kicks unverified 'New Members' who joined at least `<days>` ago and have sent `<= <messages>` in the activity channel.\n**Usage:** `!deny 14 5`",
                inline: false
            },
            {
                name: `\`${config.prefix}kickpollinactive [days_silent]\``,
                value: `Initiates kick polls for members (excluding moderators) who have been silent in the activity channel for \`[days_silent]\`. If \`[days_silent]\` is omitted, uses the value from \`config.kickPollSilentDaysThreshold\` (currently ${config.kickPollSilentDaysThreshold} days).\n**Usage:** \`!kickpollinactive\` OR \`!kickpollinactive 30\``,
                inline: false
            },
            {
                name: `\`${config.prefix}roles\``,
                value: "Displays a list of all server members and their assigned roles.\n**Usage:** `!roles`",
                inline: false
            },
            {
                name: `\`${config.prefix}commands\` or \`${config.prefix}help\``,
                value: "Shows this help message.\n**Usage:** `!commands`",
                inline: false
            }
        );

        try {
            await message.channel.send({ embeds: [embed] });
        } catch (error) {
            console.error("Failed to send help embed:", error);
            message.reply("Sorry, I couldn't display the commands right now.").catch(console.error);
        }
    }
});

async function performActivityScan() {
    console.log("Starting activity scan (for kick pruning)...");
    const guild = client.guilds.cache.get(config.guildId);
    if (!guild) return console.error("Guild not found for activity scan.");
    const announcementChannel = guild.channels.cache.find(ch => ch.name === config.announcementChannelName);
    if (!announcementChannel) return console.error("Announcement channel not found for activity scan.");

    await announcementChannel.send(`📢 **Pruning Activity Scan Started!** Checking message counts for all non-moderator members.`).catch(console.error);
    const inactiveUserIds = []; const activeUserIds = [];

    for (const userId in botData.users) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) { delete botData.users[userId]; continue; }
        if (await isModerator(member)) continue;

        if ((botData.users[userId].messageCount || 0) <= config.messageThreshold) {
            inactiveUserIds.push(userId);
        } else {
            activeUserIds.push(userId);
        }
    }

    if (inactiveUserIds.length === 0) {
        await announcementChannel.send("✅ All non-moderator users meet pruning activity criteria!").catch(console.error);
    } else {
        await announcementChannel.send(`🔍 Found ${inactiveUserIds.length} user(s) with low activity for pruning. Initiating polls...`).catch(console.error);
        for (const userId of inactiveUserIds) {
            await createKickPoll(guild, announcementChannel, userId, botData.users[userId].username, `Low message count: ${botData.users[userId].messageCount || 0}`);
        }
    }
    if (activeUserIds.length > 0) { /* Announce active users logic */ }

    console.log("Resetting message counts (for pruning)...");
    for (const userId in botData.users) { if (botData.users[userId]) botData.users[userId].messageCount = 0; }
    botData.lastScanTimestamp = Date.now(); saveData();
    console.log("Pruning activity scan completed.");
    await announcementChannel.send(`🏁 Pruning scan completed. Message counts reset.`).catch(console.error);
}

async function performVerificationScan() {
    console.log("Starting new member verification scan...");
    const guild = client.guilds.cache.get(config.guildId);
    if (!guild) return console.error("Guild not found for verification scan.");
    const verificationPollChannel = guild.channels.cache.find(ch => ch.name === config.verificationPollChannelName);
    if (!verificationPollChannel) return console.error("Verification poll channel not found.");

    await verificationPollChannel.send(`📢 **New Member Verification Scan Started!**`).catch(console.error);
    const eligibleForVerificationPoll = [];
    const verificationPeriodMs = config.verificationPollDays * 24 * 60 * 60 * 1000;

    for (const userId in botData.users) {
        const user = botData.users[userId];
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member || user.isVerified || await isModerator(member) || !user.joinTimestamp) continue;
        if ((Date.now() - user.joinTimestamp >= verificationPeriodMs) && (user.verificationMessages || 0) >= config.verificationMessageThreshold) {
            eligibleForVerificationPoll.push(userId);
        }
    }

    if (eligibleForVerificationPoll.length === 0) {
        await verificationPollChannel.send("✅ No new members currently eligible for a verification poll.").catch(console.error);
    } else {
        await verificationPollChannel.send(`🔍 Found ${eligibleForVerificationPoll.length} unverified member(s) eligible. Initiating polls...`).catch(console.error);
        for (const userId of eligibleForVerificationPoll) {
            await createVerificationPoll(guild, verificationPollChannel, userId, botData.users[userId].username);
        }
    }
    botData.lastVerificationScanTimestamp = Date.now(); saveData();
    console.log("New member verification scan completed.");
}

async function createKickPoll(guild, channel, userId, username, reason = `Low activity`) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) { delete botData.users[userId]; saveData(); return; }
    if (await isModerator(member) || member.id === client.user.id || member.id === guild.ownerId) return;
    if (guild.members.me && member.roles.highest.position >= guild.members.me.roles.highest.position) {
        await channel.send(`⚠️ Cannot create kick poll for ${member.user.tag} (higher/equal role).`).catch(console.error); return;
    }

    const pollEmbed = new EmbedBuilder().setColor(0xFF0000).setTitle(`Kick Poll: ${username}`)
        .setDescription(`User ${member.user.tag}. Reason: **${reason}** (e.g., messages: ${botData.users[userId]?.messageCount || 'N/A'}).\n\nShould they be kicked?`)
        .addFields({ name: 'React to Vote', value: '✅ = Yes, Kick\n❌ = No, Keep' })
        .setFooter({ text: `Poll ends in ${config.pollDurationHours} hours.` }).setTimestamp();
    try {
        const pollMessage = await channel.send({ embeds: [pollEmbed] });
        await pollMessage.react('✅'); await pollMessage.react('❌');
        const collector = pollMessage.createReactionCollector({
            filter: (reaction, user) => ['✅', '❌'].includes(reaction.emoji.name) && !user.bot,
            time: config.pollDurationHours * 60 * 60 * 1000
        });
        collector.on('end', async collected => {
            const yesVotes = collected.get('✅')?.count || 0; const noVotes = collected.get('❌')?.count || 0;
            let resultMessage = `Kick poll for ${member.user.tag} (Reason: ${reason}) ended.\n✅ Yes: ${yesVotes}, ❌ No: ${noVotes}\n\n`;
            const currentMember = await guild.members.fetch(userId).catch(() => null);
            if (!currentMember) { resultMessage += `${member.user.tag} left.`; await channel.send(resultMessage).catch(console.error); delete botData.users[userId]; saveData(); return; }
            const totalVotes = yesVotes + noVotes;
            if (totalVotes === 0) { resultMessage += "No votes. No action."; }
            else if (yesVotes / totalVotes >= config.pollPassThreshold && yesVotes > noVotes) {
                resultMessage += `**Poll passed!** Kicking ${member.user.tag}.`;
                try {
                    await member.kick(`Kicked via poll. Reason: ${reason}. Votes ${yesVotes}Y/${noVotes}N.`);
                    resultMessage += `\n✅ ${member.user.tag} kicked.`; delete botData.users[userId]; saveData();
                } catch (kickError) { resultMessage += `\n⚠️ Failed to kick: ${kickError.message}`; }
            } else { resultMessage += `**Poll failed.** ${member.user.tag} not kicked.`; }
            await channel.send(resultMessage).catch(console.error);
        });
    } catch (error) { console.error(`Error creating kick poll for ${username}:`, error); }
}

async function createVerificationPoll(guild, channel, userId, username) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return;
    if (await isModerator(member) || botData.users[userId]?.isVerified) return;

    const userData = botData.users[userId];
    const pollEmbed = new EmbedBuilder().setColor(0x00FF00).setTitle(`Verification Poll: ${username}`)
        .setDescription(`User ${member.user.tag} joined ${formatTimeAgo(userData?.joinTimestamp)} and has **${userData?.verificationMessages || 0}** messages in #${config.activityChannelName} (threshold: ${config.verificationMessageThreshold}).\n\nGrant full access?`)
        .addFields({ name: 'React to Vote', value: `✅ = Yes, Grant Access\n❌ = No, Keep Restricted` })
        .setFooter({ text: `Poll ends in ${config.verificationPollDurationHours} hours.` }).setTimestamp();
    try {
        const pollMessage = await channel.send({ embeds: [pollEmbed] });
        await pollMessage.react('✅'); await pollMessage.react('❌');
        const collector = pollMessage.createReactionCollector({
            filter: (reaction, user) => ['✅', '❌'].includes(reaction.emoji.name) && !user.bot,
            time: config.verificationPollDurationHours * 60 * 60 * 1000
        });
        collector.on('end', async collected => {
            const yesVotes = collected.get('✅')?.count || 0; const noVotes = collected.get('❌')?.count || 0;
            let resultMessage = `Verification poll for ${member.user.tag} ended.\n✅ Yes: ${yesVotes}, ❌ No: ${noVotes}\n\n`;
            const currentMember = await guild.members.fetch(userId).catch(() => null);
            if (!currentMember) { resultMessage += `${member.user.tag} left.`; await channel.send(resultMessage).catch(console.error); return; }
            const totalVotes = yesVotes + noVotes;
            if (totalVotes === 0) { resultMessage += "No votes. No action."; }
            else if (yesVotes / totalVotes >= config.verificationPollPassThreshold && yesVotes > noVotes) {
                if (client.verifiedMemberRole) await currentMember.roles.add(client.verifiedMemberRole).catch(e => console.error("Error adding verified role:", e));
                if (client.newMemberRole) await currentMember.roles.remove(client.newMemberRole).catch(e => console.error("Error removing new member role:", e));
                botData.users[userId].isVerified = true; saveData();
                resultMessage += `**Poll passed!** ${member.user.tag} verified.`;
            } else { resultMessage += `**Poll failed.** ${member.user.tag} not verified.`; }
            await channel.send(resultMessage).catch(console.error);
        });
    } catch (error) { console.error(`Error creating verification poll for ${username}:`, error); }
}

if (!config.token || config.token === "YOUR_DISCORD_BOT_TOKEN" || !config.guildId || config.guildId === "YOUR_SERVER_ID_HERE") {
    console.error("CRITICAL: Bot token or guildId is not configured properly in " + CONFIG_PATH);
    process.exit(1);
}
client.login(config.token);
