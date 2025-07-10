# Genny - General Purpose Community Discord bot.

This is a powerful and highly configurable Discord bot built with Node.js and Discord.js. It's designed to automate server management, boost community engagement, and provide a suite of utility functions for moderators and members alike.

The bot features a persistent data system using a local `data.json` file, ensuring that user activity, reminders, and other crucial information survive bot restarts.

## ✨ Core Features

*   **📊 Activity Tracking & Pruning:** Monitors user messages in a designated channel and can automatically run polls to kick inactive members.
*   **✅ New Member Verification:** A robust system to automatically poll for the verification of new members once they meet configurable activity and tenure requirements.
*   **📝 Persistent Reminders:** A `!remindme` command that understands natural language (e.g., "in 10 days," "tomorrow at 5pm") and persists through restarts.
*   **🎥 YouTube Integration:**
    *   Automatically logs all YouTube links posted in the server.
    *   Creates manual or automated polls to decide which video to watch as a group.
    *   Lists recently posted videos based on various criteria.
*   **🤖 AI-Powered Features (via Google Gemini):**
    *   **`!ai` command:** Allows users to have a conversation with the AI.
    *   **`!positivity` command:** Generates an uplifting message.
    *   **On-Demand Translation:** Translates a message to a configured language when a user reacts with a specific emoji.
*   **🏷️ Tagging System:** A key-value storage system for server members to save and retrieve useful snippets of text.
*   **⭐ Reaction-Based Actions:**
    *   **Reaction Roles:** Assigns roles to users when they react to a specific message.
    *   **Message Bookmarking:** Lets users save a message to their DMs by reacting with an `🍎` emoji.
    *   **Knowledge Base:** Automatically copies important or funny messages to a designated channel based on reactions.
*   **⚙️ Runtime Configuration:** Moderators can view and update many of the bot's settings in real-time without needing to restart the bot.

## 📋 Prerequisites

Before you begin, ensure you have the following:

1.  **Node.js:** Version 16.9.0 or higher.
2.  **npm:** (Node Package Manager) usually comes with Node.js.
3.  **A Discord Bot Application:**
    *   Create one on the [Discord Developer Portal](https://discord.com/developers/applications).
    *   You will need the **Bot Token**.
    *   Enable the **Privileged Gateway Intents**: `SERVER MEMBERS INTENT` and `MESSAGE CONTENT INTENT`.
4.  **A Google API Key:**
    *   This is required for the AI (Gemini) and YouTube (oEmbed) features.
    *   Create one on the [Google Cloud Console](https://console.cloud.google.com/). You will need to enable the "Generative Language API" and "YouTube Data API v3".

## 🚀 Installation & Setup

1.  **Clone or Download the Repository:**
    ```bash
    git clone <your-repository-url>
    cd <repository-directory>
    ```

2.  **Install Dependencies:**
    Run the following command in your terminal to install all required packages:
    ```bash
    npm install
    ```
    This will install `discord.js`, `luxon`, `axios`, `cron`, `ytdl-core`, and `chrono-node`.

3.  **Create the Configuration File:**
    In the root directory of the project, create a file named `config.json`. Copy the contents of the `config.example.json` file (or the template below) into it.

4.  **Fill out `config.json`:**
    This is the most important step. Carefully fill in all the required values, especially your bot token, guild ID, and API keys. See the **Configuration** section below for a detailed explanation of each setting.

5.  **Run the Bot:**
    Start the bot using the following command:
    ```bash
    node bot.js
    ```
    If you want the bot to run continuously, consider using a process manager like [PM2](https://pm2.keymetrics.io/).

## ⚙️ Configuration (`config.json`)

Your `config.json` file controls every aspect of the bot. Here is a breakdown of all available settings:

| Key                           | Type             | Description                                                                                             | Example                                         |
| ----------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **`token`**                   | `string`         | **Required.** Your Discord bot's secret token. **Keep this private!**                                     | `"YOUR_BOT_TOKEN_HERE"`                         |
| **`guildId`**                 | `string`         | **Required.** The ID of the Discord server (guild) where the bot will operate.                          | `"123456789012345678"`                          |
| `prefix`                      | `string`         | The prefix for all commands (e.g., `!help`).                                                            | `"!"`                                           |
| `moderatorRoleName`           | `string`         | The name of the role that grants moderator permissions for the bot.                                     | `"Moderator"`                                   |
| `newMemberRoleName`           | `string`         | The name of the role automatically assigned to new members.                                             | `"Newcomer"`                                    |
| `verifiedMemberRoleName`      | `string`         | The name of the role granted to members after they are verified.                                        | `"Verified Member"`                             |
| **Channel Names**             |                  |                                                                                                         |                                                 |
| `activityChannelName`         | `string`         | The channel where user activity is tracked for verification and pruning.                                | `"general-chat"`                                |
| `announcementChannelName`     | `string`         | The channel where moderator actions (kick polls, manual verification) are announced.                    | `"mod-announcements"`                           |
| `verificationPollChannelName` | `string`         | The channel where polls to verify new members are posted.                                               | `"verification-polls"`                          |
| **Verification & Pruning**    |                  |                                                                                                         |                                                 |
| `verificationMessageThreshold`| `number`         | Minimum messages a new member needs in the activity channel to be eligible for a verification poll.       | `50`                                            |
| `verificationPollDays`        | `number`         | Minimum days a user must be in the server to be eligible for a verification poll.                       | `7`                                             |
| `scanIntervalDays`            | `number`         | How often (in days) the bot scans for inactive users to prune.                                          | `14`                                            |
| `messageThreshold`            | `number`         | Minimum messages needed during a scan interval to be considered "active".                               | `10`                                            |
| **YouTube & Polls**           |                  |                                                                                                         |                                                 |
| `autoPollVideoChannelName`    | `string`         | The channel to monitor for the automated YouTube watch poll.                                            | `"video-sharing"`                               |
| `autoPollVideoCronTime`       | `string`         | A [cron string](https://crontab.guru/) defining when the automated poll runs.                             | `"0 19 * * 5"` (Every Friday at 7 PM)           |
| `cronTimezone`                | `string`         | The timezone for cron jobs (e.g., `America/New_York`).                                                  | `"America/Los_Angeles"`                         |
| `watchPollDurationHours`      | `number`         | How long (in hours) a YouTube watch poll should last.                                                   | `12`                                            |
| **AI (Google Gemini)**        |                  |                                                                                                         |                                                 |
| **`geminiApiKey`**            | `string`         | **Required.** Your Google API key for Gemini.                                                           | `"YOUR_GOOGLE_API_KEY"`                         |
| `geminiApiUrl`                | `string`         | The base URL for the Gemini API.                                                                        | `"https://generativelanguage.googleapis.com/"` |
| `geminiApiVersion`            | `string`         | The API version.                                                                                        | `"v1beta"`                                      |
| `geminiModelAction`           | `string`         | The model action endpoint.                                                                              | `"models/gemini-pro:generateContent"`           |
| `translateEmoji`              | `string`         | The emoji that triggers the translation feature on a message.                                           | `"🌐"`                                          |
| `translateToLanguage`         | `string`         | The language to translate messages into (e.g., "Spanish", "Japanese").                                  | `"English"`                                     |
| **Reactions & Misc**          |                  |                                                                                                         |                                                 |
| `rolesChannelName`            | `string`         | The channel where the reaction role message is located.                                                 | `"get-roles"`                                   |
| `rolesChannelMessageID`       | `string`         | The ID of the message to monitor for reaction roles.                                                    | `"987654321098765432"`                          |
| `reactionRoles`               | `array`          | An array of objects defining the reaction roles.                                                        | `[{"emoji": "🎮", "roleName": "Gamer"}]`         |

---

## 📖 Usage & Commands

### Public Commands
These commands can be used by any server member.

*   `!help` or `!commands`: Displays a detailed list of all available commands.
*   `!activity`: Shows a report of when each user was last active in the designated activity channel.
*   `!remindme <time> <message>`: Sets a personal reminder. The bot will ping you in the channel with your message at the specified time.
    *   *Examples:* `!remindme 10 minutes to check the oven`, `!remindme tomorrow at 4pm to call support`
*   `!watch`: Shows the time remaining until the next scheduled YouTube watch poll.
*   `!ai <prompt>`: Sends a prompt to the AI and returns its response.
*   `!positivity`: Gets an uplifting, positive message from the AI.

### Tagging System
*Requires the "Verified Member" role or Moderator permissions.*

*   `+tagName <value>`: Creates a new tag or updates an existing one.
*   `-tagName`: Deletes a tag.
*   `~tagName`: Displays the value of a specific tag.
*   `~`: Lists all available tags in the server.

### Moderator Commands
*Requires the "Moderator" role or Administrator permissions.*

*   `!allow [days] [messages]`: Manually verifies new members. Can be used with criteria to bulk-verify.
*   `!deny <days> <messages>`: Kicks new members who meet the specified (low) activity criteria.
*   `!kickpollinactive [days]`: Manually starts a kick poll for members who have been inactive for a certain number of days.
*   `!watchpoll <criteria>`: Creates a YouTube watch poll for videos posted in the **current channel**.
*   `!allpoll <criteria>`: Creates a YouTube watch poll for videos posted in **any channel**.
*   `!vids <criteria>`: Lists YouTube videos from the **current channel**.
*   `!allvids <criteria>`: Lists YouTube videos from **any channel**.
*   `!set [setting] [value]`: Views or updates the bot's configuration in real-time.

### Reaction-Based Features

*   **Bookmark a Message (`🍎`):** React to any message with an apple emoji to have the bot DM you the message content, author, date, and attachments.
*   **Translate a Message (`🌐` by default):** React to a message with the configured `translateEmoji` to have the bot post a translation in the channel.
*   **Reaction Roles:** React to the configured message in the `rolesChannelName` to get a role. Removing the reaction removes the role.
