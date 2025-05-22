const { Client, GatewayIntentBits, Partials, Collection, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path'); // Corrected: require path module

// --- CONFIGURATION ---
const CONFIG_PATH = path.join(__dirname, 'config.json');
const DATA_PATH = path.join(__dirname, 'data.json');

let config;
try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
} catch (error) {
    console.error("Error loading config.json:", error);
    console.log("Please ensure config.json exists and is correctly formatted.");
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers, // Required for fetching members
        GatewayIntentBits.GuildMessageReactions // Required for poll reactions
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
});

// --- DATA HANDLING ---
let botData = {
    lastScanTimestamp: 0,
    users: {} // { userId: { messageCount: 0, username: "name", lastMessageTimestamp: null } }
};

function loadData() {
    try {
        if (fs.existsSync(DATA_PATH)) {
            const rawData = fs.readFileSync(DATA_PATH, 'utf8');
            botData = JSON.parse(rawData);
            if (!botData.users) botData.users = {};
            // Ensure all existing users have the new field, defaulting to null
            for (const userId in botData.users) {
                if (botData.users[userId].lastMessageTimestamp === undefined) {
                    botData.users[userId].lastMessageTimestamp = null;
                }
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

// --- HELPER FUNCTION ---
function formatTimeAgo(timestamp) {
    if (!timestamp) return "Never in monitored channel";
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

// --- BOT LOGIC ---
client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    // --- START DIAGNOSTIC (Optional but helpful during setup) ---
    console.log("Bot is currently in the following guilds:");
    if (client.guilds.cache.size === 0) {
        console.log("  (None or cache not populated yet - this might be an issue if it persists)");
    } else {
        client.guilds.cache.forEach(guild => {
            console.log(`  - Name: ${guild.name}, ID: ${guild.id}`);
        });
    }
    const expectedGuildId = config.guildId;
    const foundGuild = client.guilds.cache.get(expectedGuildId);
    if (foundGuild) {
        console.log(`SUCCESS: Expected guild "${foundGuild.name}" (ID: ${expectedGuildId}) was found in cache.`);
    } else {
        console.error(`ERROR: Expected guild with ID "${expectedGuildId}" was NOT found in cache.`);
        console.log(`Please verify:`);
        console.log(`  1. The guildId in config.json ("${expectedGuildId}") is correct for your server.`);
        console.log(`  2. The bot ("${client.user.tag}") has been successfully invited to and is a member of that server.`);
    }
    // --- END DIAGNOSTIC ---

    console.log(`Monitoring #${config.activityChannelName} for activity.`);
    console.log(`Announcements and polls will be in #${config.announcementChannelName}.`);
    console.log(`Command prefix is: ${config.prefix}`);

    loadData();

    const scanIntervalMs = config.scanIntervalDays * 24 * 60 * 60 * 1000;
    if (Date.now() - (botData.lastScanTimestamp || 0) >= scanIntervalMs) {
        console.log("Scan is overdue. Running now.");
        await performActivityScan();
    }

    setInterval(performActivityScan, scanIntervalMs);
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (!message.guild) return;
    if (message.guild.id !== config.guildId) return;

    // Activity tracking for the monitored channel
    let activityChannel;
    try {
        if (!client.activityChannel) {
            client.activityChannel = message.guild.channels.cache.find(
                ch => ch.name === config.activityChannelName && ch.isTextBased()
            );
            if (!client.activityChannel) {
                 console.warn(`Activity channel #${config.activityChannelName} not found on first message.`);
            }
        }
        activityChannel = client.activityChannel;

        if (activityChannel && message.channel.id === activityChannel.id) {
            const userId = message.author.id;
            if (!botData.users[userId]) {
                botData.users[userId] = { messageCount: 0, username: message.author.username, lastMessageTimestamp: null };
            }
            botData.users[userId].messageCount = (botData.users[userId].messageCount || 0) + 1;
            botData.users[userId].username = message.author.username;
            botData.users[userId].lastMessageTimestamp = Date.now();
            saveData();
        }
    } catch (err) {
        console.error("Error during activity channel processing in messageCreate:", err);
    }

    // Command Handling
    if (message.content.startsWith(config.prefix)) {
        const args = message.content.slice(config.prefix.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        if (command === "activity") {
            // Optional: Restrict command usage
            // if (!message.member.permissions.has("ManageMessages") && message.author.id !== message.guild.ownerId) {
            //      return message.reply("You don't have permission to use this command.");
            // }

            try {
                await message.channel.sendTyping();
                
                let currentActivityChannelName = config.activityChannelName;
                if (client.activityChannel) {
                    currentActivityChannelName = client.activityChannel.name;
                } else {
                    const foundCh = message.guild.channels.cache.find(ch => ch.name === config.activityChannelName && ch.isTextBased());
                    if (foundCh) currentActivityChannelName = foundCh.name;
                    else console.warn(`!activity: Could not find activity channel #${config.activityChannelName} to display its name.`);
                }

                await message.guild.members.fetch();
                const members = message.guild.members.cache
                    .filter(member => !member.user.bot)
                    .sort((a, b) => a.displayName.localeCompare(b.displayName));

                if (members.size === 0) {
                    return message.channel.send("No non-bot members found in this server.");
                }

                const userActivityInfo = [];
                for (const member of members.values()) {
                    const userData = botData.users[member.id];
                    const timestamp = userData ? userData.lastMessageTimestamp : null;
                    const timeAgo = formatTimeAgo(timestamp);
                    userActivityInfo.push({
                        name: member.displayName,
                        value: `Last message in #${currentActivityChannelName}: ${timeAgo}`,
                        inline: false
                    });
                }

                const embeds = [];
                const usersPerEmbed = 15;

                for (let i = 0; i < userActivityInfo.length; i += usersPerEmbed) {
                    const chunk = userActivityInfo.slice(i, i + usersPerEmbed);
                    const embed = new EmbedBuilder()
                        .setColor(0x00AAFF)
                        .setTitle(`User Activity Report (Page ${Math.floor(i / usersPerEmbed) + 1})`)
                        .setDescription(`Showing last recorded message activity for users in channel **#${currentActivityChannelName}**.`)
                        .setTimestamp();
                    
                    chunk.forEach(userInfo => {
                        embed.addFields({ name: userInfo.name, value: userInfo.value, inline: userInfo.inline });
                    });
                    embeds.push(embed);
                }

                if (embeds.length === 0) {
                    message.channel.send("Could not generate activity report.");
                } else {
                    for (const embed of embeds) {
                        await message.channel.send({ embeds: [embed] });
                    }
                }

            } catch (error) {
                console.error("Error executing !activity command:", error);
                message.channel.send("An error occurred while fetching user activity. Please check the console.");
            }
        }
        // Add other commands here using 'else if (command === "othercommand") { ... }'
    }
});

async function performActivityScan() {
    console.log("Starting activity scan...");
    const guild = client.guilds.cache.get(config.guildId);
    if (!guild) {
        console.error(`Guild with ID ${config.guildId} not found. Scan aborted.`);
        return;
    }

    const announcementChannel = guild.channels.cache.find(
        ch => ch.name === config.announcementChannelName && ch.isTextBased()
    );
    if (!announcementChannel) {
        console.error(`Announcement channel #${config.announcementChannelName} not found. Scan aborted.`);
        return;
    }

    await announcementChannel.send(`📢 **Activity Scan Started!** Checking message counts from the last ${config.scanIntervalDays} days in #${config.activityChannelName}.`);

    const inactiveUserIds = [];
    const activeUserIds = [];

    for (const userId in botData.users) {
        try {
            await guild.members.fetch(userId); // Check if member still in server
            if (botData.users[userId].messageCount <= config.messageThreshold) {
                inactiveUserIds.push(userId);
            } else {
                activeUserIds.push(userId);
            }
        } catch (error) {
            console.log(`User ${botData.users[userId].username} (ID: ${userId}) not found in guild, removing from activity data.`);
            delete botData.users[userId];
        }
    }

    if (inactiveUserIds.length === 0) {
        await announcementChannel.send("✅ All monitored users meet the activity criteria!");
    } else {
        await announcementChannel.send(`🔍 Found ${inactiveUserIds.length} user(s) with low activity (<= ${config.messageThreshold} messages). Initiating polls...`);
        for (const userId of inactiveUserIds) {
            await createKickPoll(guild, announcementChannel, userId, botData.users[userId].username);
        }
    }

    if (activeUserIds.length > 0) {
        const activeUserMentions = activeUserIds.map(id => `<@${id}>`).join(', ');
        const message = `🎉 The following users have met the activity criteria and continue to enjoy full access: ${activeUserMentions}`;
        const MAX_LENGTH = 1950;
        if (message.length > MAX_LENGTH) {
            for (let i = 0; i < message.length; i += MAX_LENGTH) {
                const chunk = message.substring(i, Math.min(i + MAX_LENGTH, message.length));
                await announcementChannel.send(chunk);
            }
        } else {
           await announcementChannel.send(message);
        }
    }

    console.log("Resetting message counts for the next period...");
    for (const userId in botData.users) {
        botData.users[userId].messageCount = 0; // Only reset messageCount
    }

    botData.lastScanTimestamp = Date.now();
    saveData();
    console.log("Activity scan completed. Next scan in " + config.scanIntervalDays + " days.");
    await announcementChannel.send(`🏁 Activity scan and necessary actions completed. Message counts have been reset for the next period.`);
}

async function createKickPoll(guild, channel, userId, username) {
    let member;
    try {
        member = await guild.members.fetch(userId);
    } catch (error) {
        console.log(`User ${username} (ID: ${userId}) left or could not be fetched before poll.`);
        delete botData.users[userId];
        saveData();
        return;
    }
    
    if (member.id === client.user.id || member.id === guild.ownerId) {
        console.log(`Skipping poll for ${username} (bot or server owner).`);
        return;
    }
    if (guild.members.me && member.roles.highest.position >= guild.members.me.roles.highest.position) {
        console.log(`Skipping poll for ${username} (higher/equal role). Cannot kick.`);
        await channel.send(`⚠️ Cannot create kick poll for ${member.user.tag} as they have a role higher than or equal to mine.`);
        return;
    }

    const pollEmbed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle(`Kick Poll: ${username}`)
        .setDescription(`User ${member.user.tag} has had ${botData.users[userId]?.messageCount || 0} messages in #${config.activityChannelName} in the last ${config.scanIntervalDays} days (threshold is ${config.messageThreshold}).\n\nShould they be kicked for inactivity?`)
        .addFields({ name: 'React to Vote', value: '✅ = Yes, Kick\n❌ = No, Keep' })
        .setFooter({ text: `Poll ends in ${config.pollDurationHours} hours.` })
        .setTimestamp();

    try {
        const pollMessage = await channel.send({ embeds: [pollEmbed] });
        await pollMessage.react('✅');
        await pollMessage.react('❌');

        const filter = (reaction, user) => ['✅', '❌'].includes(reaction.emoji.name) && !user.bot;
        const collector = pollMessage.createReactionCollector({ filter, time: config.pollDurationHours * 60 * 60 * 1000 });

        collector.on('end', async collected => {
            const yesVotes = collected.get('✅')?.count || 0; // Actual user votes (bot's reaction is not counted by filter)
            const noVotes = collected.get('❌')?.count || 0;

            let resultMessage = `Poll for ${member.user.tag} ended. Results:\n✅ Yes votes: ${yesVotes}\n❌ No votes: ${noVotes}\n\n`;

            const currentMember = await guild.members.fetch(userId).catch(() => null);
            if (!currentMember) {
                resultMessage += `${member.user.tag} left the server before the poll concluded.`;
                await channel.send(resultMessage);
                delete botData.users[userId];
                saveData();
                return;
            }

            const totalVotes = yesVotes + noVotes;
            if (totalVotes === 0) {
                resultMessage += "No votes were cast. No action will be taken.";
            } else if (yesVotes / totalVotes >= config.pollPassThreshold && yesVotes > noVotes) {
                resultMessage += `**Poll passed!** Kicking ${member.user.tag} for inactivity.`;
                try {
                    await member.kick(`Kicked due to inactivity poll (Messages: ${botData.users[userId]?.messageCount || 'N/A'}, Threshold: ${config.messageThreshold}).`);
                    resultMessage += `\n✅ ${member.user.tag} has been kicked.`;
                    delete botData.users[userId];
                    saveData();
                } catch (kickError) {
                    console.error(`Failed to kick ${member.user.tag}:`, kickError);
                    resultMessage += `\n⚠️ **Failed to kick ${member.user.tag}.** I might lack permissions or they have a higher role.`;
                }
            } else {
                resultMessage += `**Poll did not pass.** ${member.user.tag} will not be kicked.`;
            }
            await channel.send(resultMessage);
        });

    } catch (error) {
        console.error(`Error creating poll for ${username}:`, error);
        await channel.send(`⚠️ Could not create a poll for ${username}. Check console for errors.`);
    }
}

// --- LOGIN ---
if (!config.token || config.token === "YOUR_DISCORD_BOT_TOKEN") {
    console.error("CRITICAL: Bot token is not configured in config.json!");
    process.exit(1);
}
if (!config.guildId || config.guildId === "YOUR_SERVER_ID_HERE") {
    console.error("CRITICAL: guildId is not configured in config.json!");
    process.exit(1);
}

client.login(config.token);
