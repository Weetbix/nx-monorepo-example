const { WebClient } = require('@slack/web-api');
const { execSync } = require('child_process');

let slackClient;
let messageTs;
let channelId;

/**
 * Extracts PR number from commit message
 * @param {String} message - Commit message
 * @returns {String} - PR number
 */
function extractPrNumber(message) {
  const match = message.match(/\(#(\d+)\)$/);
  return match?.[1] || null;
}

/**
 * Get current commit message using git log
 * @returns {String} - Current commit message
 */
function getCurrentCommitMessage() {
  return execSync('git log -1 --pretty=%B').toString().trim();
}

/**
 * Creates a consistent message attachment format for all states
 * @param {Object} context - The semantic-release context
 * @param {String} status - Current status: 'pending', 'success', or 'failure'
 */
function createMessageAttachment(context, status) {
  const {
    options,
    env,
    nextRelease: { version },
  } = context;

  const packageName = options.executorContext.projectName;

  // Status-specific values
  let statusEmoji, statusText, statusColor;
  switch (status) {
    case 'pending':
      statusEmoji = ':hourglass:';
      statusText = 'In Progress';
      statusColor = '#3AA3E3'; // Blue
      break;
    case 'success':
      statusEmoji = ':white_check_mark:';
      statusText = 'Success';
      statusColor = '#36a64f'; // Green
      break;
    case 'failure':
      statusEmoji = ':x:';
      statusText = 'Failed';
      statusColor = '#E01E5A'; // Red
      break;
    default:
      statusEmoji = ':grey_question:';
      statusText = 'Unknown';
      statusColor = '#CCCCCC'; // Grey
  }

  const workflowUrl = `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
  const statusDisplay = `<${workflowUrl}|${statusEmoji} ${statusText}>`;
  const commitTitle = getCurrentCommitMessage();
  const prNumber = extractPrNumber(commitTitle);
  const prLink = `https://github.com/${env.GITHUB_REPOSITORY}/pull/${prNumber}`;

  // Create the main attachment with colored sidebar
  const attachment = {
    color: statusColor,
    fallback: `${packageName} v${version} - ${statusText}`,
    blocks: [
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*${packageName}* v${version}`,
          },
          {
            type: 'mrkdwn',
            text: statusDisplay,
          },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `<${prLink}|${commitTitle}>`,
        },
      },
    ],
  };

  // Generate release links (only for success)
  if (status === 'success') {
    const releaseLinks = [];

    // Add links from context.releases
    context.releases
      .filter((release) => release.url && release.name)
      .forEach((release) => {
        releaseLinks.push(`<${release.url}|${release.name}>`);
      });

    attachment.blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: releaseLinks.join(' | '),
        },
      ],
    });
  }

  return attachment;
}

/**
 * Creates message attachment for the release start notification
 */
function createStartMessageAttachment(context) {
  return createMessageAttachment(context, 'pending');
}

/**
 * Creates message attachment for the release success notification
 */
function createSuccessMessageAttachment(context) {
  return createMessageAttachment(context, 'success');
}

/**
 * Creates message attachment for the release failure notification
 */
function createFailureMessageAttachment(context) {
  return createMessageAttachment(context, 'failure');
}

/**
 * A semantic-release plugin that posts release updates to Slack
 * @param {Object} pluginConfig - The plugin configuration
 * @param {string} pluginConfig.channelId - The Slack channel ID to post to
 * @param {string} pluginConfig.cdnUrl - Custom URL for S3/CDN releases
 * @param {Object} context - The semantic-release context
 * @returns {Object} The plugin object with lifecycle methods
 */
async function prepare(pluginConfig, context) {
  const { logger, env, options } = context;

  // Add GitHub environment variables to context.env for use in message blocks
  context.env = env;

  // Create message attachment
  const messageAttachment = createStartMessageAttachment(context);

  slackClient = new WebClient(env.SLACK_BOT_TOKEN);
  channelId = env.SLACK_RELEASE_CHANNEL_ID;
  const packageName = options.executorContext.projectName;

  logger.log('Posting release start notification to Slack...');
  const response = await slackClient.chat.postMessage({
    channel: channelId,
    attachments: [messageAttachment],
    text: `Release process started for ${packageName}`,
    unfurl_links: false,
    unfurl_media: false,
  });
  messageTs = response.ts;
  logger.log(`Posted to Slack, message timestamp: ${messageTs}`);
}

/**
 * Update the Slack message with success information
 */
async function success(pluginConfig, context) {
  const { logger, nextRelease, options } = context;

  // Create message attachment
  const messageAttachment = createSuccessMessageAttachment(context);
  const packageName = options.executorContext.projectName;

  logger.log('Posting release success notification to Slack...');
  await slackClient.chat.update({
    channel: channelId,
    ts: messageTs,
    attachments: [messageAttachment],
    text: `Release successful for ${packageName} v${nextRelease.version}`,
    unfurl_links: false,
    unfurl_media: false,
  });
  logger.log('Successfully updated Slack message with release information');
}

/**
 * Update the Slack message with failure information
 */
async function fail(pluginConfig, context) {
  const { logger, options } = context;

  // Create message attachment
  const messageAttachment = createFailureMessageAttachment(context);
  const packageName = options.executorContext.projectName;

  logger.log('Posting release failure notification to Slack...');
  await slackClient.chat.update({
    channel: channelId,
    ts: messageTs,
    attachments: [messageAttachment],
    text: `Release failed for ${packageName}`,
    unfurl_links: false,
    unfurl_media: false,
  });
  logger.log('Successfully updated Slack message with failure information');
}

module.exports = { prepare, success, fail };
