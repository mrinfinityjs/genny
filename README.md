# Discord Activity, Verification & Pruning Bot

This Node.js Discord bot implements a comprehensive system for managing new member verification, tracking user activity, and pruning inactive members through configurable rules and polling systems. It offers moderator commands for manual control and reporting.

## Core Features

*   **New Member Verification:**
    *   Automatically assigns a "New Member" role to new joins, restricting them to a specified channel (e.g., `#general`).
    *   Tracks messages of new members in the activity channel.
    *   Periodically scans unverified members. If they meet configured criteria (days on server, messages sent), a poll is initiated in a specified channel to grant them a "Verified Member" role, giving full server access.
*   **Activity Tracking & Pruning:**
    *   Monitors messages in the configured activity channel for all members.
    *   Periodically scans for members (excluding moderators) whose message count falls below a threshold within a set period.
    *   Initiates individual kick polls for these inactive members.
*   **Moderator Commands:**
    *   `!allow [days messages]` / `!allow`: Manually verifies members, granting them the "Verified Member" role. Can target specific criteria or all eligible unverified members.
    *   `!deny <days> <messages>`: Manually kicks unverified members who have been on the server for `<days>` and have sent `<= <messages>` messages.
    *   `!kickpollinactive [days_silent]`: Initiates kick polls for members (excluding moderators) who haven't sent a message in the activity channel for a specified number of days.
    *   `!activity`: Displays a paginated list of all server members, their last activity time in the monitored channel, verification status, and verification message count.
    *   `!roles`: Displays a paginated list of all server members and their assigned roles.
*   **Moderator Exemption:** Users with a configured "Moderator" role (or Administrator permission) are exempt from automatic scans, polls, and kick actions. Moderator-only commands are restricted.
*   **Configurable & Persistent:**
    *   Most settings (role names, channel names, thresholds, intervals) are managed via a `config.json` file.
    *   Bot accepts a config file path as a command-line argument.
    *   User data (message counts, join times, verification status, last activity) is saved to `data.json`.
*   **Global Command Listening:** Bot listens for commands in any channel within the configured guild.

## Prerequisites

*   [Node.js](https://nodejs.org/) (v16.9.0 or newer recommended)
*   [npm](https://www.npmjs.com/)
*   A Discord Bot Application

## Setup

1.  **Project Files:**
    *   Save the bot code as `bot.js`.
    *   Create your `config.json` (see example below).

2.  **Install Dependencies:**
    ```bash
    npm install discord.js
    ```

3.  **Discord Bot Application:**
    *   Go to the [Discord Developer Portal](https://discord.com/developers/applications).
    *   Create/select your application.
    *   Navigate to the **"Bot"** tab:
        *   Copy the **Bot Token**.
        *   Enable **Privileged Gateway Intents**:
            *   `SERVER MEMBERS INTENT`
            *   `MESSAGE CONTENT INTENT`
        *   Click **"Save Changes"**.

4.  **Configure `config.json`:**
    *   Create `config.json` in your project directory (or specify a path when running).
    *   Use the example structure provided (see "Full `config.json` (Example)" above) and fill in:
        *   `token`: Your Bot Token.
        *   `guildId`: Your Server ID (Enable Developer Mode in Discord: User Settings > Advanced, then right-click server icon > Copy ID).
        *   Role Names (`newMemberRoleName`, `verifiedMemberRoleName`, `moderatorRoleName`): **Must match exactly** (case-sensitive) the names of the roles in your Discord server.
        *   Channel Names (`activityChannelName`, `announcementChannelName`, `verificationPollChannelName`): Exact names of the channels.
        *   Adjust thresholds and intervals as desired.

5.  **Discord Server Role & Channel Setup:**
    *   **Roles:**
        *   Create the roles specified in `config.json`: `New Member`, `Verified Member`, `Moderator`.
        *   **`@everyone` Role:** In Server Settings > Roles > `@everyone`, **DISABLE `View Channel` permission for ALL channels/categories.** This ensures new users are restricted.
        *   **`New Member` Role:**
            *   Grant `View Channel`, `Send Messages`, `Read Message History` **ONLY** for your `activityChannelName` (e.g., `#general`) and your general voice channel.
            *   For all other channels/categories, explicitly **DISABLE `View Channel`** for this role.
        *   **`Verified Member` Role:** Grant all permissions desired for full members (e.g., view all public channels).
        *   **`Moderator` Role:** Grant permissions appropriate for moderators, including "Manage Server" if they need to manage bot settings or other server aspects. The bot uses this role name to identify moderators for command access and exemptions.
    *   **Channels:** Create the channels specified in `config.json` if they don't exist.

6.  **Invite the Bot:**
    *   In the Developer Portal (OAuth2 > URL Generator):
        *   **SCOPES:** Check `bot`.
        *   **BOT PERMISSIONS:** Select `View Channels`, `Send Messages`, `Embed Links`, `Read Message History`, `Add Reactions`, `Kick Members`, `Manage Roles`.
    *   Copy the generated URL and use it to invite the bot to your server.
    *   Ensure the bot's role is high enough in the hierarchy to manage roles (add/remove `New Member`/`Verified Member`) and kick members (below moderators/admins).

## Running the Bot

1.  Open your terminal in the project directory.
2.  Run:
    ```bash
    node bot.js [path/to/your/config.json]
    ```
    *   If `[path/to/your/config.json]` is omitted, it defaults to `config.json` in the same directory as `bot.js`.
    *   Example: `node bot.js` or `node bot.js server_configs/main_config.json`

## Commands (Default Prefix: `!`)

**Moderator Only Commands:**

*   **`allow [days messages]`**: Manually verifies members who have been on the server for at least `[days]` and sent at least `[messages]` in the activity channel.
    *   Example: `!allow 7 20`
*   **`allow`**: Manually verifies ALL currently unverified members who have the "New Member" role.
*   **`deny <days> <messages>`**: Kicks unverified "New Members" who joined at least `<days>` ago and have `<= <messages>` in the activity channel.
    *   Example: `!deny 14 5`
*   **`kickpollinactive [days_silent]`**: Initiates kick polls for any non-moderator member silent in the activity channel for `[days_silent]` (or `config.kickPollSilentDaysThreshold` if `[days_silent]` is omitted).
    *   Example: `!kickpollinactive 30`
*   **`roles`**: Displays a list of all server members and their assigned roles.

**Public Commands (Can be restricted in code if needed):**

*   **`activity`**: Displays a list of members, their last activity time in the monitored channel, verification status, and verification message count.

## `data.json` File

This file is automatically created and managed by the bot. It stores:
*   `lastScanTimestamp`: Timestamp of the last pruning scan.
*   `lastVerificationScanTimestamp`: Timestamp of the last new member verification scan.
*   `users`: An object where keys are user IDs. Each user object contains:
    *   `messageCount`: Messages in `activityChannelName` for current pruning period (resets).
    *   `username`: Discord username.
    *   `lastMessageTimestamp`: Timestamp of last message in `activityChannelName`.
    *   `joinTimestamp`: Timestamp of when the user joined the server (or when bot first saw them).
    *   `isVerified`: Boolean, `true` if they have the "Verified Member" role.
    *   `verificationMessages`: Total messages in `activityChannelName` while unverified (used for verification criteria).

**Do not manually edit `data.json` unless absolutely necessary.**

## Troubleshooting

*   **"Guild ... not found" / Role/Channel not found:** Double-check names in `config.json` (case-sensitive!) and ensure the `guildId` is correct. Verify the bot is in the server.
*   **Permissions Errors:** Ensure the bot's role has the necessary permissions (`Manage Roles`, `Kick Members`) and is high enough in the role hierarchy.
*   **Commands not working:** Check `prefix` in `config.json`. Ensure Privileged Intents are enabled. Check console for errors.
*   **Users not being restricted:** Crucially, ensure the `@everyone` role has `View Channel` disabled for all channels except those you explicitly want everyone (even without roles) to see. The `New Member` role should then grant specific access.
