import { WebClient } from '@slack/web-api';

// Set unique process name for identification
const messageConfig = JSON.parse(process.env.MESSAGE_CONFIG || '{}');
const timestamp = Date.now();
process.title = `semantic-release-monitor-${messageConfig.packageName}-${timestamp}`;

const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
const channelId = process.env.CHANNEL_ID;
const messageTs = process.env.MESSAGE_TS;

async function updateSlackMessage() {
  try {
    await slackClient.chat.update({
      channel: channelId!,
      ts: messageTs!,
      attachments: [messageConfig.attachment],
      unfurl_links: false,
      unfurl_media: false,
      username: process.env.SLACK_BOT_USERNAME,
      icon_emoji: process.env.SLACK_BOT_ICON_EMOJI,
    });
  } catch (error) {
    console.error('Error updating Slack message:', error);
  }
}

// Check if parent process is still running
function checkParentProcess() {
  try {
    // If we can't find the parent process, it means it died
    process.kill(process.ppid, 0);
  } catch (error) {
    // Parent process is dead, update Slack and exit
    updateSlackMessage().finally(() => {
      process.exit(0);
    });
  }
}

// Check every second
setInterval(checkParentProcess, 1000); 