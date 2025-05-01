const { WebClient } = require('@slack/web-api');

let slackClient;
let messageTs;
let channelId;

/**
 * Creates a consistent message block format for all states
 * @param {Object} context - The semantic-release context
 * @param {String} status - Current status: 'pending', 'success', or 'failure'
 * @param {String} version - The version being released
 */
function createMessageBlocks(context, status, version) {
  const {
    options,
    env,
  } = context;

  const packageName = options.executorContext?.projectName;
  
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

  // Generate GitHub Actions workflow URL if available
  let workflowUrl = '';
  if (env && env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID) {
    workflowUrl = `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
  }

  // Generate release links (only for success)
  const releaseLinks = [];
  
  // Add links from context.releases if available
  if (status === 'success' && version && context.releases && Array.isArray(context.releases)) {
    context.releases.forEach(release => {
      if (release.url && release.name) {
        releaseLinks.push(`<${release.url}|${release.name}>`);
      }
    });
  }

  // Add workflow link if available
  if (workflowUrl) {
    releaseLinks.push(`<${workflowUrl}|Workflow Run>`);
  }

  return [
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*${packageName}* ${version ? `v${version}` : ''}`,
        },
        {
          type: 'mrkdwn',
          text: `${statusEmoji} ${statusText}`,
        },
      ],
    },
    releaseLinks.length > 0 ? {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: releaseLinks.join(' | '),
        },
      ],
    } : null,
  ].filter(Boolean);
}

/**
 * Creates message blocks for the release start notification
 */
function createStartMessageBlocks(context) {
  return createMessageBlocks(context, 'pending');
}

/**
 * Creates message blocks for the release success notification
 */
function createSuccessMessageBlocks(context) {
  const { nextRelease } = context;
  return createMessageBlocks(context, 'success', nextRelease?.version);
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
  const {
    logger,
    env,
    options,
  } = context;

  const {
    SLACK_BOT_TOKEN,
    SLACK_RELEASE_CHANNEL_ID,
    GITHUB_SERVER_URL,
    GITHUB_REPOSITORY,
    GITHUB_RUN_ID,
  } = env;

  // Add GitHub environment variables to context.env for use in message blocks
  context.env = {
    ...env,
    GITHUB_SERVER_URL,
    GITHUB_REPOSITORY,
    GITHUB_RUN_ID,
  };

  // Create message blocks
  const messageBlocks = createStartMessageBlocks(context);

  const slackToken = SLACK_BOT_TOKEN;
  channelId = SLACK_RELEASE_CHANNEL_ID;
  const packageName = options.executorContext?.projectName || 'package';

  if (!slackToken) {
    logger.log(
      'No Slack token found in environment variables (SLACK_BOT_TOKEN). Skipping Slack notification.'
    );
    return;
  }

  if (!channelId) {
    logger.log(
      'No Slack channel ID found in environment variables (SLACK_RELEASE_CHANNEL_ID). Skipping Slack notification.'
    );
    return;
  }

  slackClient = new WebClient(slackToken);

  logger.log('Posting release start notification to Slack...');

  try {
    const response = await slackClient.chat.postMessage({
      channel: channelId,
      blocks: messageBlocks,
      text: `Release process started for ${packageName}`,
      unfurl_links: false,
      unfurl_media: false
    });

    messageTs = response.ts;
    logger.log(`Posted to Slack, message timestamp: ${messageTs}`);
  } catch (error) {
    logger.error('Error posting to Slack:', error);
  }
}

/**
 * Update the Slack message with success information
 */
async function success(pluginConfig, context) {
  const {
    logger,
    nextRelease,
    options,
  } = context;

  console.log('success', context);
  console.log('nextRelease', nextRelease);

  // Create message blocks
  const messageBlocks = createSuccessMessageBlocks(context);
  const packageName = options.executorContext?.projectName || 'package';

  if (!slackClient || !messageTs) {
    logger.log(
      'Slack client not initialized or no message to update. Skipping Slack notification.'
    );
    return;
  }

  logger.log('Posting release success notification to Slack...');

  try {
    await slackClient.chat.update({
      channel: channelId,
      ts: messageTs,
      blocks: messageBlocks,
      text: `Release successful for ${packageName} v${nextRelease.version}`,
      unfurl_links: false,
      unfurl_media: false
    });

    logger.log('Successfully updated Slack message with release information');
  } catch (error) {
    logger.error('Error updating Slack message:', error);
  }
}

/**
 * Update the Slack message with failure information
 */
async function fail(pluginConfig, context) {
  const {
    logger,
    options,
  } = context;

  // Create message blocks
  const messageBlocks = createFailureMessageBlocks(context);
  const packageName = options.executorContext?.projectName || 'package';

  if (!slackClient || !messageTs) {
    logger.log(
      'Slack client not initialized or no message to update. Skipping Slack notification.'
    );
    return;
  }

  logger.log('Posting release failure notification to Slack...');

  try {
    await slackClient.chat.update({
      channel: channelId,
      ts: messageTs,
      blocks: messageBlocks,
      text: `Release failed for ${packageName}`,
      unfurl_links: false,
      unfurl_media: false
    });

    logger.log('Successfully updated Slack message with failure information');
  } catch (error) {
    logger.error('Error updating Slack message:', error);
  }
}

module.exports = { prepare, success, fail };
