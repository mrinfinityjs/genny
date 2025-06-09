const { Client, GatewayIntentBits, Partials, EmbedBuilder, PermissionsBitField, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
const ytdl = require('ytdl-core');
const { CronJob } = require('cron');
const axios = require('axios');
const { DateTime, Duration } = require('luxon');

// --- CONFIGURATION ---
const configFileArg = process.argv[2];
const CONFIG_PATH = configFileArg ? path.resolve(process.cwd(), configFileArg) : path.join(__dirname, 'config.json');
let config;

function loadConfiguration() {
    try {
        console.log(`Loading configuration from: ${CONFIG_PATH}`);
        config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (error) {
        console.error(`Error loading configuration from ${CONFIG_PATH}:`, error);
        process.exit(1);
    }
}
loadConfiguration();

const DATA_PATH = path.join(__dirname, 'data.json');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessageReactions
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
});

// --- DATA HANDLING ---
let botData = {
    lastScanTimestamp: 0,
    lastVerificationScanTimestamp: 0,
    users: {},
    youtubeLinks: [],
    tags: {}
};

function loadData() {
    try {
        if (fs.existsSync(DATA_PATH)) {
            const rawData = fs.readFileSync(DATA_PATH, 'utf8');
            const loaded = JSON.parse(rawData);
            botData = { ...botData, ...loaded };
            if (!botData.users) botData.users = {};
            if (!botData.youtubeLinks) botData.youtubeLinks = [];
            if (!botData.tags) botData.tags = {};
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
            console.log("User, link, and tag data loaded.");
            pruneOldYoutubeLinks();
        } else {
            console.log("No existing data file found. Starting fresh.");
            saveData();
        }
    } catch (error) { console.error("Error loading data.json:", error); }
}

function saveData() {
    try {
        fs.writeFileSync(DATA_PATH, JSON.stringify(botData, null, 2));
    } catch (error) { console.error("Error saving data.json:", error); }
}

function pruneOldYoutubeLinks() {
    const historyDaysMs = (parseInt(config.youtubeLinkHistoryDays) || 30) * 24 * 60 * 60 * 1000;
    const cutoffTimestamp = Date.now() - historyDaysMs;
    const originalCount = botData.youtubeLinks.length;
    botData.youtubeLinks = botData.youtubeLinks.filter(link => link.timestamp >= cutoffTimestamp);
    if (originalCount > botData.youtubeLinks.length) {
        console.log(`Pruned ${originalCount - botData.youtubeLinks.length} old YouTube links.`);
        saveData();
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

async function getYoutubeVideoTitle(url) {
    try {
        if (!url.includes("youtube.com/") && !url.includes("youtu.be/")) return "Not a YouTube URL";
        const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
        const response = await axios.get(oembedUrl);
        if (response.data && response.data.title) return response.data.title.trim();
        console.warn(`oEmbed failed for ${url}:`, response.data);
        return "YouTube Video (Title from oEmbed Failed)";
    } catch (error) {
        console.warn(`Error oEmbed for ${url}: ${error.message.split('\n')[0]}`);
        try {
            if (ytdl.validateURL(url)) {
                const info = await ytdl.getInfo(url);
                if (info.videoDetails && info.videoDetails.title) return info.videoDetails.title.trim();
            }
        } catch (ytdlError) { console.warn(`ytdl-core fallback failed for ${url}: ${ytdlError.message.split('\n')[0]}`); }
        return "YouTube Video (Title Unavailable)";
    }
}

function formatDuration(ms) {
    if (ms < 0) ms = 0;
    const d = Duration.fromMillis(ms).shiftTo('days', 'hours', 'minutes', 'seconds');
    let parts = [];
    if (d.days > 0) parts.push(`${Math.floor(d.days)} day(s)`);
    if (d.hours > 0) parts.push(`${Math.floor(d.hours)} hour(s)`);
    if (d.minutes > 0) parts.push(`${Math.floor(d.minutes)} minute(s)`);
    if (d.seconds > 0 && parts.length < 2 && d.days === 0 && d.hours === 0 && d.minutes < 5) parts.push(`${Math.floor(d.seconds)} second(s)`);
    if (parts.length === 0 && ms < 60000 && ms > 0) return "Very soon!";
    if (parts.length === 0) return "Starting now or very soon!";
    return parts.join(', ');
}

async function geminiGen(apiUrl, version, modelAction, apiKey, promptText) {
    const endpoint = `${apiUrl}${version}/models/${modelAction}?key=${apiKey}`;
    let finalPromptText = promptText;
    if (config.geminiIncludeInPrompts && typeof config.geminiIncludeInPrompts === 'string') {
        finalPromptText += config.geminiIncludeInPrompts;
    }
    const requestBody = { contents: [{ parts: [{ text: finalPromptText }] }] };
    try {
        const response = await axios.post(endpoint, requestBody, { headers: { 'Content-Type': 'application/json' } });
        if (response.data && response.data.candidates && response.data.candidates.length > 0 &&
            response.data.candidates[0].content && response.data.candidates[0].content.parts &&
            response.data.candidates[0].content.parts.length > 0 &&
            typeof response.data.candidates[0].content.parts[0].text === 'string') {
            return response.data.candidates[0].content.parts[0].text;
        } else if (response.data && response.data.promptFeedback && response.data.promptFeedback.blockReason) {
            const blockReason = response.data.promptFeedback.blockReason;
            return `My response was blocked due to safety settings (Reason: ${blockReason}). Please try a different prompt.`;
        } else { return "I received an unusual response from the AI."; }
    } catch (error) {
        console.error("[Gemini] Error calling Gemini API:", error.message);
        let errorMessage = "I encountered an error trying to reach the AI.";
        if (error.response) { errorMessage = `AI API Error: Received status ${error.response.status}.`; }
        return errorMessage;
    }
}

const youtubeUrlPatterns = [
    /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/|playlist\?list=))([a-zA-Z0-9_-]{11})/gi,
    /(?:https?:\/\/)?(?:www\.)?youtu\.be\/([a-zA-Z0-9_-]{11})/gi
];
const MAX_POLL_OPTIONS = 10;

// --- BOT LIFECYCLE & SCHEDULED TASKS ---
let autoYoutubePollJob;
let dailyWatchAnnouncementJob;
let activityScanIntervalId;
let verificationScanIntervalId;

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    client.copiedToKnowledge = new Set();
    client.translatedMessages = new Set(); // For translation feature

    const guild = client.guilds.cache.get(config.guildId);
    if (!guild) { console.error(`CRITICAL: Guild with ID ${config.guildId} not found.`); }
    else {
        console.log(`Operating in guild: ${guild.name} (ID: ${guild.id})`);
        client.newMemberRole = guild.roles.cache.find(role => role.name === config.newMemberRoleName);
        client.verifiedMemberRole = guild.roles.cache.find(role => role.name === config.verifiedMemberRoleName);
        if (!client.newMemberRole) console.warn(`New Member Role "${config.newMemberRoleName}" not found!`);
        if (!client.verifiedMemberRole) console.warn(`Verified Member Role "${config.verifiedMemberRoleName}" not found!`);

        if (!config.rolesChannelName || !config.rolesChannelMessageID || !Array.isArray(config.reactionRoles)) {
            console.warn("[ReactionRoles] Feature not fully configured. Missing 'rolesChannelName', 'rolesChannelMessageID', or 'reactionRoles' (must be an array) in config.json.");
        } else {
            if (config.rolesChannelMessageID === "YOUR_MESSAGE_ID_HERE") {
                 console.warn("[ReactionRoles] 'rolesChannelMessageID' is still set to placeholder. Update it with your message ID.");
            }
            console.log(`[ReactionRoles] System configured for channel "${config.rolesChannelName}" and message ID "${config.rolesChannelMessageID}".`);
        }
        if (!config.translateEmoji || !config.translateToLanguage) {
            console.warn("[Translate] Feature not fully configured. Missing 'translateEmoji' or 'translateToLanguage' in config.json.");
        } else {
            console.log(`[Translate] System configured to translate on '${config.translateEmoji}' to '${config.translateToLanguage}'.`);
        }
    }
    loadData();
    scheduleTasks();
    setInterval(pruneOldYoutubeLinks, 24 * 60 * 60 * 1000);
    console.log("Bot ready, initial data loaded, and tasks scheduled.");
});

function scheduleTasks() {
    unscheduleTasks();
    const guild = client.guilds.cache.get(config.guildId);
    if (!guild) { console.warn("Guild not found, cannot schedule tasks."); return; }

    const kickScanIntervalMs = (parseFloat(config.scanIntervalDays) || 14) * 24 * 60 * 60 * 1000;
    if (Date.now() - (botData.lastScanTimestamp || 0) >= kickScanIntervalMs) {
        performActivityScan().catch(console.error);
    }
    activityScanIntervalId = setInterval(async () => { if (client.guilds.cache.get(config.guildId)) await performActivityScan().catch(console.error); }, kickScanIntervalMs);

    const verificationScanIntervalMs = (parseFloat(config.verificationPollDays) / 2 || 3.5) * 24 * 60 * 60 * 1000;
    if (Date.now() - (botData.lastVerificationScanTimestamp || 0) >= verificationScanIntervalMs) {
        performVerificationScan().catch(console.error);
    }
    verificationScanIntervalId = setInterval(async () => { if (client.guilds.cache.get(config.guildId)) await performVerificationScan().catch(console.error); }, verificationScanIntervalMs);

    const timezone = config.cronTimezone || DateTime.local().zoneName;
    if (config.autoPollVideoChannelName && config.autoPollVideoCronTime) {
        try {
            const autoPollChannelObject = guild.channels.cache.find(ch => ch.name === config.autoPollVideoChannelName && ch.isTextBased());
            if (!autoPollChannelObject) {
                console.error(`[AutoPollSetup] Automated poll channel "${config.autoPollVideoChannelName}" not found. Auto poll will not run.`);
            } else {
                autoYoutubePollJob = new CronJob(config.autoPollVideoCronTime, async () => {
                    console.log(`[${DateTime.now().setZone(timezone).toISO()}] Running automated YouTube video poll for channel #${autoPollChannelObject.name}...`);
                    const currentGuild = client.guilds.cache.get(config.guildId);
                    if (!currentGuild) return console.error("Auto Poll: Guild not found at execution time.");
                    await createYoutubeWatchPoll(
                        autoPollChannelObject,
                        config.autoPollVideoDaysPast.toString(),
                        autoPollChannelObject.id,
                        null,
                        true
                    );
                }, null, true, timezone);
                console.log(`Automated YouTube poll scheduled for #${config.autoPollVideoChannelName} (ID: ${autoPollChannelObject.id}) with cron: ${config.autoPollVideoCronTime} (TZ: ${timezone}). Will poll links from this channel.`);
            }
        } catch (cronError) { console.error("Failed to schedule automated YouTube poll:", cronError); }
    }

    if (config.announceWatchEventDaily && config.dailyAnnouncementTime && config.dailyAnnouncementChannelName && autoYoutubePollJob) {
        try {
            const [hour, minute] = config.dailyAnnouncementTime.split(':').map(Number);
            const dailyCronTime = `${minute} ${hour} * * *`;
            dailyWatchAnnouncementJob = new CronJob(dailyCronTime, async () => {
                console.log(`[${DateTime.now().setZone(timezone).toISO()}] Running daily watch event announcement...`);
                const currentGuild = client.guilds.cache.get(config.guildId);
                if (!currentGuild) return console.error("Daily Announce: Guild not found.");
                const announceChannel = currentGuild.channels.cache.find(ch => ch.name === config.dailyAnnouncementChannelName && ch.isTextBased());
                if (!announceChannel) return console.error(`Daily Announce: Channel #${config.dailyAnnouncementChannelName} not found.`);
                
                const nextPollJSDate = autoYoutubePollJob.nextDate().toJSDate();
                const nextPollLuxonDate = DateTime.fromJSDate(nextPollJSDate, { zone: timezone });

                if (nextPollLuxonDate.isValid) {
                    const nowInCronTZ = DateTime.now().setZone(timezone);
                    let timeUntil = nextPollLuxonDate.diff(nowInCronTZ);
                    let targetDateForDisplay = nextPollLuxonDate;

                    if (timeUntil.as('milliseconds') < 0) {
                         const nextNextPollJSDate = autoYoutubePollJob.nextDates(2)[1]?.toJSDate();
                         if (nextNextPollJSDate) {
                            const nextNextPollLuxon = DateTime.fromJSDate(nextNextPollJSDate, { zone: timezone });
                            timeUntil = nextNextPollLuxon.diff(nowInCronTZ);
                            targetDateForDisplay = nextNextPollLuxon;
                         } else { 
                            return await announceChannel.send("Next video poll time is not determined yet (past current and no future scheduled).").catch(console.error);
                         }
                    }
                    const durationString = formatDuration(timeUntil.as('milliseconds'));
                    const messageContent = `${config.watchEventMessage || "Next video poll starts:"}\n**${durationString}** (on ${targetDateForDisplay.toFormat("DDDD 'at' h:mm a ZZZZ")})`;
                    await announceChannel.send(messageContent).catch(console.error);
                } else { await announceChannel.send("Next video poll time could not be determined.").catch(console.error); }
            }, null, true, timezone);
            console.log(`Daily watch announcement scheduled with cron: ${dailyCronTime} (TZ: ${timezone}) for #${config.dailyAnnouncementChannelName}`);
        } catch (cronError) { console.error("Failed to schedule daily watch announcement:", cronError); }
    }
}

function unscheduleTasks() {
    if (activityScanIntervalId) clearInterval(activityScanIntervalId);
    if (verificationScanIntervalId) clearInterval(verificationScanIntervalId);
    if (autoYoutubePollJob) autoYoutubePollJob.stop();
    if (dailyWatchAnnouncementJob) dailyWatchAnnouncementJob.stop();
    activityScanIntervalId = null; verificationScanIntervalId = null; autoYoutubePollJob = null; dailyWatchAnnouncementJob = null;
    console.log("Unscheduled existing tasks.");
}

client.on('guildMemberAdd', async member => {
    if (member.guild.id !== config.guildId || member.user.bot) return;
    console.log(`New member joined: ${member.user.tag} (ID: ${member.id})`);
    const newMemberRole = client.newMemberRole || member.guild.roles.cache.find(role => role.name === config.newMemberRoleName);
    if (!newMemberRole) return console.error(`Error: Role "${config.newMemberRoleName}" not found for new member.`);
    try {
        await member.roles.add(newMemberRole);
        console.log(`Assigned "${config.newMemberRoleName}" to ${member.user.tag}.`);
        botData.users[member.id] = {
            username: member.user.username, messageCount: 0, lastMessageTimestamp: null,
            joinTimestamp: Date.now(), isVerified: false, verificationMessages: 0
        };
        saveData();
        const activityChannel = member.guild.channels.cache.find(ch => ch.name === config.activityChannelName && ch.isTextBased());
        if (activityChannel) {
            activityChannel.send(`Welcome <@${member.id}>! Be active here for full access. Need ${config.verificationMessageThreshold} messages & ${config.verificationPollDays} days for verification poll.`).catch(console.error);
        }
    } catch (error) { console.error(`Failed to process new member ${member.user.tag}:`, error); }
});

// --- REACTION ROLE HANDLER ---
async function handleReactionRole(reaction, user, action) {
    if (!config.rolesChannelName || !config.rolesChannelMessageID || !Array.isArray(config.reactionRoles) || config.rolesChannelMessageID === "YOUR_MESSAGE_ID_HERE") {
        return;
    }
    if (reaction.message.id !== config.rolesChannelMessageID) return;
    if (reaction.message.channel.name !== config.rolesChannelName) return;

    const emojiIdentifier = reaction.emoji.id ? reaction.emoji.toString() : reaction.emoji.name;
    const roleConfig = config.reactionRoles.find(rc => rc.emoji === emojiIdentifier);
    if (!roleConfig) return;

    const guild = reaction.message.guild;
    if (!guild) return;

    const member = await guild.members.fetch(user.id).catch(err => {
        console.error(`[ReactionRoles] Failed to fetch member ${user.id}:`, err);
        return null;
    });
    if (!member) return;

    const role = guild.roles.cache.find(r => r.name === roleConfig.roleName);
    if (!role) {
        console.warn(`[ReactionRoles] Role "${roleConfig.roleName}" not found in guild ${guild.name}.`);
        return;
    }

    try {
        if (action === 'add') {
            if (!member.roles.cache.has(role.id)) {
                await member.roles.add(role);
                console.log(`[ReactionRoles] Added role "${role.name}" to ${member.user.tag}.`);
                if (roleConfig.announceChannelName) {
                    const announceChannel = guild.channels.cache.find(ch => ch.name === roleConfig.announceChannelName && ch.isTextBased());
                    if (announceChannel) {
                        await announceChannel.send(`${member.user} has joined the ${role} group! 👋`).catch(console.error);
                    } else {
                        console.warn(`[ReactionRoles] Announcement channel "${roleConfig.announceChannelName}" for role "${role.name}" not found.`);
                    }
                }
            }
        } else if (action === 'remove') {
            if (member.roles.cache.has(role.id)) {
                await member.roles.remove(role);
                console.log(`[ReactionRoles] Removed role "${role.name}" from ${member.user.tag}.`);
            }
        }
    } catch (error) {
        console.error(`[ReactionRoles] Failed to ${action} role "${role.name}" for ${member.user.tag}:`, error);
        if (error.code === 50013) {
             try {
                const owner = await guild.fetchOwner();
                if (owner) owner.send(`⚠️ **Reaction Role Error:** I tried to ${action} the role "${role.name}" for ${member.user.tag} but I lack permissions. Please check my role hierarchy and permissions.`).catch(e => console.error("Failed to DM owner about reaction role permission error:", e));
            } catch (dmError) { console.error("Failed to fetch or DM owner about permission error:", dmError); }
        }
    }
}

// --- KNOWLEDGE REPOSITORY COPY FUNCTION ---
async function copyMessageToKnowledge(message, targetChannel, triggerReason = "Unknown") {
    if (!message || !targetChannel) return;
    if (client.copiedToKnowledge.has(message.id)) {
        return;
    }

    const originalTimestamp = DateTime.fromJSDate(message.createdAt, { zone: 'utc' }).setZone(config.cronTimezone || DateTime.local().zoneName);
    const dateStr = originalTimestamp.toFormat('yyyy-MM-dd');
    const timeStr = originalTimestamp.toFormat('HH:mm:ss ZZZZ');

    const headerLines = [
        `**Author:** ${message.author.tag} (<@${message.author.id}>)`,
        `**Original Post Time:** ${dateStr} ${timeStr}`,
        `**Copy Trigger:** ${triggerReason}`,
        `**Original Message Link:** ${message.url}`,
        `\n`
    ];
    let headerText = headerLines.join('\n');
    let fullContentToCopy = message.content || "*No text content*";

    if (message.attachments.size > 0) {
        fullContentToCopy += "\n\n**Attachments:**";
        message.attachments.forEach(att => {
            fullContentToCopy += `\n${att.name} (${(att.size / 1024).toFixed(2)} KB): ${att.url}`;
        });
    }
     if (message.embeds.length > 0 && !message.content && message.attachments.size === 0) {
        fullContentToCopy += "\n\n*Message contained an embed (e.g., link preview). Link previews are not copied directly but the original link is above.*";
    }

    const MAX_CHUNK_LENGTH = 2000;
    const combinedMessage = headerText + `>>> ${fullContentToCopy}`;

    if (combinedMessage.length <= MAX_CHUNK_LENGTH) {
        await targetChannel.send(combinedMessage).catch(console.error);
    } else {
        await targetChannel.send(headerText).catch(console.error);
        const prefix = ">>> ";
        for (let i = 0; i < fullContentToCopy.length; i += (MAX_CHUNK_LENGTH - prefix.length)) {
            const chunk = fullContentToCopy.substring(i, i + (MAX_CHUNK_LENGTH - prefix.length));
            await targetChannel.send(prefix + chunk).catch(console.error);
        }
    }
    client.copiedToKnowledge.add(message.id);
    console.log(`[KnowledgeCopy] Copied message ${message.id} to #${targetChannel.name}. Trigger: ${triggerReason}`);
}


client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    if (!reaction.message.guild || reaction.message.guild.id !== config.guildId) return;

    if (reaction.partial) { try { await reaction.fetch(); } catch (e) { console.error('[ReactionAdd] Failed to fetch partial reaction:', e); return; } }
    if (reaction.message.partial) { try { await reaction.message.fetch(); } catch (e) { console.error('[ReactionAdd] Failed to fetch partial message for reaction:', e); return; } }

    // --- Reaction Role Logic ---
    await handleReactionRole(reaction, user, 'add');
    // End Reaction Role Logic

    // --- Translation Logic ---
    if (
        config.translateEmoji &&
        config.translateToLanguage &&
        config.geminiApiKey &&
        (reaction.emoji.name === config.translateEmoji || reaction.emoji.toString() === config.translateEmoji)
    ) {
        // Only trigger if it's the first instance of this specific emoji on this message
        if (reaction.count === 1 && !client.translatedMessages.has(reaction.message.id)) {
            if (!reaction.message.content || reaction.message.content.trim() === "") {
                console.log(`[Translate] Message ${reaction.message.id} has no content to translate.`);
                client.translatedMessages.add(reaction.message.id); // Mark as processed to avoid re-checks
            } else {
                console.log(`[Translate] Triggered translation for message ${reaction.message.id} to ${config.translateToLanguage} as it's the first '${config.translateEmoji}' reaction.`);
                try {
                    await reaction.message.channel.sendTyping();
                    const prompt = `Translate this to ${config.translateToLanguage}: ${reaction.message.content}`;
                    const translation = await geminiGen(config.geminiApiUrl, config.geminiApiVersion, config.geminiModelAction, config.geminiApiKey, prompt);

                    if (translation && !translation.startsWith("My response was blocked") && !translation.startsWith("I encountered an error") && !translation.startsWith("AI API Error")) {
                        let replyHeader = `**Translation to ${config.translateToLanguage} (for <@${reaction.message.author.id}>):**\n`;
                        let fullReply = replyHeader + `>>> ${translation}`;
                        const MAX_REPLY_LENGTH = 2000;

                        if (fullReply.length > MAX_REPLY_LENGTH) {
                            await reaction.message.reply(replyHeader).catch(console.error);
                            const translationContent = `>>> ${translation}`;
                            for (let i = 0; i < translationContent.length; i += MAX_REPLY_LENGTH) {
                                const chunk = translationContent.substring(i, Math.min(i + MAX_REPLY_LENGTH, translationContent.length));
                                await reaction.message.channel.send(chunk).catch(console.error); // Send subsequent chunks in channel
                            }
                        } else {
                            await reaction.message.reply(fullReply).catch(console.error);
                        }
                    } else {
                        console.warn(`[Translate] AI translation failed or returned an error for message ${reaction.message.id}: ${translation}`);
                        // Optionally inform the user, but be mindful of spamming if AI frequently fails
                        // await reaction.message.reply(`Sorry, I couldn't translate that message right now.`).catch(console.error);
                    }
                } catch (translateError) {
                    console.error(`[Translate] Error during translation process for message ${reaction.message.id}:`, translateError);
                } finally {
                    client.translatedMessages.add(reaction.message.id); // Mark as processed after attempt
                }
            }
        }
    }
    // End Translation Logic

    // --- Knowledge Copy Logic ---
    if (config.knowledgeCopyToChannelName && typeof config.knowledgeCopyEmojisMin === 'number' && config.knowledgeCopyWhenEmoji) {
        const knowledgeRepoChannel = reaction.message.guild.channels.cache.find(
            ch => ch.name === config.knowledgeCopyToChannelName && ch.isTextBased()
        );

        if (knowledgeRepoChannel) {
            if (!client.copiedToKnowledge.has(reaction.message.id)) {
                const reactingEmojiString = reaction.emoji.id ? reaction.emoji.toString() : reaction.emoji.name;
                if (reactingEmojiString === config.knowledgeCopyWhenEmoji) {
                    console.log(`[KnowledgeCopy] Troll emoji "${config.knowledgeCopyWhenEmoji}" detected on message ${reaction.message.id} by ${user.tag}.`);
                    await copyMessageToKnowledge(reaction.message, knowledgeRepoChannel, `Troll Emoji (${config.knowledgeCopyWhenEmoji}) by ${user.tag}`);
                    return; 
                }

                const minUsersForCopy = parseInt(config.knowledgeCopyEmojisMin);
                if (minUsersForCopy > 0) {
                    const reactingUsersWithRequiredRole = new Set();
                    try {
                        for (const msgReaction of reaction.message.reactions.cache.values()) {
                            const currentReactionEmojiString = msgReaction.emoji.id ? msgReaction.emoji.toString() : msgReaction.emoji.name;
                            if (currentReactionEmojiString === config.knowledgeCopyWhenEmoji) continue;

                            const usersWhoReactedWithThisEmoji = await msgReaction.users.fetch();
                            for (const reactorUser of usersWhoReactedWithThisEmoji.values()) {
                                if (reactorUser.bot) continue;
                                const member = await reaction.message.guild.members.fetch(reactorUser.id).catch(() => null);
                                if (member) {
                                    const memberIsModerator = await isModerator(member);
                                    const memberIsVerified = client.verifiedMemberRole && member.roles.cache.has(client.verifiedMemberRole.id);
                                    if (memberIsModerator || memberIsVerified) {
                                        reactingUsersWithRequiredRole.add(reactorUser.id);
                                    }
                                }
                            }
                        }
                    } catch (fetchError) {
                        console.error("[KnowledgeCopy] Error fetching reactions/members for threshold check:", fetchError);
                    }
                    
                    if (reactingUsersWithRequiredRole.size >= minUsersForCopy) {
                        if (!client.copiedToKnowledge.has(reaction.message.id)) {
                            console.log(`[KnowledgeCopy] Threshold of ${minUsersForCopy} unique verified/mod users (${reactingUsersWithRequiredRole.size} found) reached for message ${reaction.message.id}.`);
                            await copyMessageToKnowledge(reaction.message, knowledgeRepoChannel, `Threshold Met (${reactingUsersWithRequiredRole.size}/${minUsersForCopy} eligible users)`);
                        }
                    }
                }
            }
        }
    }
    // End Knowledge Copy Logic
});

client.on('messageReactionRemove', async (reaction, user) => {
    if (user.bot) return;
    if (!reaction.message.guild || reaction.message.guild.id !== config.guildId) return;

    if (reaction.partial) { try { await reaction.fetch(); } catch (e) { console.error('[ReactionRemove] Failed to fetch partial reaction:', e); return; } }
    if (reaction.message.partial) { try { await reaction.message.fetch(); } catch (e) { console.error('[ReactionRemove] Failed to fetch partial message for reaction:', e); return; } }

    // --- Reaction Role Logic ---
    await handleReactionRole(reaction, user, 'remove');
    // End Reaction Role Logic
});


client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild || message.guild.id !== config.guildId) return;

    let matchFoundThisMessage = false;
    for (const pattern of youtubeUrlPatterns) {
        pattern.lastIndex = 0; let match;
        while ((match = pattern.exec(message.content)) !== null) {
            const videoId = match[1]; const fullUrl = `https://www.youtube.com/watch?v=${videoId}`;
            if (!botData.youtubeLinks.find(l => l.url === fullUrl && l.messageId === message.id)) {
                if (matchFoundThisMessage && botData.youtubeLinks.some(l => l.messageId === message.id && l.url === fullUrl)) continue;
                const title = await getYoutubeVideoTitle(fullUrl);
                if (title === "Invalid YouTube URL" || title === "Not a YouTube URL" || title.includes("Title Unavailable") || title.includes("oEmbed Failed")) continue;
                botData.youtubeLinks.push({
                    url: fullUrl, title: title, timestamp: Date.now(), messageId: message.id,
                    channelId: message.channel.id, authorId: message.author.id, authorTag: message.author.tag
                });
                console.log(`Logged YouTube link: "${title}" (${fullUrl}) from ${message.author.tag}`);
                matchFoundThisMessage = true;
            }
        }
    }
    if (matchFoundThisMessage) saveData();

    let activityChannel;
    if (!client.activityChannel) client.activityChannel = message.guild.channels.cache.find(ch => ch.name === config.activityChannelName && ch.isTextBased());
    activityChannel = client.activityChannel;

    if (activityChannel && message.channel.id === activityChannel.id) {
        const userId = message.author.id;
        if (!botData.users[userId]) {
            const member = await message.guild.members.fetch(userId).catch(() => null);
            const verifiedRole = client.verifiedMemberRole || message.guild.roles.cache.find(role => role.name === config.verifiedMemberRoleName);
            botData.users[userId] = {
                username: message.author.username, messageCount: 0, lastMessageTimestamp: null,
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

    const tagAddP = config.tagAddPrefix || "+";
    const tagRemoveP = config.tagRemovePrefix || "-";
    const tagShowP = config.tagShowPrefix || "~";

    if (message.content.startsWith(tagAddP) || message.content.startsWith(tagRemoveP) || message.content.startsWith(tagShowP)) {
        const verifiedRole = client.verifiedMemberRole || message.guild.roles.cache.find(role => role.name === config.verifiedMemberRoleName);
        const memberIsVerified = verifiedRole && message.member.roles.cache.has(verifiedRole.id);
        const memberIsMod = await isModerator(message.member);

        if (memberIsVerified || memberIsMod) {
            const prefixUsed = message.content[0];
            const fullCommand = message.content.substring(1).trim();
            const parts = fullCommand.split(/ +/);
            const tagNameRaw = parts.shift();
            const tagValue = parts.join(" ");
            const tagName = tagNameRaw ? tagNameRaw.toLowerCase() : null;

            if (!tagName && (prefixUsed === tagAddP || prefixUsed === tagRemoveP)) {
                return message.reply(`Provide tag name. Usage: \`${prefixUsed}tagName [value]\``).catch(console.error);
            }

            if (prefixUsed === tagAddP) {
                if (!tagName) return; 
                if (!tagValue) return message.reply(`Provide value for tag \`${tagName}\`. Usage: \`${tagAddP}${tagName} <value>\``).catch(console.error);
                const oldTagData = botData.tags[tagName];
                botData.tags[tagName] = { value: tagValue, authorId: message.author.id, authorTag: message.author.tag, timestamp: Date.now() };
                saveData();
                if (oldTagData) await message.reply(`Tag \`${tagName}\` updated. Old: \`${oldTagData.value}\` (by ${oldTagData.authorTag})`).catch(console.error);
                else await message.reply(`Tag \`${tagName}\` created: \`${tagValue}\``).catch(console.error);
            } else if (prefixUsed === tagRemoveP) {
                if (!tagName) return; 
                if (botData.tags[tagName]) {
                    const removedVal = botData.tags[tagName].value; delete botData.tags[tagName]; saveData();
                    await message.reply(`Tag \`${tagName}\` (value: \`${removedVal}\`) removed.`).catch(console.error);
                } else await message.reply(`Tag \`${tagName}\` not found.`).catch(console.error);
            } else if (prefixUsed === tagShowP) {
                if (tagName) {
                    if (botData.tags[tagName]) {
                        const d = botData.tags[tagName];
                        const embed = new EmbedBuilder().setColor(0x00EEEE).setTitle(`Tag: \`${tagName}\``)
                            .setDescription(`**Value:** ${d.value}`)
                            .setFooter({ text: `By ${d.authorTag} • ${formatTimeAgo(d.timestamp)}` }).setTimestamp();
                        await message.channel.send({ embeds: [embed] }).catch(console.error);
                    } else await message.reply(`Tag \`${tagName}\` not found.`).catch(console.error);
                } else {
                    const allTags = Object.entries(botData.tags);
                    if (allTags.length === 0) return message.reply("No tags set yet.").catch(console.error);
                    const embeds = []; const tagsPerEmbed = 15;
                    let currentEmbed = new EmbedBuilder().setColor(0x00EEEE).setTitle("📋 All Tags").setTimestamp();
                    let fieldCount = 0;
                    for (const [name, data] of allTags.sort((a, b) => a[0].localeCompare(b[0]))) {
                        if (fieldCount >= tagsPerEmbed) {
                            embeds.push(currentEmbed);
                            currentEmbed = new EmbedBuilder().setColor(0x00EEEE).setTitle("📋 All Tags (Cont.)").setTimestamp();
                            fieldCount = 0;
                        }
                        currentEmbed.addFields({ name: `\`${name}\``, value: data.value.substring(0, 1000) + (data.value.length > 1000 ? "..." : ""), inline: false });
                        fieldCount++;
                    }
                    embeds.push(currentEmbed);
                    try { for (const e of embeds) { await message.channel.send({ embeds: [e] }); if (embeds.length > 1) await new Promise(r => setTimeout(r, 1000)); } }
                    catch (e) { console.error("All tags embed error:", e); }
                }
            }
        }
    }
    else if (message.content.startsWith(config.prefix)) {
        const args = message.content.slice(config.prefix.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();
        const memberIsModerator = await isModerator(message.member);

        if (command === "commands" || command === "help") {
            const embed = new EmbedBuilder().setColor(0x0099FF).setTitle("📜 Bot Commands List")
                .setDescription(`Standard Prefix: \`${config.prefix}\`\nTag Prefixes: Add \`${config.tagAddPrefix}\`, Remove \`${config.tagRemovePrefix}\`, Show \`${config.tagShowPrefix}\``)
                .setTimestamp();
            embed.addFields({ name: "📢 Public Commands", value: "\u200B" });
            embed.addFields(
                { name: `${config.prefix}activity`, value: "Shows user activity report." },
                { name: `${config.prefix}watch`, value: "Shows time until the next scheduled video poll." },
                { name: `${config.prefix}positivity`, value: "Get an uplifting positive message from the AI." },
                { name: `${config.prefix}commands / ${config.prefix}help`, value: "Shows this help message." }
            );
            embed.addFields({ name: "\u200B", value: "\u200B" });
             embed.addFields({ name: "🤖 AI Commands", value: "*(Public by default, can be restricted)*" });
            embed.addFields(
                 { name: `${config.prefix}ai <prompt>`, value: "Sends your <prompt> to the AI and gets a response." }
            );
            embed.addFields({ name: "\u200B", value: "\u200B" });
            embed.addFields({ name: "🛠️ Moderator Commands", value: "*(Requires Moderator role/Admin permission)*" });
            embed.addFields(
                { name: `${config.prefix}allow [days messages] / ${config.prefix}allow`, value: "Manually verifies new members." },
                { name: `${config.prefix}deny <days> <messages>`, value: "Kicks unverified new members by criteria." },
                { name: `${config.prefix}kickpollinactive [days]`, value: `Polls to kick users silent for \`[days]\` (default ${config.kickPollSilentDaysThreshold}d).` },
                { name: `${config.prefix}roles`, value: "Displays member roles." },
                { name: `${config.prefix}watchpoll <criteria>`, value: "Creates poll for THIS CHANNEL's YouTube videos (max 10 newest). Criteria: `N` (days), `mm/dd/yyyy`, `~N` (links)." },
                { name: `${config.prefix}allpoll <criteria>`, value: "Creates poll for ALL CHANNELS' YouTube videos (max 10 newest). Criteria: `N` (days), `mm/dd/yyyy`, `~N` (links)." },
                { name: `${config.prefix}vids <criteria>`, value: "Lists YouTube videos from THIS CHANNEL. Criteria: (same as watchpoll)." },
                { name: `${config.prefix}allvids <criteria>`, value: "Lists YouTube videos from ALL CHANNELS. Criteria: (same as watchpoll)." },
                { name: `${config.prefix}set [setting] [value] / ${config.prefix}set`, value: "Views or updates bot config." }
            );
            embed.addFields({ name: "\u200B", value: "\u200B" });
            embed.addFields({ name: "🏷️ Tagging System", value: `*(Requires ${config.verifiedMemberRoleName} role or Moderator/Admin permission)*` });
            embed.addFields(
                { name: `\`${config.tagAddPrefix}tagName <value>\``, value: `Adds or updates a tag.` },
                { name: `\`${config.tagRemovePrefix}tagName\``, value: `Removes a tag.` },
                { name: `\`${config.tagShowPrefix}tagName\``, value: `Shows a specific tag.` },
                { name: `\`${config.tagShowPrefix}\``, value: `Lists all tags.` }
            );
            try { await message.channel.send({ embeds: [embed] }); } catch (e) { console.error("Help send error", e); }
        }
        else if (command === "watch") {
            if (!autoYoutubePollJob) return message.reply("Automated video poll not scheduled/configured.").catch(console.error);
            try {
                const timezone = config.cronTimezone || DateTime.local().zoneName;
                const nextPollJSDate = autoYoutubePollJob.nextDate().toJSDate();
                const nextPollLuxonDate = DateTime.fromJSDate(nextPollJSDate, { zone: timezone });
                if (!nextPollLuxonDate.isValid) return message.reply("Could not determine next poll time.").catch(console.error);
                
                const nowInCronTZ = DateTime.now().setZone(timezone);
                let timeUntil = nextPollLuxonDate.diff(nowInCronTZ);
                let targetDateForDisplay = nextPollLuxonDate;

                if (timeUntil.as('milliseconds') < 0) {
                    const nextNextPollJSDate = autoYoutubePollJob.nextDates(2)[1]?.toJSDate();
                    if (nextNextPollJSDate) {
                        const nextNextPollLuxon = DateTime.fromJSDate(nextNextPollJSDate, { zone: timezone });
                        timeUntil = nextNextPollLuxon.diff(nowInCronTZ);
                        targetDateForDisplay = nextNextPollLuxon;
                    } else return message.reply("Next poll passed; subsequent not scheduled.").catch(console.error);
                }
                const durationString = formatDuration(timeUntil.as('milliseconds'));
                const response = `${config.watchEventMessage || "Next video poll starts:"}\n**${durationString}** (on ${targetDateForDisplay.toFormat("DDDD 'at' h:mm a ZZZZ")})`;
                await message.reply(response).catch(console.error);
            } catch (e) { console.error("!watch error:", e); message.reply("Could not get next poll time.").catch(console.error); }
        }
        else if (command === "positivity") {
            if (!config.geminiApiKey) return message.reply("AI feature not configured (missing API key).").catch(console.error);
            const prompt = config.geminiPositivePrompt || "Say something positive and uplifting.";
            await message.channel.sendTyping();
            const aiResponse = await geminiGen(config.geminiApiUrl, config.geminiApiVersion, config.geminiModelAction, config.geminiApiKey, prompt);
            if (aiResponse) {
                if (aiResponse.length > 1990) { for (let i = 0; i < aiResponse.length; i += 1990) await message.reply(aiResponse.substring(i, Math.min(i + 1990, aiResponse.length))).catch(console.error); }
                else await message.reply(aiResponse).catch(console.error);
            } else await message.reply("Couldn't get a positive message now.").catch(console.error);
        }
        else if (command === "ai") {
            if (!config.geminiApiKey) return message.reply("AI feature not configured (missing API key).").catch(console.error);
            const userPrompt = args.join(" ");
            if (!userPrompt) return message.reply(`Usage: \`${config.prefix}ai <your prompt>\``).catch(console.error);
            await message.channel.sendTyping();
            const aiResponse = await geminiGen(config.geminiApiUrl, config.geminiApiVersion, config.geminiModelAction, config.geminiApiKey, userPrompt);
            if (aiResponse) {
                 if (aiResponse.length > 1990) { for (let i = 0; i < aiResponse.length; i += 1990) await message.reply(aiResponse.substring(i, Math.min(i + 1990, aiResponse.length))).catch(console.error); }
                 else await message.reply(aiResponse).catch(console.error);
            } else await message.reply("Couldn't get AI response for that prompt.").catch(console.error);
        }
        else if (command === "activity") {
            try {
                await message.channel.sendTyping(); const guild = message.guild;
                let currentActivityChannelName = config.activityChannelName;
                if (client.activityChannel) currentActivityChannelName = client.activityChannel.name;
                await guild.members.fetch();
                const members = guild.members.cache.filter(m => !m.user.bot).sort((a, b) => a.displayName.localeCompare(b.displayName));
                if (members.size === 0) return message.channel.send("No non-bot members found.").catch(console.error);
                const userActivityInfo = [];
                for (const member of members.values()) {
                    const userData = botData.users[member.id]; const timeAgo = formatTimeAgo(userData?.lastMessageTimestamp);
                    const newMemberRole = client.newMemberRole || guild.roles.cache.find(r => r.name === config.newMemberRoleName);
                    const verifiedStatus = userData?.isVerified ? " (Verified)" : (newMemberRole && member.roles.cache.has(newMemberRole.id) ? " (New Member)" : "");
                    userActivityInfo.push({ name: `${member.displayName}${verifiedStatus}`, value: `Activity (#${currentActivityChannelName}): ${timeAgo}\nVerif. Msgs: ${userData?.verificationMessages || 0}`});
                }
                const embeds = []; const usersPerEmbed = 10;
                for (let i = 0; i < userActivityInfo.length; i += usersPerEmbed) {
                    const chunk = userActivityInfo.slice(i, i + usersPerEmbed);
                    const embed = new EmbedBuilder().setColor(0x00AAFF).setTitle(`User Activity (Page ${Math.floor(i/usersPerEmbed)+1})`)
                        .setDescription(`Activity in **#${currentActivityChannelName}**.`).setTimestamp();
                    chunk.forEach(ui => embed.addFields({ name: ui.name, value: ui.value, inline: false })); embeds.push(embed);
                }
                for (const e of embeds) { await message.channel.send({ embeds: [e] }); if (embeds.length > 1) await new Promise(r => setTimeout(r,1000));}
            } catch (error) { console.error("!activity error:", error); message.reply("Error fetching activity.").catch(console.error); }
        }
        else if (command === "allow" && memberIsModerator) {
            if (!client.verifiedMemberRole || !client.newMemberRole) return message.reply("Role(s) not configured.").catch(console.error);
            const daysArg = parseInt(args[0]); const messagesArg = parseInt(args[1]); let verifiedCount = 0;
            const annCh = message.guild.channels.cache.find(ch => ch.name === config.announcementChannelName);
            await message.guild.members.fetch(); let membersToVerify = [];
            if (args.length === 0) membersToVerify = message.guild.members.cache.filter(m => !m.user.bot && botData.users[m.id] && !botData.users[m.id].isVerified && client.newMemberRole && m.roles.cache.has(client.newMemberRole.id)).map(m=>m);
            else if (!isNaN(daysArg) && !isNaN(messagesArg) && daysArg >= 0 && messagesArg >= 0) {
                const reqJoinT = Date.now()-(daysArg*86400000);
                membersToVerify = message.guild.members.cache.filter(m => !m.user.bot && botData.users[m.id] && !botData.users[m.id].isVerified && client.newMemberRole && m.roles.cache.has(client.newMemberRole.id) && (botData.users[m.id].joinTimestamp && botData.users[m.id].joinTimestamp <= reqJoinT) && (botData.users[m.id].verificationMessages || 0) >= messagesArg).map(m=>m);
            } else return message.reply("Usage: `!allow` or `!allow <days_member> <min_messages>`").catch(console.error);
            if(membersToVerify.length === 0) return message.reply("No members found matching criteria.").catch(console.error);
            await message.reply(`Verifying ${membersToVerify.length} member(s)...`).catch(console.error);
            for(const m of membersToVerify) { if(await isModerator(m)) continue; try { if(client.verifiedMemberRole) await m.roles.add(client.verifiedMemberRole); if(client.newMemberRole) await m.roles.remove(client.newMemberRole).catch(e=>console.warn(`Allow: Failed to remove new role from ${m.user.tag}: ${e.message}`)); botData.users[m.id].isVerified=true; verifiedCount++; if(annCh) annCh.send(`✅ ${m.user.tag} (<@${m.id}>) manually verified by ${message.author.tag}.`).catch(console.error); } catch(e){console.error(`!allow verify error for ${m.user.tag}:`,e);}} saveData(); message.channel.send(`Verified ${verifiedCount} member(s).`).catch(console.error);
        }
        else if (command === "deny" && memberIsModerator) {
            if (!client.newMemberRole) return message.reply("New Member role not found/configured.").catch(console.error);
            const daysArg = parseInt(args[0]); const messagesArg = parseInt(args[1]);
            if(isNaN(daysArg)||isNaN(messagesArg)||daysArg<0||messagesArg<0) return message.reply("Usage: `!deny <min_days_member> <max_messages>`").catch(console.error);
            const reqJoinT = Date.now()-(daysArg*86400000); let kickedCount=0;
            const annCh = message.guild.channels.cache.find(ch=>ch.name===config.announcementChannelName);
            await message.guild.members.fetch();
            const membersToKick = message.guild.members.cache.filter(m=>!m.user.bot&&botData.users[m.id]&&!botData.users[m.id].isVerified&&client.newMemberRole&&m.roles.cache.has(client.newMemberRole.id)&&(botData.users[m.id].joinTimestamp&&botData.users[m.id].joinTimestamp<=reqJoinT)&&(botData.users[m.id].verificationMessages||0)<=messagesArg).map(m=>m);
            if(membersToKick.length===0) return message.reply("No members found matching criteria.").catch(console.error);
            await message.reply(`Found ${membersToKick.length}. Kicking...`).catch(console.error);
            for(const m of membersToKick){ if(await isModerator(m))continue; try{await m.kick(`Denied by ${message.author.tag}: Member for ${daysArg}d, <=${messagesArg} messages.`);kickedCount++; if(annCh)annCh.send(`👢 ${m.user.tag} (<@${m.id}>) kicked by ${message.author.tag} (denied: ${daysArg}d, <=${messagesArg}m).`).catch(console.error);delete botData.users[m.id];}catch(e){console.error(`!deny kick error for ${m.user.tag}:`,e);}} saveData(); message.channel.send(`Kicked ${kickedCount} member(s).`).catch(console.error);
        }
        else if (command === "kickpollinactive" && memberIsModerator) {
            const daysSilentArg = parseInt(args[0]); const silentThreshold = daysSilentArg || parseInt(config.kickPollSilentDaysThreshold) || 30;
            if(isNaN(silentThreshold)||silentThreshold<=0) return message.reply(`Usage: \`!kickpollinactive [days]\` (default: ${config.kickPollSilentDaysThreshold || 30} days). Value must be a positive number.`).catch(console.error);
            const guild = message.guild; const annCh = guild.channels.cache.find(ch=>ch.name===config.announcementChannelName);
            if(!annCh)return message.reply(`Announcement channel "${config.announcementChannelName}" not found.`).catch(console.error);
            const silentTimestampCutoff = Date.now()-(silentThreshold*86400000); let pollCount=0; await guild.members.fetch();const membersToPoll=[];
            for(const m of guild.members.cache.values()){ if(m.user.bot||await isModerator(m))continue;const ud=botData.users[m.id]; if(ud&&((ud.lastMessageTimestamp&&ud.lastMessageTimestamp<silentTimestampCutoff)||(!ud.lastMessageTimestamp&&ud.joinTimestamp&&ud.joinTimestamp<silentTimestampCutoff))) membersToPoll.push(m);}
            if(membersToPoll.length===0) return message.reply(`No non-moderator members found inactive for more than ${silentThreshold} days in #${config.activityChannelName}.`).catch(console.error);
            await message.reply(`Found ${membersToPoll.length} inactive member(s). Starting kick polls in #${annCh.name}...`).catch(console.error);
            for(const m of membersToPoll){await createKickPoll(guild,annCh,m.id,m.user.username,`Silent for >${silentThreshold} days in #${config.activityChannelName || 'designated activity channel'}`);pollCount++;} message.channel.send(`Initiated ${pollCount} kick polls. Check #${annCh.name}.`).catch(console.error);
        }
        else if (command === "roles" && memberIsModerator) {
            await message.channel.sendTyping();const guild = message.guild; await guild.members.fetch();
            const membersWRoles = guild.members.cache.filter(m=>!m.user.bot).map(m=>({name:m.displayName,value:m.roles.cache.filter(r=>r.id!==guild.id).map(r=>r.name).join(', ')||"No roles"})).sort((a,b)=>a.name.localeCompare(b.name));
            if(membersWRoles.length===0) return message.reply("No non-bot members found.").catch(console.error);
            const embeds=[];const usersPerE=15;
            for(let i=0;i<membersWRoles.length;i+=usersPerE){const ch=membersWRoles.slice(i,i+usersPerE);const e=new EmbedBuilder().setColor(0x00FFFF).setTitle(`Member Roles (Page ${Math.floor(i/usersPerE)+1})`);ch.forEach(it=>e.addFields({name:it.name,value:it.value.substring(0,1020),inline:false}));embeds.push(e);}
            for(const e of embeds){await message.channel.send({embeds:[e]});if(embeds.length>1)await new Promise(r=>setTimeout(r,1000));}
        }
        else if (command === "watchpoll" && memberIsModerator) {
            if (args.length === 0) return message.reply("Usage: `!watchpoll <criteria>` (e.g., `7` for last 7 days, `~5` for last 5 links, `mm/dd/yyyy` for a specific date).").catch(console.error);
            await createYoutubeWatchPoll(message.channel, args[0], message.channel.id, message);
        }
        else if (command === "allpoll" && memberIsModerator) {
            if (args.length === 0) return message.reply("Usage: `!allpoll <criteria>` (e.g., `7` for last 7 days, `~5` for last 5 links, `mm/dd/yyyy` for a specific date).").catch(console.error);
            await createYoutubeWatchPoll(message.channel, args[0], null, message);
        }
        else if ((command === "vids" || command === "listvids") && memberIsModerator) {
            if (args.length === 0) return message.reply("Usage: `!vids <criteria>` (e.g., `7` for last 7 days, `~5` for last 5 links, `mm/dd/yyyy` for a specific date).").catch(console.error);
            await listYoutubeVideos(message.channel, args[0], message.channel.id, message);
        }
        else if (command === "allvids" && memberIsModerator) {
            if (args.length === 0) return message.reply("Usage: `!allvids <criteria>` (e.g., `7` for last 7 days, `~5` for last 5 links, `mm/dd/yyyy` for a specific date).").catch(console.error);
            await listYoutubeVideos(message.channel, args[0], null, message);
        }
        else if (command === "set" && memberIsModerator) {
            const settableKeys = Object.keys(config).filter(key => !['token','guildId','youtubeApiKey','geminiApiKey'].includes(key));
            if(args.length===0){const e=new EmbedBuilder().setTitle("🔧 Configurable Settings").setColor(0x00FF00);let d="Use `!set <setting> <value>`.\nSome changes may require a bot restart to fully apply (e.g., role name changes if not re-cached by this command).\n\n";if(settableKeys.length>0)settableKeys.forEach(k=>{d+=`**${k}**: \`${JSON.stringify(config[k])}\` (Type: ${typeof config[k]})\n`;});else d+="No modifiable settings found.";e.setDescription(d.substring(0,4090));return message.channel.send({embeds:[e]}).catch(console.error);}
            const settingName=args[0];const newValueRaw=args.slice(1).join(" ");
            if(!settableKeys.includes(settingName)) return message.reply(`"${settingName}" is not a modifiable setting or does not exist. Use \`!set\` to see available settings.`).catch(console.error);
            if(args.length<2&&typeof config[settingName]!=='boolean') return message.reply(`Please provide a new value for "${settingName}". Current value: \`${JSON.stringify(config[settingName])}\``).catch(console.error);
            const originalType = typeof config[settingName];
            try { let parsedValue;
                if(originalType==='number'){parsedValue=parseFloat(newValueRaw);if(isNaN(parsedValue))throw new Error("Invalid input: Not a valid number.");}
                else if(originalType==='boolean'){if(args.length<2)parsedValue=!config[settingName];else if(newValueRaw.toLowerCase()==='true')parsedValue=true;else if(newValueRaw.toLowerCase()==='false')parsedValue=false;else throw new Error("Invalid input for boolean: Use 'true' or 'false'.");}
                else if (originalType === 'object' && Array.isArray(config[settingName])) { // Handle array type for reactionRoles
                    try { parsedValue = JSON.parse(newValueRaw); if (!Array.isArray(parsedValue)) throw new Error("Value must be a valid JSON array.");}
                    catch (jsonErr) { throw new Error("Invalid JSON array format for this setting."); }
                }
                else {if(args.length<2)return message.reply(`Please provide a value for string setting "${settingName}".`).catch(console.error);parsedValue=newValueRaw;}
                
                const oldV = JSON.stringify(config[settingName]); config[settingName]=parsedValue; fs.writeFileSync(CONFIG_PATH,JSON.stringify(config,null,2)); 
                console.log(`[Config Set] ${message.author.tag} changed '${settingName}' from ${oldV} to '${JSON.stringify(parsedValue)}'`);
                
                const criticalSchedulerSettings = ['autoPollVideoCronTime','autoPollVideoDaysPast','cronTimezone','dailyAnnouncementTime','scanIntervalDays','verificationPollDays'];
                const roleNameSettings = ['moderatorRoleName', 'verifiedMemberRoleName', 'newMemberRoleName', 'rolesChannelName'];

                if(criticalSchedulerSettings.includes(settingName)){
                    console.log(`Config "${settingName}" changed, rescheduling tasks.`);
                    scheduleTasks();
                }
                if(roleNameSettings.includes(settingName) || settingName === 'reactionRoles' || settingName === 'rolesChannelMessageID' || settingName === 'translateEmoji' || settingName === 'translateToLanguage'){
                    console.log(`Config "${settingName}" changed. Bot may need restart for full effect or re-caching relevant objects.`);
                    const guild = client.guilds.cache.get(config.guildId);
                    if (guild) {
                        if (settingName === 'newMemberRoleName') client.newMemberRole = guild.roles.cache.find(role => role.name === config.newMemberRoleName);
                        if (settingName === 'verifiedMemberRoleName') client.verifiedMemberRole = guild.roles.cache.find(role => role.name === config.verifiedMemberRoleName);
                        if (!client.newMemberRole && settingName === 'newMemberRoleName') console.warn(`!set: New Member Role "${config.newMemberRoleName}" still not found after update!`);
                        if (!client.verifiedMemberRole && settingName === 'verifiedMemberRoleName') console.warn(`!set: Verified Member Role "${config.verifiedMemberRoleName}" still not found after update!`);
                    }
                }
                message.reply(`✅ Setting "${settingName}" updated to \`${JSON.stringify(parsedValue)}\`.`).catch(console.error);
            } catch(e){message.reply(`❌ Error setting "${settingName}": ${e.message}. Expected type: ${originalType}.`).catch(console.error);}
        }
    }
});

// --- YouTube Watch Poll Creation & Listing Functions ---
function getFilteredYoutubeLinks(criteria, targetChannelId = null) {
    let filteredLinks = []; const now = Date.now(); let criteriaDescription = ""; let initialFilter = [];
    if(criteria.startsWith('~')){const c=parseInt(criteria.substring(1));if(isNaN(c)||c<=0)return{error:"Invalid count for `~N` criteria. Must be a positive number."};initialFilter=[...botData.youtubeLinks].reverse();criteriaDescription=`Last ~${c} unique links`;}
    else if(criteria.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)){const p=criteria.split('/');const s=new Date(parseInt(p[2]),parseInt(p[0])-1,parseInt(p[1]));const e=new Date(s);e.setHours(23,59,59,999);if(isNaN(s.getTime()))return{error:"Invalid date format. Use `mm/dd/yyyy`."};initialFilter=botData.youtubeLinks.filter(l=>l.timestamp>=s.getTime()&&l.timestamp<=e.getTime());criteriaDescription=`Videos from ${criteria}`;}
    else{const d=parseInt(criteria);if(isNaN(d)||d<=0)return{error:"Invalid number of days. Must be a positive number."};const cut=now-(d*86400000);initialFilter=botData.youtubeLinks.filter(l=>l.timestamp>=cut);criteriaDescription=`Videos from Last ${d} Day(s)`;}
    
    if(targetChannelId){initialFilter=initialFilter.filter(l=>l.channelId===targetChannelId);criteriaDescription+=` in this channel`;}else{criteriaDescription+=` from all channels`;}
    
    const uniqueUrls=new Map();
    const processingOrder = criteria.startsWith('~') ? initialFilter : [...initialFilter].sort((a, b) => b.timestamp - a.timestamp); 
    
    processingOrder.forEach(l=>{if(!uniqueUrls.has(l.url))uniqueUrls.set(l.url,l);});
    
    let resultLinks=Array.from(uniqueUrls.values());
    if(criteria.startsWith('~')){const count=parseInt(criteria.substring(1));resultLinks=resultLinks.slice(0,count);}
    
    filteredLinks=resultLinks.sort((a,b)=>a.timestamp-b.timestamp);
    return{links:filteredLinks,description:criteriaDescription};
}

async function createYoutubeWatchPoll(channel, criteria, targetChannelIdForFilter = null, originalMessage = null, isAuto = false) {
    const { links: linksToConsider, description: criteriaDescription, error: filterError } = getFilteredYoutubeLinks(criteria, targetChannelIdForFilter);
    if(filterError){if(originalMessage)originalMessage.reply(filterError).catch(console.error);else if(channel) channel.send(filterError).catch(console.error);return;}
    if(linksToConsider.length===0){const m=`No YouTube videos found matching criteria: ${criteriaDescription}.`;if(isAuto && channel)channel.send(m).catch(console.error);else if(originalMessage)originalMessage.reply(m).catch(console.error);return;}
    
    const linksForThisPoll=linksToConsider.slice(-MAX_POLL_OPTIONS);
    let actualPollDurHours=parseFloat(config.watchPollDurationHours)||12;
    actualPollDurHours=Math.max(1/60,Math.min(actualPollDurHours,7*24));
    
    let introMsg=`🎬 **YouTube Watch Poll!** Based on: ${criteriaDescription}`;
    if(isAuto)introMsg=`🗓️ **Automated YouTube Watch Poll!** Based on: ${criteriaDescription}`;
    else if(originalMessage)introMsg+=` (Requested by ${originalMessage.author.tag})`;
    
    await channel.send(introMsg).catch(console.error);
    
    const pollQuestionText=`Vote: Which video should we watch?`;
    const pollAnswers=linksForThisPoll.map(link=>{
        let title = link.title || "Untitled YouTube Video";
        const maxPollOptionLength = 55; // Discord Poll Option Limit (updated)
        if(title.length > maxPollOptionLength) title = title.substring(0,maxPollOptionLength-3)+"...";
        return {text: title};
    });
    
    if(pollAnswers.length===0) {
        if(originalMessage) originalMessage.reply("Strangely, no poll options could be generated from the filtered videos.").catch(console.error);
        else if (channel) channel.send("Strangely, no poll options could be generated from the filtered videos.").catch(console.error);
        return;
    }
    if(pollAnswers.length===1) pollAnswers.push({text:"(No other distinct options found / Skip vote)"});
    
    try{
        await channel.send({poll:{question:{text:pollQuestionText},answers:pollAnswers,duration:actualPollDurHours,allowMultiselect:false}});
        console.log(`Created YouTube watch poll in #${channel.name}. Criteria: ${criteriaDescription}, ${linksForThisPoll.length} options.`);
    }
    catch(e){
        console.error(`Failed to create YouTube watch poll in #${channel.name}:`,e);
        channel.send(`Error creating poll. Discord API Error: ${e.message.substring(0,500)}`).catch(console.error);
    }
}

async function listYoutubeVideos(channel, criteria, targetChannelIdForFilter = null, originalMessage = null) {
    const { links: linksToList, description: criteriaDescription, error: filterError } = getFilteredYoutubeLinks(criteria, targetChannelIdForFilter);
    if(filterError){if(originalMessage)originalMessage.reply(filterError).catch(console.error); else if(channel) channel.send(filterError).catch(console.error); return;}
    if(linksToList.length===0){const m=`No YouTube videos found matching criteria: ${criteriaDescription}.`; if(originalMessage)originalMessage.reply(m).catch(console.error); else if(channel) channel.send(m).catch(console.error); return;}
    
    const embeds=[];const videosPerEmbed=10;
    for(let i=0;i<linksToList.length;i+=videosPerEmbed){
        const chunk=linksToList.slice(i,i+videosPerEmbed);
        const embed=new EmbedBuilder().setColor(0xFFC300).setTitle(`🎬 YouTube Video List (${criteriaDescription})`).setDescription(`Page ${Math.floor(i/videosPerEmbed)+1}/${Math.ceil(linksToList.length/videosPerEmbed)}`).setTimestamp();
        chunk.forEach(link=>{
            const postedBy=link.authorTag?`by ${link.authorTag}`:"";
            const postedWhen=link.timestamp?`(${formatTimeAgo(link.timestamp)})`:"";
            const originalChannel=targetChannelIdForFilter?"":` in <#${link.channelId}>`;
            embed.addFields({name:(link.title||"Untitled YouTube Video").substring(0,250),value:`[Watch Video](${link.url})\nPosted ${postedBy} ${postedWhen}${originalChannel}`,inline:false});
        });
        embeds.push(embed);
    }
    try{
        for(const emb of embeds){
            if(originalMessage)await originalMessage.channel.send({embeds:[emb]});
            else await channel.send({embeds:[emb]});
            if(embeds.length>1)await new Promise(r=>setTimeout(r,1000));
        }
    }
    catch(err){
        console.error("Failed to send YouTube video list embed:",err);
        if(originalMessage)originalMessage.reply("An error occurred while trying to display the video list.").catch(console.error);
        else if(channel) channel.send("An error occurred while trying to display the video list.").catch(console.error);
    }
}

// --- Scans & Polls (Verification, Kick Pruning) ---
async function performActivityScan() {
    console.log("Starting activity scan (for kick pruning)...");
    const guild = client.guilds.cache.get(config.guildId); if (!guild) return console.error("Guild not found for activity scan.");
    const annCh = guild.channels.cache.find(ch => ch.name === config.announcementChannelName); if (!annCh) return console.error(`Announcement channel "${config.announcementChannelName}" not found for activity scan.`);
    await annCh.send(`📢 **Pruning Scan Started!** Checking message counts for non-moderators. Users with fewer than ${config.messageThreshold} messages in #${config.activityChannelName} over the last ${config.scanIntervalDays} days may be polled for removal.`).catch(console.error);
    const inactiveUIDs = [];
    await guild.members.fetch();

    for (const uid in botData.users) {
        const member = guild.members.cache.get(uid);
        if (!member) { delete botData.users[uid]; continue; }
        if (await isModerator(member)) continue;

        if ((botData.users[uid].messageCount || 0) < config.messageThreshold) {
            inactiveUIDs.push(uid);
        }
    }
    if (inactiveUIDs.length === 0) await annCh.send("✅ All non-moderator members meet the activity criteria for this pruning scan!").catch(console.error);
    else { await annCh.send(`🔍 Found ${inactiveUIDs.length} user(s) with activity below threshold (fewer than ${config.messageThreshold} messages). Initiating kick polls in this channel...`).catch(console.error); for (const uid of inactiveUIDs) await createKickPoll(guild, annCh, uid, botData.users[uid].username, `Low activity: ${botData.users[uid].messageCount||0} messages (threshold: ${config.messageThreshold}) in #${config.activityChannelName} over ~${config.scanIntervalDays} days.`);}
    
    console.log("Resetting message counts (for pruning scan)..."); for (const uid in botData.users) { if (botData.users[uid]) botData.users[uid].messageCount = 0; }
    botData.lastScanTimestamp = Date.now(); saveData(); console.log("Pruning activity scan completed."); await annCh.send(`🏁 Pruning scan completed. Message counts for this period have been reset. Next scan in ~${config.scanIntervalDays} days.`).catch(console.error);
}

async function performVerificationScan() {
    console.log("Starting new member verification scan...");
    const guild = client.guilds.cache.get(config.guildId); if (!guild) return console.error("Guild not found for verification scan.");
    const verPollCh = guild.channels.cache.find(ch => ch.name === config.verificationPollChannelName); if (!verPollCh) return console.error(`Verification poll channel "${config.verificationPollChannelName}" not found.`);
    await verPollCh.send(`📢 **New Member Verification Scan Started!** Checking members who joined more than ${config.verificationPollDays} days ago and have sent at least ${config.verificationMessageThreshold} messages in #${config.activityChannelName}.`).catch(console.error);
    const eligibleForPoll = []; const verificationPeriodMs = (parseFloat(config.verificationPollDays) || 7) * 86400000;
    await guild.members.fetch();

    for (const uid in botData.users) {
        const userData = botData.users[uid];
        const member = guild.members.cache.get(uid);
        if (!member || userData.isVerified || await isModerator(member) || !userData.joinTimestamp) continue;

        if ((Date.now() - userData.joinTimestamp >= verificationPeriodMs) && (userData.verificationMessages || 0) >= config.verificationMessageThreshold) {
            eligibleForPoll.push(uid);
        }
    }
    if (eligibleForPoll.length === 0) await verPollCh.send("✅ No new members currently meet the criteria for a verification poll.").catch(console.error);
    else { await verPollCh.send(`🔍 Found ${eligibleForPoll.length} unverified member(s) eligible for a verification poll. Initiating polls in this channel...`).catch(console.error); for (const uid of eligibleForPoll) await createVerificationPoll(guild, verPollCh, uid, botData.users[uid].username); }
    
    botData.lastVerificationScanTimestamp = Date.now(); saveData(); console.log("New member verification scan completed.");
}

async function createKickPoll(guild, channel, userId, username, reason = `Low activity`) {
    const member = await guild.members.fetch(userId).catch(() => null); 
    if (!member) { 
        if(botData.users[userId]) delete botData.users[userId]; saveData(); 
        console.log(`[KickPoll] User ${username} (ID: ${userId}) not found in guild, removing data.`);
        return; 
    }
    if (await isModerator(member) || member.id === client.user.id || member.id === guild.ownerId) {
        console.log(`[KickPoll] Skipped poll for ${member.user.tag} (Mod/Bot/Owner).`);
        return;
    }
    if (guild.members.me && member.roles.highest.position >= guild.members.me.roles.highest.position) { 
        await channel.send(`⚠️ Cannot create kick poll for ${member.user.tag} as their highest role is higher than or equal to my highest role. Please adjust role hierarchy or permissions.`).catch(console.error); 
        return; 
    }

    const pollEmbed = new EmbedBuilder().setColor(0xFF0000).setTitle(`🛡️ Kick Poll: ${username}`)
        .setDescription(`Member: ${member.user.tag} (<@${member.id}>).\nReason for poll: **${reason}**.\n\nVote to decide if this member should be kicked from the server.`)
        .addFields({ name: 'Voting Options', value: '✅ **Yes** (Kick the member)\n❌ **No** (Keep the member)' })
        .setFooter({ text: `Poll runs for ${config.pollDurationHours} hours. A ${config.pollPassThreshold*100}% 'Yes' majority (of cast votes) is needed to pass.` }).setTimestamp();
    try {
        const pollMessage = await channel.send({ embeds: [pollEmbed] }); 
        await pollMessage.react('✅'); await pollMessage.react('❌');
        
        const collectorFilter = (reaction, user) => ['✅', '❌'].includes(reaction.emoji.name) && !user.bot;
        const collector = pollMessage.createReactionCollector({ filter: collectorFilter, time: (parseFloat(config.pollDurationHours) || 24) * 3600000 });
        
        collector.on('end', async collected => {
            const yesVotes = (collected.get('✅')?.count || 1) - 1;
            const noVotes = (collected.get('❌')?.count || 1) - 1;
            let resultText = `Kick poll for ${member.user.tag} (Reason: ${reason}) has concluded.\n\nVotes:\n✅ Yes (Kick): ${yesVotes}\n❌ No (Keep): ${noVotes}\n\n`;
            
            const currentMemberState = await guild.members.fetch(userId).catch(()=>null); 
            if(!currentMemberState){
                resultText+=`**Outcome:** ${member.user.tag} has already left the server.`; 
                if(botData.users[userId]) delete botData.users[userId]; saveData(); 
                await channel.send(resultText).catch(console.error);return;
            }

            if(yesVotes + noVotes === 0) resultText+="**Outcome:** No votes were cast by members. Member will not be kicked.";
            else if(yesVotes / (yesVotes + noVotes) >= config.pollPassThreshold && yesVotes > noVotes){
                resultText+=`**Outcome: PASS!** Member will be kicked.`;
                try{
                    await member.kick(`Kicked via poll. Reason: ${reason}. Votes: ${yesVotes} Yes, ${noVotes} No.`);
                    resultText+=`\n✅ ${member.user.tag} has been successfully kicked.`;
                    if(botData.users[userId]) delete botData.users[userId];saveData();
                }catch(e){
                    resultText+=`\n⚠️ Failed to kick ${member.user.tag}: ${e.message}. This might be due to permissions or role hierarchy.`;
                    console.error(`[KickPoll] Failed to kick ${member.user.tag}:`, e);
                }
            } else resultText+=`**Outcome: FAIL.** Member will not be kicked.`;
            
            await channel.send(resultText).catch(console.error);
        });
    } catch (e) { console.error(`[KickPoll] Error creating kick poll for ${username}:`, e); channel.send(`Error creating kick poll for ${username}: ${e.message.substring(0,200)}`).catch(console.error); }
}

async function createVerificationPoll(guild, channel, userId, username) {
    const member = await guild.members.fetch(userId).catch(()=>null); 
    if(!member) {
        console.log(`[VerifyPoll] User ${username} (ID: ${userId}) not found for verification poll.`);
        return;
    }
    if(await isModerator(member) || (botData.users[userId]?.isVerified)) {
        console.log(`[VerifyPoll] Skipped poll for ${member.user.tag} (already Mod or Verified).`);
        return;
    }
    const userData = botData.users[userId]; if (!userData) {
        console.log(`[VerifyPoll] No user data found for ${username} (ID: ${userId}). Cannot create poll.`);
        return;
    }
    
    const pollEmbed = new EmbedBuilder().setColor(0x00FF00).setTitle(`✅ Verification Poll: ${username}`)
        .setDescription(`Member: ${member.user.tag} (<@${member.id}>) joined ${formatTimeAgo(userData?.joinTimestamp)} and has **${userData?.verificationMessages||0}** messages in #${config.activityChannelName} (requires ${config.verificationMessageThreshold} messages over ${config.verificationPollDays} days).\n\nVote to grant this member the "${config.verifiedMemberRoleName}" role and full server access.`)
        .addFields({ name: 'Voting Options', value: '✅ **Yes** (Verify member)\n❌ **No** (Do not verify)' })
        .setFooter({text:`Poll runs for ${config.verificationPollDurationHours} hours. A ${config.verificationPollPassThreshold*100}% 'Yes' majority (of cast votes) is needed to pass.`}).setTimestamp();
    try {
        const pollMessage = await channel.send({embeds:[pollEmbed]}); 
        await pollMessage.react('✅'); await pollMessage.react('❌');
        
        const collectorFilter = (reaction, user) => ['✅','❌'].includes(reaction.emoji.name)&&!user.bot;
        const collector = pollMessage.createReactionCollector({filter: collectorFilter, time:(parseFloat(config.verificationPollDurationHours)||24)*3600000});
        
        collector.on('end', async collected => {
            const yesVotes = (collected.get('✅')?.count || 1) - 1;
            const noVotes = (collected.get('❌')?.count || 1) - 1;
            let resultText=`Verification poll for ${member.user.tag} has concluded.\n\nVotes:\n✅ Yes (Verify): ${yesVotes}\n❌ No (Do Not Verify): ${noVotes}\n\n`;
            
            const currentMemberState = await guild.members.fetch(userId).catch(()=>null); 
            if(!currentMemberState){
                resultText+=`**Outcome:** ${member.user.tag} has already left the server.`; 
                await channel.send(resultText).catch(console.error);return;
            }
            if(botData.users[userId]?.isVerified){
                 resultText+=`**Outcome:** ${member.user.tag} was already verified (possibly manually during the poll). No action taken from this poll.`;
                 await channel.send(resultText).catch(console.error); return;
            }

            if(yesVotes + noVotes === 0) resultText+="**Outcome:** No votes were cast by members. Member will not be verified.";
            else if(yesVotes / (yesVotes + noVotes) >= config.verificationPollPassThreshold && yesVotes > noVotes){
                resultText+=`**Outcome: PASS!** Member will be verified.`;
                try {
                    if(client.verifiedMemberRole) await currentMemberState.roles.add(client.verifiedMemberRole);
                    else resultText+=`\n⚠️ Verified Member Role ("${config.verifiedMemberRoleName}") not found. Cannot assign.`;

                    if(client.newMemberRole) await currentMemberState.roles.remove(client.newMemberRole).catch(e => console.warn(`[VerifyPoll] Failed to remove new member role ("${config.newMemberRoleName}") from ${member.user.tag}: ${e.message}`)); 
                    
                    botData.users[userId].isVerified=true; saveData();
                    resultText+=`\n✅ ${member.user.tag} has been verified and granted appropriate roles.`;
                } catch (e) {
                    resultText+=`\n⚠️ An error occurred while updating roles for ${member.user.tag}: ${e.message}.`;
                    console.error(`[VerifyPoll] Role update error for ${member.user.tag}:`, e);
                }
            }else resultText+=`**Outcome: FAIL.** Member will not be verified at this time. They may become eligible again later.`;
            
            await channel.send(resultText).catch(console.error);
        });
    } catch (e) { console.error(`[VerifyPoll] Error creating verification poll for ${username}:`, e); channel.send(`Error creating verification poll for ${username}: ${e.message.substring(0,200)}`).catch(console.error); }
}

// --- LOGIN ---
if (!config.token || !config.guildId) {
    console.error("CRITICAL: Bot token or guildId is not configured properly in " + CONFIG_PATH);
    process.exit(1);
}
client.login(config.token).catch(err => {
    console.error("Failed to login to Discord:", err);
    process.exit(1);
});

// Global error handlers
process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});
process.on('uncaughtException', error => {
    console.error('Uncaught exception:', error);
});
