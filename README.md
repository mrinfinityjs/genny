# Discord Activity & Pruning Bot

This Node.js Discord bot monitors user activity in a specified channel, tracks message counts, and facilitates a polling system to prune inactive users. It also provides a command for moderators to view the last activity time of users in the monitored channel.

## Features

*   **Activity Tracking:** Monitors messages in a configured channel (e.g., `#general`) to track user activity.
*   **Configurable Thresholds:** Message count threshold for activity is configurable.
*   **Scheduled Scans:** Periodically (e.g., every 2 weeks, configurable) scans for inactive users.
*   **Kick Polls:** Initiates a poll in a configured announcement channel to decide if an inactive user should be kicked.
    *   Poll duration is configurable.
    *   Poll pass threshold (percentage of "yes" votes) is configurable.
*   **Automatic Kicking:** Kicks users if the poll passes the defined threshold.
*   **Announcements:**
    *   Announces when a scan starts.
    *   Announces users who meet activity criteria.
    *   Announces poll results and kick actions.
*   **`!activity` Command:** Allows users with appropriate permissions (configurable, defaults to open) to list all server members and their last recorded message time in the monitored activity channel.
*   **Data Persistence:** User activity data (message counts, last message timestamp) and last scan time are saved to a `data.json` file.
*   **Easy Configuration:** Most settings are managed via a `config.json` file.

## Prerequisites

*   [Node.js](https://nodejs.org/) (version 16.9.0 or newer recommended)
*   [npm](https://www.npmjs.com/) (usually comes with Node.js)
*   A Discord Bot Application (see Setup)

## Setup

1.  **Clone the Repository (or Create Project Files):**
    ```bash
    # If you have a git repo, clone it:
    # git clone <your-repo-url>
    # cd <your-repo-directory>

    # Otherwise, create a directory and navigate into it:
    mkdir my-activity-bot
    cd my-activity-bot
    ```

2.  **Install Dependencies:**
    ```bash
    npm install discord.js
    ```

3.  **Create a Discord Bot Application:**
    *   Go to the [Discord Developer Portal](https://discord.com/developers/applications).
    *   Click **"New Application"** and give it a name (e.g., "ActivityBot").
    *   Navigate to the **"Bot"** tab.
        *   Click **"Add Bot"** and confirm.
        *   **Copy the Bot Token.** You'll need this for `config.json`.
        *   Under **"Privileged Gateway Intents"**:
            *   Enable **SERVER MEMBERS INTENT**.
            *   Enable **MESSAGE CONTENT INTENT**.
        *   (Optional) Toggle "Public Bot" if desired (this was a point of issue during setup for some, may be required for URL generation without redirect issues).
    *   Click **"Save Changes"**.

4.  **Configure `config.json`:**
    *   Create a file named `config.json` in the root of your project directory.
    *   Paste the following content and fill in your details:
        ```json
        {
          "token": "YOUR_DISCORD_BOT_TOKEN",
          "prefix": "!",
          "activityChannelName": "general",
          "announcementChannelName": "general",
          "messageThreshold": 30,
          "scanIntervalDays": 14,
          "pollDurationHours": 24,
          "pollPassThreshold": 0.6,
          "guildId": "YOUR_SERVER_ID_HERE"
        }
        ```
    *   Replace placeholders:
        *   `YOUR_DISCORD_BOT_TOKEN`: The bot token you copied in step 3.
        *   `YOUR_SERVER_ID_HERE`: The ID of the Discord server you want the bot to operate in.
            *   To get this, enable Developer Mode in Discord (User Settings -> Advanced -> Developer Mode). Then, right-click your server icon and select "Copy ID".
        *   Adjust `activityChannelName`, `announcementChannelName`, `messageThreshold`, etc., as needed.

5.  **Invite the Bot to Your Server:**
    *   In the Discord Developer Portal, for your application, go to **"OAuth2" -> "URL Generator"**.
    *   **SCOPES:** Check `bot`.
    *   **BOT PERMISSIONS:** Select the following:
        *   `View Channels`
        *   `Send Messages`
        *   `Embed Links`
        *   `Read Message History`
        *   `Add Reactions`
        *   `Kick Members`
    *   Copy the **Generated URL** at the bottom of the page.
    *   Paste the URL into your browser, select your server, and authorize the bot.

6.  **Bot Role Permissions:**
    *   Ensure the bot's role in your server is high enough in the role hierarchy to kick the members it needs to. It cannot kick members with roles equal to or higher than its own.
    *   Ensure the bot has permission to view, send messages, embed links, and add reactions in the configured `activityChannelName` and `announcementChannelName`.

## Running the Bot

1.  Navigate to your project directory in your terminal.
2.  Run the bot using:
    ```bash
    node bot.js
    ```
3.  You should see log messages in your console indicating the bot has logged in and is ready.

## Usage

### Automatic Activity Monitoring

The bot automatically tracks messages in the channel specified by `activityChannelName`. Every `scanIntervalDays`, it will:
1.  Announce the start of the scan.
2.  Identify users with `messageCount` less than or equal to `messageThreshold`.
3.  Create kick polls for these inactive users in the `announcementChannelName`.
4.  Announce users who have met the activity criteria.
5.  After polls conclude (duration set by `pollDurationHours`):
    *   If a poll passes (votes meet `pollPassThreshold`), the user is kicked.
    *   Results of each poll are announced.
6.  Message counts for all users are reset for the next activity period.

### Commands

*   **`!activity`** (or your configured prefix + activity)
    *   Lists all non-bot members in the server and their last recorded message timestamp in the `activityChannelName`.
    *   Output is paginated in embeds for readability.
    *   By default, any user can use this. You can modify `bot.js` to restrict it (see commented-out permission check in the `messageCreate` event handler).

## `data.json` File

This file is automatically created and managed by the bot. It stores:
*   `lastScanTimestamp`: The timestamp of the last completed activity scan.
*   `users`: An object where keys are user IDs. Each user object contains:
    *   `messageCount`: Number of messages sent in the `activityChannelName` during the current period.
    *   `username`: The user's Discord username.
    *   `lastMessageTimestamp`: The timestamp of the user's last message in the `activityChannelName`.

**Do not manually edit `data.json` unless you know what you are doing, as it can lead to unexpected behavior.**

## Troubleshooting

*   **"Guild with ID ... not found"**:
    *   Ensure `guildId` in `config.json` is correct.
    *   Verify the bot has been successfully invited to and is present in that server.
*   **Bot not responding to messages/commands**:
    *   Check that the `token` in `config.json` is correct.
    *   Ensure Privileged Gateway Intents (Server Members, Message Content) are enabled in the Developer Portal.
    *   Verify the bot has necessary channel permissions (View Channel, Send Messages, Read Message History).
    *   Check the console for any error messages.
*   **Bot cannot kick users**:
    *   Ensure the bot has the "Kick Members" permission.
    *   Make sure the bot's role is higher in the server's role hierarchy than the role of the member it's trying to kick.
*   **Issues generating invite URL in Developer Portal**:
    *   Try clearing browser cache/cookies or using an Incognito window.
    *   Ensure ONLY the `bot` scope is selected when generating the bot invite URL.
    *   Some users reported needing to toggle "Public Bot" ON (on the "Bot" tab) for the URL generator to work without demanding a Redirect URI.

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## License

[MIT](LICENSE) (If you choose to add a license file)
