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
 * Creates a consistent message block format for all states
 * @param {Object} context - The semantic-release context
 * @param {String} status - Current status: 'pending', 'success', or 'failure'
 */
function createMessageBlocks(context, status) {
  const {
    options,
    env,
    nextRelease: { version },
  } = context;

  const packageName = options.executorContext.projectName;

  // Status-specific values
  let statusEmoji, statusText;
  switch (status) {
    case 'pending':
      statusEmoji = ':hourglass:';
      statusText = 'In Progress';
      break;
    case 'success':
      statusEmoji = ':white_check_mark:';
      statusText = 'Success';
      break;
    case 'failure':
      statusEmoji = ':x:';
      statusText = 'Failed';
      break;
    default:
      statusEmoji = ':grey_question:';
      statusText = 'Unknown';
  }

  const workflowUrl = `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
  const statusDisplay = `<${workflowUrl}|${statusEmoji} ${statusText}>`;
  const commitTitle = getCurrentCommitMessage();
  const prNumber = extractPrNumber(commitTitle);
  const prLink = `https://github.com/${env.GITHUB_REPOSITORY}/pull/${prNumber}`;

  const blocks = [
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
  ];

  // Add commit info
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `<${prLink}|${commitTitle}>`,
    },
  });

  // Generate release links (only for success)
  if (status === 'success') {
    const releaseLinks = [];

    // Add links from context.releases
    context.releases
      .filter((release) => release.url && release.name)
      .forEach((release) => {
        releaseLinks.push(`<${release.url}|${release.name}>`);
      });

    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: releaseLinks.join(' | '),
        },
      ],
    });
  }

  return blocks;
}

/**
 * Creates message blocks for the release start notification
 */
function createStartMessageBlocks(context) {
  // No need for special handling now since we can get commit info from options.commits
  return createMessageBlocks(context, 'pending');
}

/**
 * Creates message blocks for the release success notification
 */
function createSuccessMessageBlocks(context) {
  return createMessageBlocks(context, 'success');
}

/**
 * Creates message blocks for the release failure notification
 */
function createFailureMessageBlocks(context) {
  return createMessageBlocks(context, 'failure');
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

  // Create message blocks
  const messageBlocks = createStartMessageBlocks(context);

  slackClient = new WebClient(env.SLACK_BOT_TOKEN);
  channelId = env.SLACK_RELEASE_CHANNEL_ID;
  const packageName = options.executorContext.projectName;

  logger.log('Posting release start notification to Slack...');
  const response = await slackClient.chat.postMessage({
    channel: channelId,
    blocks: messageBlocks,
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

  // Create message blocks
  const messageBlocks = createSuccessMessageBlocks(context);
  const packageName = options.executorContext.projectName;

  logger.log('Posting release success notification to Slack...');
  await slackClient.chat.update({
    channel: channelId,
    ts: messageTs,
    blocks: messageBlocks,
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

  // Create message blocks
  const messageBlocks = createFailureMessageBlocks(context);
  const packageName = options.executorContext.projectName;

  logger.log('Posting release failure notification to Slack...');
  await slackClient.chat.update({
    channel: channelId,
    ts: messageTs,
    blocks: messageBlocks,
    text: `Release failed for ${packageName}`,
    unfurl_links: false,
    unfurl_media: false,
  });
  logger.log('Successfully updated Slack message with failure information');
}

module.exports = { prepare, success, fail };
