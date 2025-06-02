# Discord Moderation & Utility Bot

This Discord bot provides a suite of moderation tools, utility commands, activity tracking, automated polling, and AI integrations for your server.

## Features

*   **Activity Tracking**: Monitors user messages in a designated channel to help with verification and pruning.
*   **Automated Verification**:
    *   New members are assigned a "Guest" role.
    *   After meeting message count and server tenure thresholds, a poll is started to grant them a "Verified" role.
*   **Automated Pruning**:
    *   Periodically scans user activity.
    *   Initiates kick polls for users below a message threshold or those inactive for a set duration.
*   **YouTube Watch Polls**:
    *   Logs YouTube links posted in the server.
    *   Allows manual creation of polls for videos from specific channels or all channels based on criteria (age, count).
    *   Automated weekly polls for recently shared videos.
    *   Daily announcements for upcoming watch events.
*   **Knowledge Repository**:
    *   Copies messages to a designated "repository" channel based on:
        *   A specific "troll" emoji reaction.
        *   A threshold of reactions from Verified/Moderator users.
*   **Reaction Roles**:
    *   Allows users to self-assign roles by reacting to a specific message.
    *   Announces when a user joins a role group.
*   **Tagging System**: Verified users and moderators can create, remove, and display simple key-value tags.
*   **AI Integration (Google Gemini)**:
    *   `!positivity` command for uplifting messages.
    *   `!ai <prompt>` command for general AI responses.
*   **Moderator Commands**: Includes manual verification/denial, role display, config management, and more.
*   **Configurable**: Most features are configurable via `config.json`.

## Setup

1.  **Clone the Repository**:
    ```bash
    git clone <your-repo-url>
    cd <your-repo-name>
    ```
2.  **Install Dependencies**:
    ```bash
    npm install
    ```
3.  **Configure the Bot**:
    *   Rename `config.example.json` to `config.json`.
    *   Fill in the `config.json` with your server's specific details, API keys, and role/channel names. See the "Configuration (`config.json`)" section below for details on each option.
    *   **Crucial**:
        *   Set your `token` (Discord Bot Token).
        *   Set your `guildId` (Your Discord Server ID).
        *   If using Reaction Roles, create the roles in Discord, post a message in your `rolesChannelName`, copy its ID, and put it in `rolesChannelMessageID`.
4.  **Create Roles and Channels**:
    *   Ensure all roles mentioned in `config.json` (e.g., `moderatorRoleName`, `newMemberRoleName`, `verifiedMemberRoleName`, reaction roles) exist in your Discord server.
    *   Ensure the bot's role is placed higher in the role hierarchy than any roles it needs to manage (assign/remove).
    *   Ensure all channels mentioned (e.g., `activityChannelName`, `announcementChannelName`, `verificationPollChannelName`, `autoPollVideoChannelName`, `knowledgeCopyToChannelName`, `rolesChannelName`, individual reaction role `announceChannelName`s) exist.
5.  **Permissions**:
    *   The bot requires appropriate permissions to function. Key permissions include:
        *   `View Channels`, `Send Messages`, `Embed Links`, `Attach Files`, `Read Message History` (in relevant channels)
        *   `Manage Roles`
        *   `Kick Members`
        *   `Add Reactions`
        *   `Administrator` (can simplify setup but grant with caution).
6.  **Run the Bot**:
    ```bash
    node bot.js
    ```
    Or, if you prefer, using a process manager like PM2:
    ```bash
    pm2 start bot.js --name "my-discord-bot"
    ```

## Commands

### Public Commands

*   `!activity`: Shows a report of user activity in the designated `activityChannelName`.
*   `!watch`: Shows the time until the next scheduled YouTube video poll.
*   `!positivity`: Get an uplifting positive message from the AI (if Gemini API is configured).
*   `!commands` / `!help`: Shows this help message.
*   `!ai <prompt>`: Sends your `<prompt>` to the AI and gets a response (if Gemini API is configured).

### Tagging System (Requires Verified/Moderator role)

*   `+tagName <value>`: Adds or updates a tag. (Prefix configurable via `tagAddPrefix`)
*   `-tagName`: Removes a tag. (Prefix configurable via `tagRemovePrefix`)
*   `~tagName`: Shows a specific tag. (Prefix configurable via `tagShowPrefix`)
*   `~`: Lists all available tags. (Prefix configurable via `tagShowPrefix`)

### Moderator Commands (Requires Moderator role or Administrator permission)

*   `!allow [days_member messages_count]`: Manually verifies members. With no arguments, verifies all eligible "New Members". With arguments, verifies members who joined at least `days_member` ago and have at least `messages_count`.
*   `!deny <days_member> <max_messages>`: Kicks unverified "New Members" who joined at least `days_member` ago and have `max_messages` or fewer.
*   `!kickpollinactive [days_silent]`: Initiates kick polls for users silent for `[days_silent]` (defaults to `kickPollSilentDaysThreshold`).
*   `!roles`: Displays the roles of all non-bot members.
*   `!watchpoll <criteria>`: Creates a poll for YouTube videos posted in *the current channel*.
    *   Criteria: `N` (number of days ago), `~N` (last N unique links), `mm/dd/yyyy` (specific date).
*   `!allpoll <criteria>`: Creates a poll for YouTube videos posted in *any channel*. Criteria are the same as `!watchpoll`.
*   `!vids <criteria>`: Lists YouTube videos from *the current channel*. Criteria are the same as `!watchpoll`.
*   `!allvids <criteria>`: Lists YouTube videos from *any channel*. Criteria are the same as `!watchpoll`.
*   `!set [setting_name] [new_value]`: Views or updates a bot configuration setting.
    *   `!set`: Lists all modifiable settings and their current values.
    *   `!set <setting_name> <new_value>`: Updates the specified setting. Some changes may require a bot restart.

## Configuration (`config.json`)

Below is an explanation of each option available in the `config.json` file.

*   `token`: **(Required)** Your Discord Bot's unique token. **Keep this secret!**
*   `prefix`: The prefix for bot commands (e.g., "!" results in `!help`).
*   `guildId`: **(Required)** The ID of the Discord server (guild) this bot will operate in.
*   `activityChannelName`: The name of the channel where user activity (messages) is primarily tracked for verification and pruning scans.
*   `announcementChannelName`: The name of the channel used for general bot announcements, such as scan starts/completions, manual verifications/kicks.
*   `moderatorRoleName`: The exact name of the role that grants moderator privileges for bot commands.
*   `messageThreshold`: The minimum number of messages a user must send in the `activityChannelName` within a `scanIntervalDays` period to not be considered for pruning due to low activity.
*   `scanIntervalDays`: How often (in days) the bot scans for inactive users to potentially prune.
*   `pollDurationHours`: Default duration (in hours) for kick polls and other general polls.
*   `pollPassThreshold`: The minimum percentage (0.0 to 1.0) of "Yes" votes required for a poll to pass (e.g., 0.6 for 60%).
*   `kickPollSilentDaysThreshold`: The number of days a user must be silent (no messages in `activityChannelName`) to be considered for a kick poll by the `!kickpollinactive` command or automated silent user pruning (if implemented).
*   `newMemberRoleName`: The name of the role automatically assigned to new members joining the server.
*   `verifiedMemberRoleName`: The name of the role granted to members after passing the verification process.
*   `verificationPollDays`: The minimum number of days a new member must be in the server before being eligible for an automated verification poll.
*   `verificationMessageThreshold`: The minimum number of messages a new member must send in the `activityChannelName` to be eligible for an automated verification poll.
*   `verificationPollChannelName`: The name of the channel where automated verification polls are posted.
*   `verificationPollDurationHours`: Duration (in hours) for verification polls.
*   `verificationPollPassThreshold`: Pass threshold (0.0 to 1.0) for verification polls.
*   `youtubeLinkHistoryDays`: How many days of YouTube link history the bot should keep for polling purposes. Older links are pruned.
*   `watchPollDurationHours`: Duration (in hours) specifically for YouTube watch polls created by `!watchpoll` or `!allpoll`.
*   `youtubeApiKey`: Your Google YouTube Data API v3 key. Used for fetching video titles more reliably (optional, fallback exists). **Keep this secret!**
*   `autoPollVideoChannelName`: The name of the channel where automated weekly YouTube watch polls will be posted. Also the channel from which videos are sourced for these auto-polls by default.
*   `autoPollVideoCronTime`: A cron string defining when the automated YouTube poll runs (e.g., `"0 18 * * 5"` for every Friday at 6 PM).
*   `autoPollVideoDaysPast`: How many days of video history (from `autoPollVideoChannelName`) to consider for the automated poll (e.g., "7" for the last 7 days).
*   `cronTimezone`: The IANA timezone for cron jobs (e.g., `"America/New_York"`).
*   `tagAddPrefix`, `tagRemovePrefix`, `tagShowPrefix`: Prefixes for tag management commands.
*   `tagDataFileName`: (Bot internal) Name of the file where tag data is stored (e.g., `tags.json`).
*   `watchEventMessage`: The base message used for announcing upcoming watch events/polls.
*   `announceWatchEventDaily`: `true` or `false`. Whether to announce the next watch event daily.
*   `dailyAnnouncementTime`: Time for the daily watch event announcement (e.g., `"12:00"` for noon), in the `cronTimezone`.
*   `dailyAnnouncementChannelName`: Channel for daily watch event announcements.
*   `geminiApiUrl`, `geminiApiVersion`, `geminiModelAction`: Configuration for Google Gemini API (for `!ai` and `!positivity`).
*   `geminiApiKey`: Your Google Gemini API Key. **Keep this secret!**
*   `geminiPositivePrompt`, `geminiHeartReactionPrompt`, `geminiIncludeInPrompts`: Prompts used for Gemini AI features.
*   `enableGeminiHeartReaction`: `true` or `false`. (Feature was present but not used in the latest code request, might be for future use).
*   `knowledgeCopyToChannelName`: Name of the channel where messages are copied for the "knowledge repository".
*   `knowledgeCopyEmojisMin`: Minimum number of unique Verified/Moderator users reacting to a message to trigger a copy to the knowledge repository.
*   `knowledgeCopyWhenEmoji`: The specific emoji that, when reacted with, immediately copies a message to the knowledge repository.
*   `rolesChannelName`: Name of the channel containing the message for reaction roles.
*   `rolesChannelMessageID`: The ID of the specific message in `rolesChannelName` that users react to for roles. **You must set this manually after posting the message.**
*   `reactionRoles`: An array of objects defining emoji-to-role mappings for the reaction role system. Each object should have:
    *   `emoji`: The emoji string (e.g., `"🌸"` or a custom emoji ID like `"<:custom:12345>"`).
    *   `roleName`: The exact name of the Discord role to assign/remove.
    *   `announceChannelName`: (Optional) The name of the channel to announce when a user gets this role.

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## License
MIT License

Copyright (c) 2025 Shane Britt

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
